import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createClient, type YtmClient } from './client.js';
import { badInput, YtmkitError } from './errors.js';
import type { ClientOptions, StreamInfo, StreamOptions } from './types.js';

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const FALLBACK_CACHE_TTL_MS = 10 * 60_000;
const FORWARDED_UPSTREAM_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'last-modified',
  'etag',
] as const;
const EXPOSE_HEADERS = 'Content-Length, Content-Range, Accept-Ranges, Content-Type';

interface CacheEntry {
  info: StreamInfo;
  fetchedAt: number;
}

interface UpstreamInit {
  method: 'GET' | 'HEAD';
  headers?: Record<string, string>;
}

/**
 * A tiny local HTTP server for browser clients.
 * It hides expiring googlevideo URLs and adds CORS + Range support.
 */
export interface StreamProxy {
  readonly server: Server;
  /** Base URL, e.g. `http://127.0.0.1:54321`. */
  readonly url: string;
  /** Build a playable URL for a track. */
  streamUrl(videoId: string, options?: StreamOptions): string;
  /** Stop the server and close open connections. */
  close(): Promise<void>;
}

export interface StreamProxyOptions {
  /** Reuse an existing client instead of creating one. */
  client?: Pick<YtmClient, 'getStream'>;
  /** Options used when the proxy creates its own client. */
  clientOptions?: ClientOptions;
  /** Defaults to `127.0.0.1`. */
  host?: string;
  /** Defaults to `0` (a random free port). */
  port?: number;
  /** Defaults to `*`. Pass false to send no CORS headers. */
  corsOrigin?: string | false;
  /** Refresh cached URLs this many seconds before they expire. Defaults to 120. */
  refreshBeforeSeconds?: number;
  /** Maximum cached track resolutions. Defaults to 100. */
  cacheSize?: number;
  /** Injectable fetch, mainly for tests. */
  fetch?: typeof fetch;
}

function cacheKey(videoId: string, options: StreamOptions): string {
  return `${videoId}|${options.codec ?? 'any'}|${options.itag ?? ''}`;
}

function parseStreamOptions(params: URLSearchParams): StreamOptions {
  const options: StreamOptions = {};

  const codec = params.get('codec');
  if (codec !== null) {
    if (codec !== 'opus' && codec !== 'aac' && codec !== 'any') {
      throw badInput("codec must be 'opus', 'aac', or 'any'");
    }
    options.codec = codec;
  }

  const itag = params.get('itag');
  if (itag !== null) {
    const value = Number(itag);
    if (!Number.isInteger(value) || value <= 0) {
      throw badInput('itag must be a positive integer');
    }
    options.itag = value;
  }

  return options;
}

function displayHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') return '127.0.0.1';
  if (host.includes(':') && !host.startsWith('[')) return `[${host}]`;
  return host;
}

export async function createStreamProxy(options: StreamProxyOptions = {}): Promise<StreamProxy> {
  const client = options.client ?? (await createClient(options.clientOptions));
  const fetchImpl = options.fetch ?? fetch;
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  const corsOrigin = options.corsOrigin === undefined ? '*' : options.corsOrigin;
  const refreshBeforeMs = Math.max(0, (options.refreshBeforeSeconds ?? 120) * 1000);
  const cacheSize = Math.max(1, options.cacheSize ?? 100);

  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<StreamInfo>>();

  function isFresh(entry: CacheEntry): boolean {
    if (entry.info.expiresAt !== null) {
      return entry.info.expiresAt.getTime() - refreshBeforeMs > Date.now();
    }
    return Date.now() - entry.fetchedAt < FALLBACK_CACHE_TTL_MS;
  }

  function remember(key: string, info: StreamInfo): void {
    cache.delete(key);
    cache.set(key, { info, fetchedAt: Date.now() });

    while (cache.size > cacheSize) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  function resolveStream(
    videoId: string,
    streamOptions: StreamOptions,
    force = false,
  ): Promise<StreamInfo> {
    const key = cacheKey(videoId, streamOptions);

    if (!force) {
      const cached = cache.get(key);
      if (cached && isFresh(cached)) {
        // LRU touch.
        cache.delete(key);
        cache.set(key, cached);
        return Promise.resolve(cached.info);
      }
    }

    const pending = inflight.get(key);
    if (pending) return pending;

    const promise = client
      .getStream(videoId, streamOptions)
      .then((info) => {
        remember(key, info);
        inflight.delete(key);
        return info;
      })
      .catch((error: unknown) => {
        inflight.delete(key);
        throw error;
      });

    inflight.set(key, promise);
    return promise;
  }

  function applyCors(res: ServerResponse): void {
    if (corsOrigin === false) return;
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Expose-Headers', EXPOSE_HEADERS);
  }

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    applyCors(res);
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  function sendError(res: ServerResponse, status: number, error: unknown): void {
    if (error instanceof YtmkitError) {
      sendJson(res, status, { error: error.message, code: error.code });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, status, { error: message, code: 'UPSTREAM' });
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    const path = requestUrl.pathname;

    if (method === 'OPTIONS') {
      applyCors(res);
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.writeHead(204);
      res.end();
      return;
    }

    if (path === '/health' && (method === 'GET' || method === 'HEAD')) {
      if (method === 'HEAD') {
        applyCors(res);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end();
      } else {
        sendJson(res, 200, { ok: true });
      }
      return;
    }

    const match = /^\/stream\/([^/]+)$/.exec(path);
    if (!match) {
      sendJson(res, 404, { error: 'Not found', code: 'NOT_FOUND' });
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      applyCors(res);
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      sendJson(res, 405, { error: 'Method not allowed', code: 'BAD_INPUT' });
      return;
    }

    const videoId = decodeURIComponent(match[1] ?? '');
    if (!VIDEO_ID_PATTERN.test(videoId)) {
      sendJson(res, 400, {
        error: 'videoId must be an 11-character YouTube video id',
        code: 'BAD_INPUT',
      });
      return;
    }

    let streamOptions: StreamOptions;
    try {
      streamOptions = parseStreamOptions(requestUrl.searchParams);
    } catch (error) {
      sendError(res, 400, error);
      return;
    }

    let info: StreamInfo;
    try {
      info = await resolveStream(videoId, streamOptions);
    } catch (error) {
      const status = error instanceof YtmkitError && error.code === 'BAD_INPUT' ? 400 : 502;
      sendError(res, status, error);
      return;
    }

    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const upstreamInit = (): UpstreamInit => ({
      method: method === 'HEAD' ? 'HEAD' : 'GET',
      ...(range ? { headers: { range } } : {}),
    });

    let upstream: Response;
    try {
      upstream = await fetchImpl(info.url, upstreamInit());
    } catch (error) {
      sendError(res, 502, error);
      return;
    }

    if (upstream.status === 403 || upstream.status === 410) {
      // Google says the URL is stale even though our clock thought it was fine.
      cache.delete(cacheKey(videoId, streamOptions));
      try {
        info = await resolveStream(videoId, streamOptions, true);
        upstream = await fetchImpl(info.url, upstreamInit());
      } catch (error) {
        const status = error instanceof YtmkitError && error.code === 'BAD_INPUT' ? 400 : 502;
        sendError(res, status, error);
        return;
      }
    }

    if (upstream.status === 416) {
      applyCors(res);
      const contentRange = upstream.headers.get('content-range');
      res.writeHead(416, contentRange ? { 'content-range': contentRange } : {});
      res.end();
      return;
    }

    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => {});
      sendJson(res, 502, {
        error: `Upstream returned HTTP ${upstream.status}`,
        code: 'UPSTREAM',
      });
      return;
    }

    applyCors(res);
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_UPSTREAM_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    res.writeHead(upstream.status, headers);

    if (method === 'HEAD' || !upstream.body) {
      await upstream.body?.cancel().catch(() => {});
      res.end();
      return;
    }

    try {
      await pipeline(Readable.fromWeb(upstream.body as any), res);
    } catch {
      res.destroy();
    }
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendError(res, 502, error);
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;
  const baseUrl = `http://${displayHost(host)}:${actualPort}`;
  let closed = false;

  return {
    server,
    url: baseUrl,

    streamUrl(videoId: string, streamOptions: StreamOptions = {}): string {
      if (!VIDEO_ID_PATTERN.test(videoId)) {
        throw badInput('videoId must be an 11-character YouTube video id');
      }
      const params = new URLSearchParams();
      if (streamOptions.codec !== undefined) params.set('codec', streamOptions.codec);
      if (streamOptions.itag !== undefined) params.set('itag', String(streamOptions.itag));
      const query = params.toString();
      return `${baseUrl}/stream/${videoId}${query ? `?${query}` : ''}`;
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections?.();
      });
    },
  };
}

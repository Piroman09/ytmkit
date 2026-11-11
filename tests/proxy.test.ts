import { afterEach, describe, expect, it } from 'vitest';
import { createStreamProxy, type StreamProxy } from '../src/proxy.js';
import type { StreamInfo, StreamOptions } from '../src/types.js';

const VIDEO_ID = 'dQw4w9WgXcQ';

const openProxies: StreamProxy[] = [];

afterEach(async () => {
  await Promise.all(openProxies.splice(0).map((proxy) => proxy.close()));
});

function streamInfo(expiresAt: Date | null = new Date(Date.now() + 3_600_000)): StreamInfo {
  const selected = {
    itag: 251,
    mimeType: 'audio/webm; codecs="opus"',
    codec: 'opus' as const,
    bitrate: 136_544,
    url: 'https://upstream.test/audio',
  };
  return {
    videoId: VIDEO_ID,
    url: selected.url,
    selected,
    formats: [selected],
    expiresAt,
  };
}

function makeClient(expiresAt: Date | null = new Date(Date.now() + 3_600_000)) {
  const calls: Array<{ videoId: string; options?: StreamOptions }> = [];
  return {
    calls,
    getStream: async (videoId: string, options?: StreamOptions): Promise<StreamInfo> => {
      calls.push({ videoId, options });
      return streamInfo(expiresAt);
    },
  };
}

interface UpstreamRequest {
  url: string;
  init?: {
    method?: string;
    headers?: Record<string, string>;
  };
}

function makeFetch(body = 'audio-bytes', status = 200, extraHeaders: Record<string, string> = {}) {
  const requests: UpstreamRequest[] = [];
  const impl = (async (input: any, init?: any) => {
    requests.push({ url: String(input), init });
    return new Response(body, {
      status,
      headers: {
        'content-type': 'audio/webm',
        'content-length': String(body.length),
        'accept-ranges': 'bytes',
        ...extraHeaders,
      },
    });
  }) as unknown as typeof fetch;
  return { impl, requests };
}

async function start(
  client: ReturnType<typeof makeClient>,
  fetchImpl: typeof fetch,
  extra: Record<string, unknown> = {},
): Promise<StreamProxy> {
  const proxy = await createStreamProxy({
    client: client as any,
    fetch: fetchImpl,
    ...extra,
  });
  openProxies.push(proxy);
  return proxy;
}

describe('stream proxy', () => {
  it('serves a health check and streams audio with CORS headers', async () => {
    const client = makeClient();
    const upstream = makeFetch('1234');
    const proxy = await start(client, upstream.impl);

    const health = await fetch(`${proxy.url}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const audio = await fetch(proxy.streamUrl(VIDEO_ID));
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/webm');
    expect(audio.headers.get('access-control-allow-origin')).toBe('*');
    expect(await audio.text()).toBe('1234');
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.videoId).toBe(VIDEO_ID);
    expect(upstream.requests[0]?.url).toBe('https://upstream.test/audio');
  });

  it('forwards Range headers and passes through 206 responses', async () => {
    const client = makeClient();
    const upstream = makeFetch('234', 206, {
      'content-range': 'bytes 1-3/4',
      'content-length': '3',
    });
    const proxy = await start(client, upstream.impl);

    const audio = await fetch(proxy.streamUrl(VIDEO_ID), {
      headers: { Range: 'bytes=1-3' },
    });

    expect(audio.status).toBe(206);
    expect(audio.headers.get('content-range')).toBe('bytes 1-3/4');
    expect(await audio.text()).toBe('234');
    expect(upstream.requests[0]?.init?.headers?.range).toBe('bytes=1-3');
  });

  it('supports HEAD without a response body', async () => {
    const client = makeClient();
    const upstream = makeFetch('1234');
    const proxy = await start(client, upstream.impl);

    const head = await fetch(proxy.streamUrl(VIDEO_ID), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(upstream.requests[0]?.init?.method).toBe('HEAD');
  });

  it('caches a fresh resolution', async () => {
    const client = makeClient();
    const upstream = makeFetch();
    const proxy = await start(client, upstream.impl);

    await fetch(proxy.streamUrl(VIDEO_ID));
    await fetch(proxy.streamUrl(VIDEO_ID));

    expect(client.calls).toHaveLength(1);
  });

  it('refreshes when the cached URL has expired', async () => {
    const client = makeClient(new Date(Date.now() - 1_000));
    const upstream = makeFetch();
    const proxy = await start(client, upstream.impl);

    await fetch(proxy.streamUrl(VIDEO_ID));
    await fetch(proxy.streamUrl(VIDEO_ID));

    expect(client.calls).toHaveLength(2);
  });

  it('retries once with a fresh URL when the upstream returns 403', async () => {
    const client = makeClient();
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response('forbidden', { status: 403 });
      }
      return new Response('ok', {
        status: 200,
        headers: { 'content-type': 'audio/webm', 'content-length': '2' },
      });
    }) as unknown as typeof fetch;

    const proxy = await start(client, fetchImpl);
    const audio = await fetch(proxy.streamUrl(VIDEO_ID));

    expect(audio.status).toBe(200);
    expect(await audio.text()).toBe('ok');
    expect(attempts).toBe(2);
    expect(client.calls).toHaveLength(2);
  });

  it('includes codec and itag choices in streamUrl()', async () => {
    const client = makeClient();
    const upstream = makeFetch();
    const proxy = await start(client, upstream.impl);

    expect(proxy.streamUrl(VIDEO_ID, { codec: 'aac' })).toBe(
      `${proxy.url}/stream/${VIDEO_ID}?codec=aac`,
    );
    expect(proxy.streamUrl(VIDEO_ID, { itag: 251 })).toContain('itag=251');
  });

  it('validates video ids and routes', async () => {
    const client = makeClient();
    const upstream = makeFetch();
    const proxy = await start(client, upstream.impl);

    const badId = await fetch(`${proxy.url}/stream/not-valid`);
    expect(badId.status).toBe(400);
    expect(((await badId.json()) as { code: string }).code).toBe('BAD_INPUT');

    const missing = await fetch(`${proxy.url}/nope`);
    expect(missing.status).toBe(404);

    const wrongMethod = await fetch(`${proxy.url}/stream/${VIDEO_ID}`, { method: 'POST' });
    expect(wrongMethod.status).toBe(405);

    const options = await fetch(proxy.streamUrl(VIDEO_ID), { method: 'OPTIONS' });
    expect(options.status).toBe(204);
    expect(options.headers.get('access-control-allow-methods')).toContain('GET');
    expect(options.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('range');
  });

  it('rejects unsupported stream options', async () => {
    const client = makeClient();
    const upstream = makeFetch();
    const proxy = await start(client, upstream.impl);

    const badCodec = await fetch(`${proxy.url}/stream/${VIDEO_ID}?codec=mp3`);
    expect(badCodec.status).toBe(400);
    expect(((await badCodec.json()) as { code: string }).code).toBe('BAD_INPUT');

    const badItag = await fetch(`${proxy.url}/stream/${VIDEO_ID}?itag=abc`);
    expect(badItag.status).toBe(400);

    expect(client.calls).toHaveLength(0);
    expect(upstream.requests).toHaveLength(0);
  });

  it('can disable CORS headers', async () => {
    const client = makeClient();
    const upstream = makeFetch();
    const proxy = await start(client, upstream.impl, { corsOrigin: false });

    const audio = await fetch(proxy.streamUrl(VIDEO_ID));
    expect(audio.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('stops accepting requests after close()', async () => {
    const client = makeClient();
    const upstream = makeFetch();
    const proxy = await createStreamProxy({ client: client as any, fetch: upstream.impl });
    await proxy.close();

    await expect(fetch(`${proxy.url}/health`)).rejects.toThrow();
  });
});

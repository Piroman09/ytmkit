import { badInput, unavailable } from './errors.js';
import type { AudioCodec, AudioFormat, StreamInfo, StreamOptions } from './types.js';

export function codecFromMime(mimeType: string): AudioCodec {
  if (/opus/i.test(mimeType)) return 'opus';
  if (/mp4a|aac/i.test(mimeType)) return 'aac';
  return 'unknown';
}

/** Read Google's `expire` query parameter (unix seconds), if it is present and valid. */
export function expiryFromUrl(url: string): Date | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const raw = parsed.searchParams.get('expire');
  if (!raw) return null;

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Choose one audio format. An explicit itag wins; otherwise the requested
 * codec is filtered and the highest bitrate is picked.
 */
export function pickFormat(formats: AudioFormat[], options: StreamOptions = {}): AudioFormat {
  if (formats.length === 0) {
    throw unavailable('No audio formats were returned for this track');
  }

  if (options.itag !== undefined) {
    const exact = formats.find((format) => format.itag === options.itag);
    if (!exact) {
      throw badInput(`No audio format with itag ${options.itag} is available`);
    }
    return exact;
  }

  const codec = options.codec ?? 'any';
  const candidates = codec === 'any' ? formats : formats.filter((format) => format.codec === codec);
  if (candidates.length === 0) {
    throw badInput(`No ${codec} audio format is available for this track`);
  }

  return candidates.reduce((best, format) => (format.bitrate > best.bitrate ? format : best));
}

export type StreamResolver = (videoId: string, options?: StreamOptions) => Promise<StreamInfo>;

/**
 * A resolved stream that can be refreshed when its URL expires.
 * The library never schedules background refreshes; callers stay in control.
 */
export class PlaybackSession {
  readonly videoId: string;
  readonly #resolve: StreamResolver;
  readonly #options: StreamOptions;
  #info: StreamInfo;

  constructor(
    videoId: string,
    info: StreamInfo,
    resolve: StreamResolver,
    options: StreamOptions = {},
  ) {
    this.videoId = videoId;
    this.#info = info;
    this.#resolve = resolve;
    this.#options = options;
  }

  /** The latest resolved stream information. */
  get current(): StreamInfo {
    return this.#info;
  }

  get url(): string {
    return this.#info.url;
  }

  get expiresAt(): Date | null {
    return this.#info.expiresAt;
  }

  get isExpired(): boolean {
    return this.expiresAt !== null && Date.now() >= this.expiresAt.getTime();
  }

  /** Milliseconds until expiry, or null when the URL has no expiry parameter. */
  expiresInMs(): number | null {
    return this.expiresAt === null ? null : this.expiresAt.getTime() - Date.now();
  }

  /** Resolve fresh URLs and update this session. */
  async refresh(): Promise<StreamInfo> {
    this.#info = await this.#resolve(this.videoId, this.#options);
    return this.#info;
  }
}

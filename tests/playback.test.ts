import { describe, expect, it } from 'vitest';
import { YtmkitError } from '../src/errors.js';
import { codecFromMime, expiryFromUrl, pickFormat, PlaybackSession } from '../src/playback.js';
import type { AudioFormat, StreamInfo } from '../src/types.js';

function format(itag: number, mimeType: string, bitrate: number): AudioFormat {
  return {
    itag,
    mimeType,
    codec: codecFromMime(mimeType),
    bitrate,
    url: `https://example.test/${itag}`,
  };
}

const opus251 = format(251, 'audio/webm; codecs="opus"', 136_544);
const opus250 = format(250, 'audio/webm; codecs="opus"', 65_508);
const aac140 = format(140, 'audio/mp4; codecs="mp4a.40.2"', 130_677);

function streamInfo(overrides: Partial<StreamInfo> = {}): StreamInfo {
  return {
    videoId: 'dQw4w9WgXcQ',
    url: opus251.url,
    selected: opus251,
    formats: [opus251, opus250, aac140],
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

describe('codecFromMime', () => {
  it('recognizes opus and aac', () => {
    expect(codecFromMime('audio/webm; codecs="opus"')).toBe('opus');
    expect(codecFromMime('audio/mp4; codecs="mp4a.40.2"')).toBe('aac');
    expect(codecFromMime('audio/ogg')).toBe('unknown');
  });
});

describe('expiryFromUrl', () => {
  it('parses the expire parameter as unix seconds', () => {
    const expiry = expiryFromUrl('https://rr1.googlevideo.com/videoplayback?expire=1794398310&x=1');
    expect(expiry?.getTime()).toBe(1_794_398_310_000);
  });

  it('returns null when the parameter is missing or invalid', () => {
    expect(expiryFromUrl('https://rr1.googlevideo.com/videoplayback?x=1')).toBeNull();
    expect(expiryFromUrl('https://rr1.googlevideo.com/videoplayback?expire=nope')).toBeNull();
    expect(expiryFromUrl('not a url')).toBeNull();
  });
});

describe('pickFormat', () => {
  it('picks the highest bitrate by default', () => {
    expect(pickFormat([aac140, opus250, opus251]).itag).toBe(251);
  });

  it('filters by codec when asked', () => {
    expect(pickFormat([opus251, aac140], { codec: 'aac' }).itag).toBe(140);
  });

  it('honors an explicit itag', () => {
    expect(pickFormat([opus251, opus250], { itag: 250 }).itag).toBe(250);
  });

  it('rejects an unavailable itag or codec with BAD_INPUT', () => {
    try {
      pickFormat([opus251], { itag: 999 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(YtmkitError);
      expect((error as YtmkitError).code).toBe('BAD_INPUT');
    }

    expect(() => pickFormat([aac140], { codec: 'opus' })).toThrow(YtmkitError);
  });

  it('rejects an empty format list as UNAVAILABLE', () => {
    try {
      pickFormat([]);
      expect.unreachable();
    } catch (error) {
      expect((error as YtmkitError).code).toBe('UNAVAILABLE');
    }
  });
});

describe('PlaybackSession', () => {
  it('exposes the current URL and refresh updates it', async () => {
    let calls = 0;
    const session = new PlaybackSession('dQw4w9WgXcQ', streamInfo(), async () => {
      calls += 1;
      return streamInfo({ url: 'https://example.test/fresh' });
    });

    expect(session.url).toBe(opus251.url);
    const fresh = await session.refresh();
    expect(calls).toBe(1);
    expect(fresh.url).toBe('https://example.test/fresh');
    expect(session.url).toBe('https://example.test/fresh');
  });

  it('reports expiry from the URL', () => {
    const expired = new PlaybackSession(
      'x',
      streamInfo({ expiresAt: new Date(Date.now() - 1_000) }),
      async () => streamInfo(),
    );
    expect(expired.isExpired).toBe(true);
    expect(expired.expiresInMs()).toBeLessThan(0);

    const live = new PlaybackSession('x', streamInfo(), async () => streamInfo());
    expect(live.isExpired).toBe(false);
    expect(live.expiresInMs()).toBeGreaterThan(0);
  });

  it('reports null expiry when the URL has none', () => {
    const session = new PlaybackSession('x', streamInfo({ expiresAt: null }), async () => streamInfo());
    expect(session.expiresAt).toBeNull();
    expect(session.expiresInMs()).toBeNull();
    expect(session.isExpired).toBe(false);
  });
});

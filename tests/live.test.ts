import { describe, expect, it } from 'vitest';
import { createClient } from '../src/index.js';

const live = process.env.YTMKIT_LIVE === '1';

describe.skipIf(!live)('live YouTube Music', () => {
  it('searches, loads an album, reads lyrics, and resolves a stream', async () => {
    const client = await createClient();

    const results = await client.search('daft punk', { limit: 2 });
    expect(results.songs.length).toBeGreaterThan(0);
    expect(results.songs[0]?.id).toBeTruthy();

    const album = await client.getAlbum('MPREb_K8qWMWVqXGi');
    expect(album.tracks.length).toBeGreaterThan(0);
    expect(album.title).toBe('Random Access Memories');

    const lyrics = await client.getLyrics('dQw4w9WgXcQ');
    expect(lyrics).toContain('Never gonna give you up');

    const stream = await client.getStream('dQw4w9WgXcQ');
    expect(stream.formats.length).toBeGreaterThan(0);
    expect(stream.selected.codec).toMatch(/opus|aac/);
    expect(stream.url).toMatch(/^https:\/\//);
    expect(stream.expiresAt).toBeInstanceOf(Date);

    const session = await client.openPlayback('dQw4w9WgXcQ', { codec: 'aac' });
    expect(session.current.selected.itag).toBe(140);
    expect(session.isExpired).toBe(false);
  }, 60_000);
});

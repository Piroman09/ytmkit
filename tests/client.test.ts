import { describe, expect, it } from 'vitest';
import { Platform } from 'youtubei.js';
import { configureJavaScriptEvaluator } from '../src/evaluator.js';
import { YtmClient } from '../src/client.js';
import { YtmkitError } from '../src/errors.js';

const thumbnails = [
  { url: 'https://img.example/60.jpg', width: 60, height: 60 },
  { url: 'https://img.example/120.jpg', width: 120, height: 120 },
];

function text(value: string) {
  return { toString: () => value };
}

function songItem(overrides: Record<string, any> = {}) {
  return {
    id: 'song1',
    title: 'Song One',
    item_type: 'song',
    duration: { text: '3:00', seconds: 180 },
    artists: [{ name: 'Artist One', channel_id: 'UCartist' }],
    album: { id: 'MPREb_1', name: 'Album One' },
    thumbnails,
    ...overrides,
  };
}

function albumItem() {
  return {
    id: 'MPREb_1',
    title: 'Album One',
    item_type: 'album',
    year: '2020',
    author: { name: 'Artist One', channel_id: 'UCartist' },
    thumbnails,
  };
}

function artistItem() {
  return {
    id: 'UCartist',
    name: 'Artist One',
    item_type: 'artist',
    subtitle: text('Artist • 1M monthly audience'),
    thumbnails,
  };
}

function playlistItem() {
  return {
    id: 'VLPL1',
    title: 'Playlist One',
    item_type: 'playlist',
    author: { name: 'Owner One', channel_id: 'UCowner' },
    thumbnails,
  };
}

function makeSearch() {
  const pages: Record<string, any> = {
    Songs: { songs: { contents: [songItem()] } },
    Videos: { videos: { contents: [songItem({ id: 'video1', title: 'Video One', item_type: 'video' })] } },
    Albums: { albums: { contents: [albumItem()] } },
    Artists: { artists: { contents: [artistItem()] } },
    'Community playlists': { playlists: { contents: [playlistItem()] } },
  };

  return {
    filters: Object.keys(pages),
    applyFilter: async (name: string) => pages[name],
  };
}

function makeClient(music: any): YtmClient {
  return new YtmClient({ music, session: { player: {} } } as any);
}

function expectCode(error: unknown, code: string) {
  expect(error).toBeInstanceOf(YtmkitError);
  expect((error as YtmkitError).code).toBe(code);
}

describe('search', () => {
  it('normalizes every category into one stable shape', async () => {
    const client = makeClient({ search: async () => makeSearch() });
    const results = await client.search('artist one');

    expect(results.songs[0]?.title).toBe('Song One');
    expect(results.videos[0]?.id).toBe('video1');
    expect(results.albums[0]?.title).toBe('Album One');
    expect(results.artists[0]?.name).toBe('Artist One');
    expect(results.playlists[0]?.owner?.name).toBe('Owner One');
  });

  it('applies the per-category limit', async () => {
    const client = makeClient({ search: async () => makeSearch() });
    const results = await client.search('x', { limit: 1 });
    expect(results.songs).toHaveLength(1);
    expect(results.videos).toHaveLength(1);
  });

  it('returns empty arrays when a query has no filters', async () => {
    const client = makeClient({ search: async () => ({ filters: [], applyFilter: async () => null }) });
    await expect(client.search('nothing')).resolves.toEqual({
      songs: [],
      videos: [],
      albums: [],
      artists: [],
      playlists: [],
    });
  });

  it('returns empty arrays when YouTube reports no contents', async () => {
    const client = makeClient({
      search: async () => {
        throw new Error('Response did not contain any contents.');
      },
    });
    const results = await client.search('nothing');
    expect(results.songs).toEqual([]);
  });

  it('rejects empty queries and bad limits as BAD_INPUT', async () => {
    const client = makeClient({ search: async () => makeSearch() });
    await expect(client.search('   ')).rejects.toSatisfy((error) => {
      expectCode(error, 'BAD_INPUT');
      return true;
    });
    await expect(client.search('x', { limit: 0 })).rejects.toSatisfy((error) => {
      expectCode(error, 'BAD_INPUT');
      return true;
    });
  });
});

describe('getSong', () => {
  it('normalizes basic track info', async () => {
    const client = makeClient({
      getInfo: async () => ({
        playability_status: { status: 'OK' },
        basic_info: {
          id: 'song1',
          title: 'Song One',
          author: 'Artist One',
          duration: 180,
          thumbnail: thumbnails,
        },
      }),
    });

    const track = await client.getSong('song1');
    expect(track).toEqual({
      id: 'song1',
      title: 'Song One',
      artists: [{ name: 'Artist One' }],
      durationSeconds: 180,
      thumbnails,
    });
  });

  it('rejects unavailable tracks with UNAVAILABLE', async () => {
    const client = makeClient({
      getInfo: async () => ({
        playability_status: { status: 'ERROR', reason: 'Age restricted' },
        basic_info: {},
      }),
    });

    await expect(client.getSong('x')).rejects.toSatisfy((error) => {
      expectCode(error, 'UNAVAILABLE');
      return true;
    });
  });
});

describe('getAlbum', () => {
  it('fills missing track artists and album from the album header', async () => {
    const client = makeClient({
      getAlbum: async () => ({
        header: {
          title: text('Album One'),
          subtitle: text('Album • 2020'),
          strapline_text_one: text('Artist One'),
          second_subtitle: text('2 songs • 6 minutes'),
          thumbnail: { contents: thumbnails },
          description: { description: text('A record.') },
        },
        contents: [
          { id: 't1', title: 'Track One', item_type: 'video' },
          { id: 't2', title: 'Track Two', item_type: 'video' },
        ],
      }),
    });

    const album = await client.getAlbum('MPREb_1');
    expect(album.title).toBe('Album One');
    expect(album.artists).toEqual([{ name: 'Artist One' }]);
    expect(album.year).toBe('2020');
    expect(album.trackCount).toBe(2);
    expect(album.description).toBe('A record.');
    expect(album.tracks.map((track) => track.id)).toEqual(['t1', 't2']);
    expect(album.tracks[0]?.artists).toEqual([{ name: 'Artist One' }]);
    expect(album.tracks[0]?.album).toEqual({ id: 'MPREb_1', name: 'Album One' });
  });
});

describe('getPlaylist', () => {
  function playlistPage() {
    const secondPage = {
      contents: [{ id: 't2', title: 'Track Two' }],
      has_continuation: false,
    };

    return {
      header: {
        title: text('Playlist One'),
        subtitle: text('Playlist • 2020'),
        strapline_text_one: text('N/A'),
        second_subtitle: text('2 tracks • 6 minutes'),
        thumbnail: { contents: thumbnails },
      },
      contents: [{ id: 't1', title: 'Track One' }, { type: 'ContinuationItem' }],
      has_continuation: true,
      getContinuation: async () => secondPage,
    };
  }

  it('stops at the limit without requesting another page', async () => {
    let continuations = 0;
    const page = playlistPage();
    const original = page.getContinuation;
    page.getContinuation = async () => {
      continuations += 1;
      return original();
    };

    const client = makeClient({ getPlaylist: async () => page });
    const playlist = await client.getPlaylist('VLPL1', { limit: 1 });

    expect(playlist.tracks.map((track) => track.id)).toEqual(['t1']);
    expect(continuations).toBe(0);
    expect(playlist.owner).toBeUndefined();
  });

  it('pages through until the limit is met and de-duplicates tracks', async () => {
    const page = playlistPage();
    const secondPage = await page.getContinuation();
    secondPage.contents.push({ id: 't1', title: 'Track One duplicate' });
    page.getContinuation = async () => secondPage;

    const client = makeClient({ getPlaylist: async () => page });
    const playlist = await client.getPlaylist('VLPL1', { limit: 10 });

    expect(playlist.tracks.map((track) => track.id)).toEqual(['t1', 't2']);
    expect(playlist.trackCount).toBe(2);
  });
});

describe('getArtist', () => {
  it('splits albums and singles by shelf title and collects related artists', async () => {
    const client = makeClient({
      getArtist: async () => ({
        header: { title: text('Artist One'), description: text('A duo.'), thumbnail: { contents: thumbnails } },
        sections: [
          { type: 'MusicShelf', header: { title: text('Top songs') }, contents: [songItem()] },
          {
            type: 'MusicCarouselShelf',
            header: { title: text('Albums') },
            contents: [{ id: 'MPREb_1', title: text('Album One'), item_type: 'album' }],
          },
          {
            type: 'MusicCarouselShelf',
            header: { title: text('Singles & EPs') },
            contents: [{ id: 'MPREb_2', title: text('Single One'), item_type: 'album', subtitle: text('Single • 2023') }],
          },
          {
            type: 'MusicCarouselShelf',
            header: { title: text('Fans might also like') },
            contents: [{ id: 'UCother', title: text('Other Artist'), item_type: 'artist', subtitle: text('2M monthly audience') }],
          },
        ],
      }),
    });

    const artist = await client.getArtist('UCartist');
    expect(artist.name).toBe('Artist One');
    expect(artist.description).toBe('A duo.');
    expect(artist.topSongs[0]?.id).toBe('song1');
    expect(artist.albums.map((album) => album.id)).toEqual(['MPREb_1']);
    expect(artist.singles.map((album) => album.id)).toEqual(['MPREb_2']);
    expect(artist.relatedArtists[0]?.name).toBe('Other Artist');
    expect(artist.albums[0]?.artists).toEqual([{ id: 'UCartist', name: 'Artist One' }]);
  });
});

describe('getStream', () => {
  function format(itag: number, mimeType: string, bitrate: number, hasVideo = false) {
    return {
      itag,
      mime_type: mimeType,
      bitrate,
      has_audio: true,
      has_video: hasVideo,
      audio_sample_rate: 48_000,
      audio_channels: 2,
      content_length: 1_000,
      decipher: async () => `https://example.test/${itag}?expire=1794398310`,
    };
  }

  it('returns only audio formats, best bitrate first, with expiry', async () => {
    const client = makeClient({
      getInfo: async () => ({
        playability_status: { status: 'OK' },
        streaming_data: {
          adaptive_formats: [
            format(140, 'audio/mp4; codecs="mp4a.40.2"', 130_677),
            format(251, 'audio/webm; codecs="opus"', 136_544),
            format(137, 'video/mp4', 4_000_000, true),
          ],
        },
      }),
    });

    const stream = await client.getStream('song1');
    expect(stream.formats.map((entry) => entry.itag)).toEqual([251, 140]);
    expect(stream.selected.itag).toBe(251);
    expect(stream.selected.codec).toBe('opus');
    expect(stream.expiresAt?.getTime()).toBe(1_794_398_310_000);
  });

  it('honors a codec preference', async () => {
    const client = makeClient({
      getInfo: async () => ({
        playability_status: { status: 'OK' },
        streaming_data: {
          adaptive_formats: [
            format(140, 'audio/mp4; codecs="mp4a.40.2"', 130_677),
            format(251, 'audio/webm; codecs="opus"', 136_544),
          ],
        },
      }),
    });

    const stream = await client.getStream('song1', { codec: 'aac' });
    expect(stream.selected.itag).toBe(140);
  });

  it('rejects unavailable tracks and missing audio', async () => {
    const unavailableClient = makeClient({
      getInfo: async () => ({ playability_status: { status: 'ERROR', reason: 'Nope' } }),
    });
    await expect(unavailableClient.getStream('x')).rejects.toSatisfy((error) => {
      expectCode(error, 'UNAVAILABLE');
      return true;
    });

    const emptyClient = makeClient({
      getInfo: async () => ({
        playability_status: { status: 'OK' },
        streaming_data: { adaptive_formats: [] },
      }),
    });
    await expect(emptyClient.getStream('x')).rejects.toSatisfy((error) => {
      expectCode(error, 'UNAVAILABLE');
      return true;
    });
  });
});

describe('openPlayback', () => {
  it('refreshes through the client', async () => {
    let calls = 0;
    const client = makeClient({
      getInfo: async () => {
        calls += 1;
        return {
          playability_status: { status: 'OK' },
          streaming_data: {
            adaptive_formats: [
              {
                itag: 251,
                mime_type: 'audio/webm; codecs="opus"',
                bitrate: 136_544,
                has_audio: true,
                has_video: false,
                decipher: async () => `https://example.test/${calls}?expire=1794398310`,
              },
            ],
          },
        };
      },
    });

    const session = await client.openPlayback('song1');
    expect(session.url).toContain('/1');
    await session.refresh();
    expect(session.url).toContain('/2');
  });
});

describe('getLyrics', () => {
  it('returns the plain text or null', async () => {
    const client = makeClient({ getLyrics: async () => ({ description: text('La la la') }) });
    await expect(client.getLyrics('x')).resolves.toBe('La la la');

    const empty = makeClient({ getLyrics: async () => undefined });
    await expect(empty.getLyrics('x')).resolves.toBeNull();
  });
});

describe('evaluator', () => {
  it('runs generated player scripts in an isolated function wrapper', async () => {
    configureJavaScriptEvaluator();
    const result = await Platform.shim.eval(
      { output: 'const exportedVars = 41; return { answer: exportedVars + 1 };', exported: [] } as any,
      {},
    );
    expect(result).toEqual({ answer: 42 });
  });
});

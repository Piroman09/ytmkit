import { describe, expect, it } from 'vitest';
import {
  parseTrackCount,
  parseYear,
  toAlbumSummary,
  toArtistSummary,
  toPlaylistSummary,
  toText,
  toThumbnails,
  toTrack,
} from '../src/normalize.js';

const thumbnails = [
  { url: 'https://img.example/60.jpg', width: 60, height: 60 },
  { url: 'https://img.example/120.jpg', width: 120, height: 120 },
];

/** youtubei.js Text nodes are objects whose toString() returns the text. */
function text(value: string) {
  return { toString: () => value };
}

describe('toText', () => {
  it('reads strings and Text nodes', () => {
    expect(toText('hello')).toBe('hello');
    expect(toText(text('hello'))).toBe('hello');
  });

  it('treats empty and unknown values as undefined', () => {
    expect(toText('')).toBeUndefined();
    expect(toText(undefined)).toBeUndefined();
    expect(toText({})).toBeUndefined();
  });
});

describe('toThumbnails', () => {
  it('accepts an array or a MusicThumbnail-style contents object', () => {
    expect(toThumbnails(thumbnails)).toHaveLength(2);
    expect(toThumbnails({ contents: thumbnails })).toHaveLength(2);
  });

  it('drops entries without a url and keeps missing dimensions at zero', () => {
    expect(toThumbnails([{ url: '' }, { width: 10 }])).toEqual([]);
    expect(toThumbnails([{ url: 'https://img.example/x.jpg' }])).toEqual([
      { url: 'https://img.example/x.jpg', width: 0, height: 0 },
    ]);
  });
});

describe('toTrack', () => {
  it('normalizes a song search item', () => {
    const track = toTrack({
      id: 'khnokW3Mw24',
      title: 'Instant Crush (feat. Julian Casablancas)',
      item_type: 'song',
      duration: { text: '5:38', seconds: 338 },
      album: { id: 'MPREb_K8qWMWVqXGi', name: 'Random Access Memories' },
      artists: [
        { name: 'Daft Punk', channel_id: 'UCRr1xG_2WIDs18a6cIiCxeA' },
        { name: 'Julian Casablancas', channel_id: 'UCWhpbdGLnR8XtXLr0yl2nYA' },
      ],
      thumbnails,
    });

    expect(track).toEqual({
      id: 'khnokW3Mw24',
      title: 'Instant Crush (feat. Julian Casablancas)',
      artists: [
        { id: 'UCRr1xG_2WIDs18a6cIiCxeA', name: 'Daft Punk' },
        { id: 'UCWhpbdGLnR8XtXLr0yl2nYA', name: 'Julian Casablancas' },
      ],
      album: { id: 'MPREb_K8qWMWVqXGi', name: 'Random Access Memories' },
      durationSeconds: 338,
      thumbnails,
    });
  });

  it('fills album artist and album from the album context', () => {
    const track = toTrack(
      {
        id: 'IluRBvnYMoY',
        title: 'Give Life Back to Music',
        item_type: 'video',
      },
      {
        artists: [{ id: 'UCRr1xG_2WIDs18a6cIiCxeA', name: 'Daft Punk' }],
        album: { id: 'MPREb_K8qWMWVqXGi', name: 'Random Access Memories' },
      },
    );

    expect(track?.artists).toEqual([{ id: 'UCRr1xG_2WIDs18a6cIiCxeA', name: 'Daft Punk' }]);
    expect(track?.album).toEqual({ id: 'MPREb_K8qWMWVqXGi', name: 'Random Access Memories' });
  });

  it('parses a clock duration when seconds are absent', () => {
    const track = toTrack({ id: 'a', title: 'Long one', duration: { text: '1:02:03' } });
    expect(track?.durationSeconds).toBe(3723);
  });

  it('returns null when an item has no usable id or title', () => {
    expect(toTrack({ title: 'No id' })).toBeNull();
    expect(toTrack({ id: 'no-title' })).toBeNull();
  });
});

describe('toAlbumSummary', () => {
  it('normalizes an album search item and takes the artist from author', () => {
    const album = toAlbumSummary({
      id: 'MPREb_K8qWMWVqXGi',
      title: 'Random Access Memories',
      item_type: 'album',
      year: '2013',
      author: { name: 'Daft Punk', channel_id: 'UCRr1xG_2WIDs18a6cIiCxeA' },
      thumbnails,
    });

    expect(album).toEqual({
      id: 'MPREb_K8qWMWVqXGi',
      title: 'Random Access Memories',
      artists: [{ id: 'UCRr1xG_2WIDs18a6cIiCxeA', name: 'Daft Punk' }],
      year: '2013',
      thumbnails,
    });
  });

  it('uses fallback artists and parses the year from a subtitle', () => {
    const album = toAlbumSummary(
      { id: 'MPREb_X', title: 'GLBTM (Studio Outtakes)', item_type: 'album', subtitle: text('Single • 2023') },
      [{ name: 'Daft Punk' }],
    );

    expect(album?.artists).toEqual([{ name: 'Daft Punk' }]);
    expect(album?.year).toBe('2023');
  });
});

describe('toArtistSummary', () => {
  it('reads search artists from name and parses monthly audience', () => {
    const artist = toArtistSummary({
      id: 'UCRr1xG_2WIDs18a6cIiCxeA',
      name: 'Daft Punk',
      item_type: 'artist',
      subtitle: text('Artist • 67.4M monthly audience'),
      thumbnails,
    });

    expect(artist).toEqual({
      id: 'UCRr1xG_2WIDs18a6cIiCxeA',
      name: 'Daft Punk',
      subscribers: '67.4M monthly audience',
      thumbnails,
    });
  });

  it('reads related artists from title and a bare audience subtitle', () => {
    const artist = toArtistSummary({
      id: 'UCGz-eguN8tcic5kUG4s1ZgA',
      title: text('Tame Impala'),
      item_type: 'artist',
      subtitle: text('232M monthly audience'),
      thumbnail: thumbnails,
    });

    expect(artist?.name).toBe('Tame Impala');
    expect(artist?.subscribers).toBe('232M monthly audience');
  });
});

describe('toPlaylistSummary', () => {
  it('normalizes a playlist search item with its owner', () => {
    const playlist = toPlaylistSummary({
      id: 'VLPLdXJrX9OsbOVq2TKvUc3xGUp2Rm8nTUVh',
      title: 'Best Of Daft Punk',
      item_type: 'playlist',
      author: { name: 'misterepicpants', channel_id: 'UC8TvRAUfEhL4LtWN9o1l60w' },
      thumbnails,
    });

    expect(playlist).toEqual({
      id: 'VLPLdXJrX9OsbOVq2TKvUc3xGUp2Rm8nTUVh',
      title: 'Best Of Daft Punk',
      owner: { id: 'UC8TvRAUfEhL4LtWN9o1l60w', name: 'misterepicpants' },
      thumbnails,
    });
  });

  it('parses a track count from the header subtitle', () => {
    const playlist = toPlaylistSummary({
      id: 'VLPL',
      title: 'Mix',
      second_subtitle: text('5.9M views • 24 tracks • 1 hour, 57 minutes'),
    });

    expect(playlist?.trackCount).toBe(24);
  });
});

describe('parseYear and parseTrackCount', () => {
  it('finds a year in label text', () => {
    expect(parseYear('Single • 2023')).toBe('2023');
    expect(parseYear('Album • 1997')).toBe('1997');
    expect(parseYear('Playlist')).toBeUndefined();
  });

  it('finds track and song counts', () => {
    expect(parseTrackCount('13 songs • 1 hour, 14 minutes')).toBe(13);
    expect(parseTrackCount('5.9M views • 24 tracks • 1 hour')).toBe(24);
    expect(parseTrackCount('1,234 songs')).toBe(1234);
    expect(parseTrackCount('Playlist')).toBeUndefined();
  });
});

#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createClient } from './client.js';
import { YtmkitError, badInput } from './errors.js';
import type { AlbumSummary, ArtistSummary, PlaylistSummary, SearchResults, Track } from './types.js';

const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

const SEARCH_TYPES = ['songs', 'videos', 'albums', 'artists', 'playlists', 'all'] as const;
type SearchType = (typeof SEARCH_TYPES)[number];

const HELP = `ytmkit ${VERSION} — a friendly YouTube Music client library and CLI

Usage:
  ytmkit search <query> [--type songs|videos|albums|artists|playlists|all] [--limit N] [--json]
  ytmkit song <videoId> [--json]
  ytmkit album <albumId> [--json]
  ytmkit playlist <playlistId> [--limit N] [--json]
  ytmkit artist <artistId> [--json]
  ytmkit lyrics <videoId> [--json]
  ytmkit stream <videoId> [--codec opus|aac|any] [--json]

Options:
  --cookie <cookie>  Cookie header copied from a signed-in music.youtube.com tab
                     (or set YTMKIT_COOKIE).
  --json             Print machine-readable JSON. search --json always prints
                     all five categories, regardless of --type.
  -h, --help         Show this help.
  -v, --version      Print the version.

Examples:
  ytmkit search "daft punk" --type songs
  ytmkit album MPREb_K8qWMWVqXGi
  ytmkit stream dQw4w9WgXcQ
  ytmkit search "daft punk" --type all --json > results.json

Unofficial project. Not affiliated with Google or YouTube.`;

interface Values {
  json?: boolean;
  type?: string;
  limit?: string;
  codec?: string;
  cookie?: string;
  help?: boolean;
  version?: boolean;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || seconds < 0) return '';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function artistNames(track: Track): string {
  return track.artists.map((artist) => artist.name).join(', ') || 'Unknown artist';
}

function printTracks(tracks: Track[]): void {
  tracks.forEach((track, index) => {
    const duration = track.durationSeconds !== undefined ? ` [${formatDuration(track.durationSeconds)}]` : '';
    console.log(`${index + 1}. ${track.title} — ${artistNames(track)}${duration}  (${track.id})`);
  });
}

function printAlbumSummaries(albums: AlbumSummary[]): void {
  albums.forEach((album, index) => {
    const artists = album.artists.map((artist) => artist.name).join(', ');
    const year = album.year ? ` (${album.year})` : '';
    console.log(`${index + 1}. ${album.title}${artists ? ` — ${artists}` : ''}${year}  (${album.id})`);
  });
}

function printArtistSummaries(artists: ArtistSummary[]): void {
  artists.forEach((artist, index) => {
    const subscribers = artist.subscribers ? ` — ${artist.subscribers}` : '';
    console.log(`${index + 1}. ${artist.name}${subscribers}  (${artist.id})`);
  });
}

function printPlaylistSummaries(playlists: PlaylistSummary[]): void {
  playlists.forEach((playlist, index) => {
    const owner = playlist.owner ? ` — ${playlist.owner.name}` : '';
    const count = playlist.trackCount !== undefined ? ` — ${playlist.trackCount} tracks` : '';
    console.log(`${index + 1}. ${playlist.title}${owner}${count}  (${playlist.id})`);
  });
}

function printSearchResults(results: SearchResults, type: SearchType): void {
  const sections: Array<[SearchType, unknown[]]> = [
    ['songs', results.songs],
    ['videos', results.videos],
    ['albums', results.albums],
    ['artists', results.artists],
    ['playlists', results.playlists],
  ];

  const selected = type === 'all' ? sections : sections.filter(([name]) => name === type);
  if (selected.length === 0) throw badInput(`Unknown search type "${type}"`);

  let printed = 0;
  for (const [name, items] of selected) {
    if (items.length === 0) continue;
    printed += 1;
    console.log(`\n${name.toUpperCase()}`);
    if (name === 'songs' || name === 'videos') printTracks(items as Track[]);
    else if (name === 'albums') printAlbumSummaries(items as AlbumSummary[]);
    else if (name === 'artists') printArtistSummaries(items as ArtistSummary[]);
    else printPlaylistSummaries(items as PlaylistSummary[]);
  }

  if (printed === 0) console.log('No results.');
}

function requireArg(args: string[], label: string): string {
  const value = args[0];
  if (!value) throw badInput(`${label} is required`);
  return value;
}

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw badInput('--limit must be a positive integer');
  }
  return value;
}

async function run(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      type: { type: 'string' },
      limit: { type: 'string' },
      codec: { type: 'string' },
      cookie: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  }) as { values: Values; positionals: string[] };

  if (values.help) {
    console.log(HELP);
    return;
  }

  if (values.version) {
    console.log(`ytmkit ${VERSION}`);
    return;
  }

  const [command, ...args] = positionals;
  if (!command) {
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  const cookie = values.cookie ?? process.env.YTMKIT_COOKIE;
  const client = await createClient(cookie ? { cookie } : {});

  switch (command) {
    case 'search': {
      const query = requireArg(args, 'Search query');
      const type = (values.type ?? 'songs') as SearchType;
      if (!SEARCH_TYPES.includes(type)) {
        throw badInput(`--type must be one of: ${SEARCH_TYPES.join(', ')}`);
      }
      const limit = parseLimit(values.limit);
      const results = await client.search(query, limit === undefined ? {} : { limit });
      if (values.json) printJson(results);
      else printSearchResults(results, type);
      return;
    }

    case 'song': {
      const track = await client.getSong(requireArg(args, 'videoId'));
      if (values.json) printJson(track);
      else {
        console.log(`${track.title} — ${artistNames(track)}`);
        if (track.durationSeconds !== undefined) console.log(`Duration: ${formatDuration(track.durationSeconds)}`);
        if (track.album) console.log(`Album: ${track.album.name}`);
        if (track.thumbnails[0]) console.log(`Artwork: ${track.thumbnails[0].url}`);
        console.log(`Video id: ${track.id}`);
      }
      return;
    }

    case 'album': {
      const album = await client.getAlbum(requireArg(args, 'albumId'));
      if (values.json) printJson(album);
      else {
        const artists = album.artists.map((artist) => artist.name).join(', ');
        console.log(`${album.title}${artists ? ` — ${artists}` : ''}${album.year ? ` (${album.year})` : ''}`);
        if (album.trackCount !== undefined) console.log(`${album.trackCount} tracks`);
        if (album.description) console.log(`\n${album.description}`);
        console.log('');
        printTracks(album.tracks);
      }
      return;
    }

    case 'playlist': {
      const limit = parseLimit(values.limit);
      const playlist = await client.getPlaylist(
        requireArg(args, 'playlistId'),
        limit === undefined ? {} : { limit },
      );
      if (values.json) printJson(playlist);
      else {
        console.log(playlist.title);
        if (playlist.owner) console.log(`By ${playlist.owner.name}`);
        if (playlist.trackCount !== undefined) console.log(`${playlist.trackCount} tracks`);
        if (playlist.description) console.log(`\n${playlist.description}`);
        console.log('');
        printTracks(playlist.tracks);
      }
      return;
    }

    case 'artist': {
      const artist = await client.getArtist(requireArg(args, 'artistId'));
      if (values.json) printJson(artist);
      else {
        console.log(artist.name);
        if (artist.subscribers) console.log(artist.subscribers);
        if (artist.description) console.log(`\n${artist.description}`);
        if (artist.topSongs.length > 0) {
          console.log('\nTOP SONGS');
          printTracks(artist.topSongs);
        }
        if (artist.albums.length > 0) {
          console.log('\nALBUMS');
          printAlbumSummaries(artist.albums);
        }
        if (artist.singles.length > 0) {
          console.log('\nSINGLES & EPS');
          printAlbumSummaries(artist.singles);
        }
        if (artist.relatedArtists.length > 0) {
          console.log('\nRELATED ARTISTS');
          printArtistSummaries(artist.relatedArtists);
        }
      }
      return;
    }

    case 'lyrics': {
      const videoId = requireArg(args, 'videoId');
      const lyrics = await client.getLyrics(videoId);
      if (values.json) printJson({ videoId, lyrics });
      else console.log(lyrics ?? 'No lyrics found.');
      return;
    }

    case 'stream': {
      const info = await client.getStream(requireArg(args, 'videoId'), {
        ...(values.codec ? { codec: values.codec as 'opus' | 'aac' | 'any' } : {}),
      });
      if (values.json) {
        printJson(info);
      } else {
        console.log(`itag ${info.selected.itag} — ${info.selected.codec}, ${Math.round(info.selected.bitrate / 1000)} kbps`);
        console.log(`expires: ${info.expiresAt ? info.expiresAt.toISOString() : 'unknown'}`);
        console.log(info.url);
      }
      return;
    }

    default:
      throw badInput(`Unknown command "${command}". Run ytmkit --help.`);
  }
}

run().catch((error: unknown) => {
  if (error instanceof YtmkitError) {
    console.error(`error [${error.code}]: ${error.message}`);
  } else {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
});

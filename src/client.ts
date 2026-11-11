import { Innertube } from 'youtubei.js';
import { badInput, unavailable, wrapUpstream, YtmkitError } from './errors.js';
import { configureJavaScriptEvaluator } from './evaluator.js';
import {
  parseTrackCount,
  parseYear,
  toAlbumSummary,
  toArtistSummary,
  toPlaylistSummary,
  toText,
  toThumbnails,
  toTrack,
} from './normalize.js';
import { codecFromMime, expiryFromUrl, pickFormat, PlaybackSession } from './playback.js';
import type {
  Album,
  AlbumSummary,
  Artist,
  ArtistRef,
  ArtistSummary,
  AudioFormat,
  ClientOptions,
  Playlist,
  PlaylistOptions,
  PlaylistSummary,
  SearchOptions,
  SearchResults,
  StreamInfo,
  StreamOptions,
  Track,
} from './types.js';

const SEARCH_FILTERS = {
  songs: 'Songs',
  videos: 'Videos',
  albums: 'Albums',
  artists: 'Artists',
  playlists: 'Community playlists',
} as const;

const MAX_PLAYLIST_PAGES = 200;

function emptySearchResults(): SearchResults {
  return { songs: [], videos: [], albums: [], artists: [], playlists: [] };
}

function isTrack(track: Track | null): track is Track {
  return track !== null;
}

function assertNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badInput(`${name} must be a non-empty string`);
  }
}

function validateSearchLimit(limit: number | undefined): void {
  if (limit === undefined) return;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw badInput('limit must be a positive integer');
  }
}

function validatePlaylistLimit(limit: number): void {
  if (limit === Number.POSITIVE_INFINITY) return;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw badInput('limit must be a positive integer, or Infinity to load every page');
  }
}

function validateStreamOptions(options: StreamOptions): void {
  if (options.codec !== undefined && !['opus', 'aac', 'any'].includes(options.codec)) {
    throw badInput("codec must be 'opus', 'aac', or 'any'");
  }
  if (options.itag !== undefined && (!Number.isInteger(options.itag) || options.itag <= 0)) {
    throw badInput('itag must be a positive integer');
  }
}

function dedupeTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
}

function headerArtists(header: any): ArtistRef[] {
  const author = header?.author;
  if (author && typeof author.name === 'string' && author.name.length > 0) {
    return [
      {
        ...(typeof author.channel_id === 'string' && author.channel_id.length > 0
          ? { id: author.channel_id }
          : {}),
        name: author.name,
      },
    ];
  }

  const strapline = toText(header?.strapline_text_one);
  if (strapline && strapline !== 'N/A') return [{ name: strapline }];
  return [];
}

function headerDescription(header: any): string | undefined {
  const description = header?.description;
  if (!description) return undefined;
  return toText(description.description ?? description);
}

function headerYear(header: any): string | undefined {
  return toText(header?.year) ?? parseYear(toText(header?.subtitle));
}

function headerThumbnails(header: any) {
  return toThumbnails(header?.thumbnail ?? header?.thumbnails);
}

function isEmptySearchError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /did not contain any contents|could not find target tab/i.test(error.message)
  );
}

export class YtmClient {
  /** Escape hatch for features ytmkit does not wrap yet. */
  readonly innertube: Innertube;

  constructor(innertube: Innertube) {
    this.innertube = innertube;
  }

  /**
   * Search every category and always return the same shape.
   * Categories with no results are empty arrays.
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResults> {
    assertNonEmpty(query, 'query');
    validateSearchLimit(options.limit);

    let base: any;
    try {
      base = await this.innertube.music.search(query);
    } catch (error) {
      if (isEmptySearchError(error)) return emptySearchResults();
      throw wrapUpstream(error, 'Search failed');
    }

    const available = new Set(base.filters ?? []);
    const targets = Object.entries(SEARCH_FILTERS).filter(([, name]) => available.has(name));
    if (targets.length === 0) return emptySearchResults();

    const settled = await Promise.allSettled(
      targets.map(([, name]) => base.applyFilter(name)),
    );

    const pages = new Map<string, any>();
    let firstError: unknown;
    targets.forEach(([key], index) => {
      const result = settled[index];
      if (result?.status === 'fulfilled') {
        pages.set(key, result.value);
      } else if (firstError === undefined) {
        firstError = result?.reason;
      }
    });

    if (pages.size === 0 && firstError !== undefined) {
      throw wrapUpstream(firstError, 'Search failed');
    }

    const limit = options.limit;
    const tracks = (key: 'songs' | 'videos'): Track[] => {
      const normalized = (pages.get(key)?.[key]?.contents ?? [])
        .map((item: unknown) => toTrack(item))
        .filter(isTrack);
      return limit === undefined ? normalized : normalized.slice(0, limit);
    };
    const albums = (): AlbumSummary[] => {
      const normalized = (pages.get('albums')?.albums?.contents ?? [])
        .map((item: unknown) => toAlbumSummary(item))
        .filter((album: AlbumSummary | null): album is AlbumSummary => album !== null);
      return limit === undefined ? normalized : normalized.slice(0, limit);
    };
    const artists = (): ArtistSummary[] => {
      const normalized = (pages.get('artists')?.artists?.contents ?? [])
        .map((item: unknown) => toArtistSummary(item))
        .filter((artist: ArtistSummary | null): artist is ArtistSummary => artist !== null);
      return limit === undefined ? normalized : normalized.slice(0, limit);
    };
    const playlists = (): PlaylistSummary[] => {
      const normalized = (pages.get('playlists')?.playlists?.contents ?? [])
        .map((item: unknown) => toPlaylistSummary(item))
        .filter((playlist: PlaylistSummary | null): playlist is PlaylistSummary => playlist !== null);
      return limit === undefined ? normalized : normalized.slice(0, limit);
    };

    return {
      songs: tracks('songs'),
      videos: tracks('videos'),
      albums: albums(),
      artists: artists(),
      playlists: playlists(),
    };
  }

  /** Fetch one track's metadata. */
  async getSong(videoId: string): Promise<Track> {
    assertNonEmpty(videoId, 'videoId');

    try {
      const info = await this.innertube.music.getInfo(videoId);
      const status = info.playability_status;
      if (status && status.status !== 'OK') {
        throw unavailable(status.reason || `Track ${videoId} is unavailable`);
      }

      const basic: any = info.basic_info ?? {};
      if (typeof basic.title !== 'string' || basic.title.length === 0) {
        throw new YtmkitError('NOT_FOUND', `Track ${videoId} was not found`);
      }

      return {
        id: typeof basic.id === 'string' ? basic.id : videoId,
        title: basic.title,
        artists: typeof basic.author === 'string' && basic.author.length > 0
          ? [{ name: basic.author }]
          : [],
        ...(typeof basic.duration === 'number' ? { durationSeconds: basic.duration } : {}),
        thumbnails: toThumbnails(basic.thumbnail),
      };
    } catch (error) {
      throw wrapUpstream(error, `Could not load track ${videoId}`);
    }
  }

  /** Fetch an album and its full track list. */
  async getAlbum(albumId: string): Promise<Album> {
    assertNonEmpty(albumId, 'albumId');

    try {
      const page = await this.innertube.music.getAlbum(albumId);
      const header: any = page.header;
      const title = toText(header?.title);
      if (!title) throw new YtmkitError('NOT_FOUND', `Album ${albumId} was not found`);

      const artists = headerArtists(header);
      const albumRef = { id: albumId, name: title };
      const tracks = dedupeTracks(
        (page.contents ?? [])
          .map((item: unknown) => toTrack(item, { artists, album: albumRef }))
          .filter(isTrack),
      );

      const trackCount =
        tracks.length > 0 ? tracks.length : parseTrackCount(header?.second_subtitle);
      const year = headerYear(header);
      const description = headerDescription(header);

      return {
        id: albumId,
        title,
        artists,
        ...(year ? { year } : {}),
        ...(trackCount !== undefined ? { trackCount } : {}),
        ...(description ? { description } : {}),
        thumbnails: headerThumbnails(header),
        tracks,
      };
    } catch (error) {
      throw wrapUpstream(error, `Could not load album ${albumId}`);
    }
  }

  /**
   * Fetch a playlist. Only the first `limit` tracks (default 100) are loaded;
   * pass `Infinity` to page through the whole playlist.
   */
  async getPlaylist(playlistId: string, options: PlaylistOptions = {}): Promise<Playlist> {
    assertNonEmpty(playlistId, 'playlistId');
    const limit = options.limit ?? 100;
    validatePlaylistLimit(limit);

    try {
      const firstPage = await this.innertube.music.getPlaylist(playlistId);
      const header: any = firstPage.header;
      const title = toText(header?.title);
      if (!title) throw new YtmkitError('NOT_FOUND', `Playlist ${playlistId} was not found`);

      const rawItems: any[] = [];
      let page: any = firstPage;
      let pages = 0;

      while (page) {
        rawItems.push(...(page.contents ?? []));
        pages += 1;

        const loaded = rawItems.filter((item) => item?.type !== 'ContinuationItem').length;
        if (loaded >= limit || !page.has_continuation || pages >= MAX_PLAYLIST_PAGES) break;

        try {
          page = await page.getContinuation();
        } catch {
          break;
        }
      }

      const tracks = dedupeTracks(rawItems.map((item) => toTrack(item)).filter(isTrack));
      const trackCount =
        parseTrackCount(header?.second_subtitle) ??
        parseTrackCount(header?.subtitle) ??
        (tracks.length > 0 ? tracks.length : undefined);
      const owner = headerArtists(header)[0];
      const description = headerDescription(header);

      return {
        id: playlistId,
        title,
        ...(owner ? { owner } : {}),
        ...(trackCount !== undefined ? { trackCount } : {}),
        ...(description ? { description } : {}),
        thumbnails: headerThumbnails(header),
        tracks: tracks.slice(0, limit),
      };
    } catch (error) {
      throw wrapUpstream(error, `Could not load playlist ${playlistId}`);
    }
  }

  /** Fetch an artist page's top songs, album shelves, and related artists. */
  async getArtist(artistId: string): Promise<Artist> {
    assertNonEmpty(artistId, 'artistId');

    try {
      const page = await this.innertube.music.getArtist(artistId);
      const header: any = page.header;
      const name = toText(header?.title);
      if (!name) throw new YtmkitError('NOT_FOUND', `Artist ${artistId} was not found`);

      const topSongs: Track[] = [];
      const albums: AlbumSummary[] = [];
      const singles: AlbumSummary[] = [];
      const relatedArtists: ArtistSummary[] = [];
      const fallbackArtists: ArtistRef[] = [{ id: artistId, name }];

      for (const section of page.sections ?? []) {
        const sectionTitle = toText((section as any)?.header?.title) ?? '';
        const items: any[] = (section as any)?.contents ?? [];

        if ((section as any)?.type === 'MusicShelf') {
          topSongs.push(...items.map((item) => toTrack(item)).filter(isTrack));
          continue;
        }

        const isSinglesShelf = /singles?|eps?/i.test(sectionTitle);
        for (const item of items) {
          if (item?.item_type === 'artist') {
            const related = toArtistSummary(item);
            if (related) relatedArtists.push(related);
          } else if (item?.item_type === 'album') {
            const album = toAlbumSummary(item, fallbackArtists);
            if (album) (isSinglesShelf ? singles : albums).push(album);
          }
        }
      }

      const description = toText((header as any)?.description);

      return {
        id: artistId,
        name,
        ...(description ? { description } : {}),
        thumbnails: headerThumbnails(header),
        topSongs: dedupeTracks(topSongs),
        albums,
        singles,
        relatedArtists,
      };
    } catch (error) {
      throw wrapUpstream(error, `Could not load artist ${artistId}`);
    }
  }

  /** Fetch plain lyrics for a track, or null when YouTube Music has none. */
  async getLyrics(videoId: string): Promise<string | null> {
    assertNonEmpty(videoId, 'videoId');

    try {
      const shelf = await this.innertube.music.getLyrics(videoId);
      return toText(shelf?.description) ?? null;
    } catch (error) {
      if (error instanceof Error && /no lyrics|not found/i.test(error.message)) return null;
      throw wrapUpstream(error, `Could not load lyrics for ${videoId}`);
    }
  }

  /** Resolve audio-only stream URLs for a track. */
  async getStream(videoId: string, options: StreamOptions = {}): Promise<StreamInfo> {
    assertNonEmpty(videoId, 'videoId');
    validateStreamOptions(options);

    try {
      const info = await this.innertube.music.getInfo(videoId);
      const status = info.playability_status;
      if (status && status.status !== 'OK') {
        throw unavailable(status.reason || `Track ${videoId} is unavailable`);
      }

      const adaptive: any[] = info.streaming_data?.adaptive_formats ?? [];
      const audioOnly = adaptive.filter((format) => format?.has_audio && !format?.has_video);
      const player = this.innertube.session?.player;

      const formats: AudioFormat[] = [];
      for (const format of audioOnly) {
        const url = await format.decipher(player);
        if (typeof url !== 'string' || url.length === 0) continue;

        formats.push({
          itag: format.itag,
          mimeType: format.mime_type,
          codec: codecFromMime(format.mime_type),
          bitrate: format.bitrate ?? 0,
          ...(typeof format.audio_sample_rate === 'number'
            ? { sampleRate: format.audio_sample_rate }
            : {}),
          ...(typeof format.audio_channels === 'number'
            ? { channels: format.audio_channels }
            : {}),
          ...(typeof format.content_length === 'number'
            ? { contentLength: format.content_length }
            : {}),
          url,
        });
      }

      formats.sort((a, b) => b.bitrate - a.bitrate);
      const selected = pickFormat(formats, options);

      return {
        videoId,
        url: selected.url,
        selected,
        formats,
        expiresAt: expiryFromUrl(selected.url),
      };
    } catch (error) {
      throw wrapUpstream(error, `Could not resolve a stream for ${videoId}`);
    }
  }

  /** Resolve a stream and wrap it in a refreshable session. */
  async openPlayback(videoId: string, options: StreamOptions = {}): Promise<PlaybackSession> {
    const info = await this.getStream(videoId, options);
    return new PlaybackSession(videoId, info, (id, opts) => this.getStream(id, opts), options);
  }
}

/**
 * Create a YouTube Music client.
 * This does not log in unless you pass a cookie copied from a signed-in browser.
 */
export async function createClient(options: ClientOptions = {}): Promise<YtmClient> {
  configureJavaScriptEvaluator();

  try {
    const innertube = await Innertube.create({
      lang: options.lang ?? 'en',
      location: options.location ?? 'US',
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.poToken ? { po_token: options.poToken } : {}),
      ...(options.visitorData ? { visitor_data: options.visitorData } : {}),
    });
    return new YtmClient(innertube);
  } catch (error) {
    throw wrapUpstream(error, 'Could not create a YouTube Music session');
  }
}

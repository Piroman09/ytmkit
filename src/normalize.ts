import type { AlbumSummary, ArtistRef, ArtistSummary, PlaylistSummary, Thumbnail, Track } from './types.js';

// youtubei.js parser nodes are rich class instances. We deliberately accept
// `unknown` here and read only the properties we need, so a missing or renamed
// field degrades to an empty value instead of throwing.
type AnyRecord = Record<string, any>;

export function toText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (value && typeof (value as AnyRecord).toString === 'function') {
    const text = (value as AnyRecord).toString();
    if (typeof text === 'string' && text.length > 0 && text !== '[object Object]') {
      return text;
    }
  }
  return undefined;
}

export function toThumbnails(value: unknown): Thumbnail[] {
  const list = Array.isArray(value)
    ? value
    : value && Array.isArray((value as AnyRecord).contents)
      ? (value as AnyRecord).contents
      : [];

  return list
    .filter((item: any) => item && typeof item.url === 'string' && item.url.length > 0)
    .map((item: any) => ({
      url: item.url,
      width: typeof item.width === 'number' ? item.width : 0,
      height: typeof item.height === 'number' ? item.height : 0,
    }));
}

function toArtistRef(value: AnyRecord | undefined): ArtistRef | null {
  if (!value || typeof value.name !== 'string' || value.name.length === 0) return null;
  return {
    ...(typeof value.channel_id === 'string' && value.channel_id.length > 0
      ? { id: value.channel_id }
      : {}),
    name: value.name,
  };
}

export function toArtistRefs(value: unknown): ArtistRef[] {
  const item = (value ?? {}) as AnyRecord;
  const list = Array.isArray(item.artists)
    ? item.artists
    : Array.isArray(item.authors)
      ? item.authors
      : [];

  const refs = list.map(toArtistRef).filter((ref: ArtistRef | null): ref is ArtistRef => ref !== null);
  if (refs.length > 0) return refs;

  const author = toArtistRef(item.author);
  return author ? [author] : [];
}

export function parseYear(value: unknown): string | undefined {
  const text = toText(value);
  if (!text) return undefined;
  const match = text.match(/\b(?:19|20)\d{2}\b/);
  return match?.[0];
}

export function parseTrackCount(value: unknown): number | undefined {
  const text = toText(value);
  if (!text) return undefined;
  const match = text.match(/([\d,]+)\s*(?:tracks?|songs?)\b/i);
  if (!match?.[1]) return undefined;
  const count = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(count) ? count : undefined;
}

function parseDurationSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const record = (value ?? {}) as AnyRecord;
  if (typeof record.seconds === 'number' && Number.isFinite(record.seconds)) {
    return record.seconds;
  }

  const text = toText(record.text) ?? toText(value);
  if (!text || !text.includes(':')) return undefined;

  const parts = text.split(':').map((part) => Number(part));
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function itemId(item: AnyRecord): string | undefined {
  if (typeof item.id === 'string' && item.id.length > 0) return item.id;
  const payload = item.endpoint?.payload;
  const videoId = payload?.videoId;
  return typeof videoId === 'string' && videoId.length > 0 ? videoId : undefined;
}

export interface TrackFallback {
  artists?: ArtistRef[];
  album?: { id?: string; name: string };
}

/** Normalize a MusicResponsiveListItem/MusicTwoRowItem-shaped node into a Track. */
export function toTrack(value: unknown, fallback: TrackFallback = {}): Track | null {
  const item = (value ?? {}) as AnyRecord;
  const id = itemId(item);
  const title = toText(item.title) ?? toText(item.name);
  if (!id || !title) return null;

  const artists = toArtistRefs(item);
  const durationSeconds = parseDurationSeconds(item.duration);
  const album = item.album
    ? {
        ...(typeof item.album.id === 'string' ? { id: item.album.id } : {}),
        name: typeof item.album.name === 'string' ? item.album.name : '',
      }
    : undefined;

  return {
    id,
    title,
    artists: artists.length > 0 ? artists : (fallback.artists ?? []),
    ...(album && album.name
      ? { album }
      : fallback.album
        ? { album: fallback.album }
        : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    thumbnails: toThumbnails(item.thumbnails ?? item.thumbnail),
  };
}

/** Normalize an album list item. `fallbackArtists` fills gaps in artist shelves. */
export function toAlbumSummary(value: unknown, fallbackArtists: ArtistRef[] = []): AlbumSummary | null {
  const item = (value ?? {}) as AnyRecord;
  const id = itemId(item);
  const title = toText(item.title) ?? toText(item.name);
  if (!id || !title) return null;

  const artists = toArtistRefs(item);
  const year = parseYear(item.year ?? item.subtitle);
  return {
    id,
    title,
    artists: artists.length > 0 ? artists : fallbackArtists,
    ...(year !== undefined ? { year } : {}),
    thumbnails: toThumbnails(item.thumbnails ?? item.thumbnail),
  };
}

function parseSubscribers(item: AnyRecord): string | undefined {
  const direct = toText(item.subscribers);
  if (direct) return direct;

  const subtitle = toText(item.subtitle);
  if (!subtitle) return undefined;
  const parts = subtitle.split('•').map((part) => part.trim());
  return parts.find((part) => /audience|subscribers?/i.test(part));
}

/** Normalize an artist list item. Search results store the name in `name`, not `title`. */
export function toArtistSummary(value: unknown): ArtistSummary | null {
  const item = (value ?? {}) as AnyRecord;
  const id = itemId(item);
  const name = toText(item.name) ?? toText(item.title);
  if (!id || !name) return null;

  const subscribers = parseSubscribers(item);
  return {
    id,
    name,
    ...(subscribers ? { subscribers } : {}),
    thumbnails: toThumbnails(item.thumbnails ?? item.thumbnail),
  };
}

/** Normalize a playlist list item. */
export function toPlaylistSummary(value: unknown): PlaylistSummary | null {
  const item = (value ?? {}) as AnyRecord;
  const id = itemId(item);
  const title = toText(item.title) ?? toText(item.name);
  if (!id || !title) return null;

  const owner = toArtistRef(item.author) ?? toArtistRef(Array.isArray(item.artists) ? item.artists[0] : undefined);
  const trackCount =
    parseTrackCount(item.item_count) ??
    parseTrackCount(item.second_subtitle) ??
    parseTrackCount(item.subtitle);

  return {
    id,
    title,
    ...(owner ? { owner } : {}),
    ...(trackCount !== undefined ? { trackCount } : {}),
    thumbnails: toThumbnails(item.thumbnails ?? item.thumbnail),
  };
}

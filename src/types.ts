/** A reference to an artist, as it appears on a track, album, or search result. */
export interface ArtistRef {
  /** YouTube channel id, when the source provides one. */
  id?: string;
  name: string;
}

/** A single image size. */
export interface Thumbnail {
  url: string;
  width: number;
  height: number;
}

/** A song or music video. */
export interface Track {
  /** YouTube video id. */
  id: string;
  title: string;
  artists: ArtistRef[];
  album?: {
    id?: string;
    name: string;
  };
  durationSeconds?: number;
  thumbnails: Thumbnail[];
}

/** An album as it appears in a list or search result. */
export interface AlbumSummary {
  /** YouTube Music browse id (for example `MPREb_...`). */
  id: string;
  title: string;
  artists: ArtistRef[];
  year?: string;
  thumbnails: Thumbnail[];
}

/** A full album with its track list. */
export interface Album extends AlbumSummary {
  description?: string;
  trackCount?: number;
  tracks: Track[];
}

/** A playlist as it appears in a list or search result. */
export interface PlaylistSummary {
  /** YouTube Music browse id (for example `VLPL...`). */
  id: string;
  title: string;
  owner?: ArtistRef;
  trackCount?: number;
  thumbnails: Thumbnail[];
}

/** A playlist with (up to the requested limit of) its tracks. */
export interface Playlist extends PlaylistSummary {
  description?: string;
  tracks: Track[];
}

/** An artist as it appears in a list or search result. */
export interface ArtistSummary {
  /** YouTube channel id (for example `UC...`). */
  id: string;
  name: string;
  /** YouTube Music's monthly-audience string, e.g. "67.4M monthly audience". */
  subscribers?: string;
  thumbnails: Thumbnail[];
}

/** A full artist page with the shelves most clients need. */
export interface Artist extends ArtistSummary {
  description?: string;
  topSongs: Track[];
  albums: AlbumSummary[];
  singles: AlbumSummary[];
  relatedArtists: ArtistSummary[];
}

/** The consistent shape returned by every search. Empty categories are empty arrays. */
export interface SearchResults {
  songs: Track[];
  videos: Track[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  playlists: PlaylistSummary[];
}

export type AudioCodec = 'opus' | 'aac' | 'unknown';

/** One audio-only stream format. */
export interface AudioFormat {
  itag: number;
  mimeType: string;
  codec: AudioCodec;
  /** Bits per second as reported by YouTube Music. */
  bitrate: number;
  sampleRate?: number;
  channels?: number;
  contentLength?: number;
  url: string;
}

/** The result of resolving a track's audio streams. */
export interface StreamInfo {
  videoId: string;
  /** The selected format's URL, for convenience. */
  url: string;
  selected: AudioFormat;
  /** All audio-only formats, best bitrate first. */
  formats: AudioFormat[];
  /** Parsed from Google's `expire` parameter. `null` when absent. */
  expiresAt: Date | null;
}

export interface StreamOptions {
  /** Preferred codec. `any` (default) picks the highest bitrate. */
  codec?: 'opus' | 'aac' | 'any';
  /** Force a specific itag. Takes precedence over `codec`. */
  itag?: number;
}

export interface ClientOptions {
  /** Raw `Cookie` header copied from music.youtube.com in a signed-in browser. */
  cookie?: string;
  /** Language for responses. Defaults to `en`. */
  lang?: string;
  /** Geolocation. Defaults to `US`. */
  location?: string;
  /** Proof of Origin token, if your network requires one. */
  poToken?: string;
  /** Persistent visitor data to keep recommendations stable. */
  visitorData?: string;
}

export interface SearchOptions {
  /** Maximum results per category. Defaults to the shelf size returned by YouTube Music. */
  limit?: number;
}

export interface PlaylistOptions {
  /** Maximum tracks to collect across pages. Defaults to 100. */
  limit?: number;
}

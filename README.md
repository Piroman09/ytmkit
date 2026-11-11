# ytmkit

A friendly YouTube Music library for Node.js. Search, browse, and resolve playable audio streams — with stable result shapes instead of Google's raw response objects.

> **Unofficial.** Not affiliated with, endorsed by, or sponsored by Google or YouTube. It uses YouTube Music's internal API. Google can change or block it at any time. Use your own account and follow the terms you agreed to.

## What it does

- Search songs, videos, albums, artists, and playlists
- Load albums, playlists, artists, tracks, and lyrics
- Resolve **audio-only** stream URLs (Opus and AAC)
- Select a codec or a specific itag
- Report stream expiry and refresh a playback session
- Optionally sign in with your own cookie
- Run everything from a CLI with JSON output, so non-JavaScript clients can use the same data

Built on [`youtubei.js`](https://github.com/LuanRT/YouTube.js), which tracks YouTube's InnerTube changes. `ytmkit` adds the product layer: stable models, playback sessions, validation, and docs.

## Requirements

- Node.js 18.3 or newer
- ESM (`import`, not `require`)

## Install

```bash
npm install ytmkit
```

Not published yet? Install straight from this folder:

```bash
# in this library folder
npm install
npm run build

# in your client app
npm install /absolute/path/to/ytmkit
```

## Quick start

```js
import { createClient } from 'ytmkit';

const ytm = await createClient();

const results = await ytm.search('daft punk');

console.log(results.songs[0]);
// {
//   id: 'khnokW3Mw24',
//   title: 'Instant Crush (feat. Julian Casablancas)',
//   artists: [{ id: 'UCRr1xG_2WIDs18a6cIiCxeA', name: 'Daft Punk' }, ...],
//   album: { id: 'MPREb_K8qWMWVqXGi', name: 'Random Access Memories' },
//   durationSeconds: 338,
//   thumbnails: [...]
// }

const album = await ytm.getAlbum('MPREb_K8qWMWVqXGi');
console.log(album.tracks);

const stream = await ytm.getStream('dQw4w9WgXcQ');
console.log(stream.url);       // playable audio URL
console.log(stream.expiresAt); // Date
```

Every search returns the same five arrays, even when a category is empty:

```js
{
  songs: [],
  videos: [],
  albums: [],
  artists: [],
  playlists: []
}
```

## Playback

Stream URLs expire — often within about 30 minutes. Use a playback session when your app plays for a while:

```js
const session = await ytm.openPlayback('dQw4w9WgXcQ', { codec: 'opus' });

console.log(session.url);

// Before using the URL again:
if (session.isExpired) {
  await session.refresh();
}

console.log(session.expiresInMs()); // ms until refresh is needed
```

Format selection:

```js
await ytm.getStream('dQw4w9WgXcQ');                  // best bitrate
await ytm.getStream('dQw4w9WgXcQ', { codec: 'aac' }); // AAC (Safari-friendly)
await ytm.getStream('dQw4w9WgXcQ', { codec: 'opus' });
await ytm.getStream('dQw4w9WgXcQ', { itag: 251 });    // force a format
```

`getStream()` returns every audio format, best bitrate first:

```js
{
  videoId: 'dQw4w9WgXcQ',
  url: 'https://rr1---...',
  selected: { itag: 251, codec: 'opus', bitrate: 136544, ... },
  formats: [ ... ],
  expiresAt: Date
}
```

## Signing in (optional)

Most read-only requests work without an account. For your library, subscriptions, or personalized results, pass a cookie copied from a signed-in browser:

```js
const ytm = await createClient({ cookie: process.env.YTMKIT_COOKIE });
```

How to get the cookie:

1. Open [music.youtube.com](https://music.youtube.com) while signed in.
2. Open DevTools → Network → click any request.
3. In Request Headers, copy the full `Cookie:` value.
4. Keep it server-side. Treat it like a password.

You can also pass a `poToken` if your network requires one:

```js
const ytm = await createClient({ cookie, poToken: '...' });
```

## CLI

The CLI is useful for testing and for clients written in other languages.

```bash
# Human-readable output
npx ytmkit search "daft punk" --type songs
npx ytmkit album MPREb_K8qWMWVqXGi
npx ytmkit playlist VLPLdXJrX9OsbOVq2TKvUc3xGUp2Rm8nTUVh --limit 20
npx ytmkit artist UCRr1xG_2WIDs18a6cIiCxeA
npx ytmkit stream dQw4w9WgXcQ
npx ytmkit lyrics dQw4w9WgXcQ

# Machine-readable JSON
npx ytmkit search "daft punk" --type all --json > results.json
npx ytmkit stream dQw4w9WgXcQ --json
```

Cookie via environment:

```bash
# macOS / Linux
YTMKIT_COOKIE='...' npx ytmkit search "my library"

# PowerShell
$env:YTMKIT_COOKIE='...'; npx ytmkit search "my library"
```

`search --json` always prints all five categories, regardless of `--type`. The JSON shapes match the TypeScript types in `src/types.ts`.

## API

```ts
createClient(options?: ClientOptions): Promise<YtmClient>

client.search(query, { limit? }): Promise<SearchResults>
client.getSong(videoId): Promise<Track>
client.getAlbum(albumId): Promise<Album>
client.getPlaylist(playlistId, { limit? }): Promise<Playlist>
client.getArtist(artistId): Promise<Artist>
client.getLyrics(videoId): Promise<string | null>
client.getStream(videoId, options?): Promise<StreamInfo>
client.openPlayback(videoId, options?): Promise<PlaybackSession>

session.url: string
session.current: StreamInfo
session.expiresAt: Date | null
session.isExpired: boolean
session.expiresInMs(): number | null
session.refresh(): Promise<StreamInfo>
```

- `search()` `limit` caps **each** category.
- `getPlaylist()` loads 100 tracks by default. Pass `{ limit: Infinity }` to page through everything.
- `client.innertube` is an escape hatch to the underlying `youtubei.js` instance.

All public methods reject with a `YtmkitError`:

```ts
try {
  await ytm.getStream(id);
} catch (error) {
  // error.code: 'BAD_INPUT' | 'NOT_FOUND' | 'UNAVAILABLE' | 'AUTH' | 'UPSTREAM'
  // error.cause: the original error, when there is one
}
```

## Using it from another language

Run the CLI and read JSON:

```bash
ytmkit search "query" --type all --json
ytmkit album <id> --json
ytmkit stream <id> --json
```

The output is stable and documented by the types in [`src/types.ts`](src/types.ts) and [`docs/DESIGN.md`](docs/DESIGN.md). This is the first step toward a language-neutral conformance suite; see the roadmap.

## How it works

```
src/client.ts     public methods, validation, error wrapping
src/normalize.ts  youtubei.js nodes -> plain JSON models
src/playback.ts   format selection, expiry, refreshable sessions
src/evaluator.ts  sandboxed node:vm evaluator for YouTube's player script
src/cli.ts        command-line interface
```

YouTube's player script must run to decipher stream URLs. `ytmkit` runs it in a separate `node:vm` context with a timeout and no I/O globals. `createClient()` configures this automatically.

## Limitations

- **Unofficial.** Google can break the API at any time. Keep `youtubei.js` up to date.
- **Audio only.** Video formats and downloads are not included.
- **Cookie login only.** Device-code login is not implemented yet.
- **poToken.** Some networks/accounts require an attestation token; the library accepts one but cannot generate it.
- **Playlist track metadata.** YouTube Music does not always include structured artist/album data for playlist items. Those fields can be empty; call `getSong(id)` for details.
- **Rate limits.** This is not a bulk-scraping tool. Be reasonable.
- **Not for browsers directly.** Cookies and `node:vm` make this a server-side/desktop library. Keep it in your main process, not in a renderer.

## Development

```bash
npm install
npm test          # unit tests, no network
npm run typecheck
npm run build
npm run live      # live tests; set YTMKIT_LIVE=1 first
```

Live tests:

```bash
# macOS / Linux
YTMKIT_LIVE=1 npm test

# PowerShell
$env:YTMKIT_LIVE='1'; npm test
```

## Publishing your own copy

The npm name `ytmkit` was available when this was written. Check first:

```bash
npm view ytmkit version
```

If that prints "404 Not Found", the name is free.

```bash
npm login
npm test
npm run build
npm publish
```

Later releases:

```bash
npm version patch   # or minor / major
npm publish
```

## Roadmap

1. Stream proxy server (CORS + expiry handling for browser clients).
2. Device-code auth.
3. Recorded fixtures + a conformance suite for non-JS ports.
4. Library actions: like, add to playlist, uploads.
5. Optional yt-dlp extractor fallback.

## License

MIT. See [`LICENSE`](LICENSE).

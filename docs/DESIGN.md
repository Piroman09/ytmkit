# ytmkit — Design

## Intent

People building YouTube Music clients repeatedly solve the same two problems: taming InnerTube's deeply nested responses into a usable model, and resolving expiring audio stream URLs. `ytmkit` packages both behind a small, stable API so a client author can focus on their app instead of on Google's response shapes.

## Who it is for

- JavaScript/TypeScript developers building Electron, web, or Node-based YouTube Music clients.
- Developers in other languages who want the same normalized shapes over the CLI's JSON output.

## Goals

1. Normalized, JSON-serializable models for tracks, albums, playlists, artists, and search results.
2. Audio stream resolution with format selection, expiry metadata, and refreshable playback sessions.
3. A local stream proxy that handles CORS and Range requests, caches URLs, and refreshes them before expiry.
4. Optional authenticated requests via the user's own cookie.
5. A CLI with stable `--json` output.
6. Clear errors and input validation at the public boundary.
7. Survivability: the volatile InnerTube work stays in `youtubei.js`; our layer is replaceable.

## Non-goals

- Downloading tracks.
- Video stream selection.
- Device-code / OAuth login (cookie only).
- Library management (likes, uploads, playlist editing).
- Guaranteed operation when Google requires a fresh poToken.

## Anti-goals

- Re-implementing signature/nsig deciphering ourselves.
- Exposing `youtubei.js` parser nodes to consumers.
- Storing or transmitting user cookies anywhere except YouTube.
- Adding more runtime dependencies than necessary.

## Approaches considered

1. **A per-language wrapper (rejected).** Another Python/Kotlin/Swift wrapper competes with maintained projects and still leaves every other language behind.
2. **A native extractor from scratch (rejected for v0.1).** Signature and poToken work is an arms race that would consume the whole project.
3. **Session layer on a maintained extractor (chosen).** `youtubei.js` already tracks InnerTube changes and can decipher formats. We add the missing product layer: stable models, playback sessions, CLI, docs.
4. **A language-neutral spec plus fixtures (deferred).** Valuable later, but it produces no usable library on day one. The CLI's JSON output is the first step toward it.

## Architecture

```
client.ts        YtmClient: public methods, validation, error wrapping
normalize.ts     parser-node -> public model, defensive against missing fields
playback.ts      format filtering/selection, expiry parsing, PlaybackSession
proxy.ts         local CORS + Range HTTP proxy with URL caching and refresh
evaluator.ts     Node vm sandbox for YouTube's obfuscated player script
cli.ts           argument parsing + human/JSON output
types.ts         public contract (no dependency on youtubei.js types)
errors.ts        one error class, machine-readable codes
```

The only runtime dependency is `youtubei.js`. The public model never leaks its classes; `client.innertube` is an explicit escape hatch for advanced users.

## Public contract

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

createStreamProxy(options?): Promise<StreamProxy>
proxy.streamUrl(videoId, options?): string
proxy.close(): Promise<void>
```

Errors are always `YtmkitError` with `code: 'BAD_INPUT' | 'NOT_FOUND' | 'UNAVAILABLE' | 'AUTH' | 'UPSTREAM'`.

Stream URLs expire (Google's `expire` parameter). Callers can read `expiresAt` or call `session.refresh()`; the library never refreshes on a timer to avoid surprising background work.

## Stream proxy

The proxy is an opt-in local HTTP server, not part of the client. It solves the two browser-specific problems: CORS and expiring URLs.

- Routes: `GET /health`, `GET|HEAD /stream/:videoId`, `OPTIONS` preflight.
- Stream URLs accept `?codec=opus|aac` and `?itag=...`.
- It caches `StreamInfo` per track and format, and re-resolves two minutes before expiry.
- It forwards the `Range` header and passes through `206` responses so seeking works.
- It retries once with a fresh URL when the upstream returns `403` or `410`.
- It binds to `127.0.0.1` by default and sends CORS headers (`*` by default, configurable or disabled).
- It has no authentication. Exposing it beyond localhost is explicitly the caller's problem.

## Risks

- **Volatility.** InnerTube changes can break parsing or deciphering. `youtubei.js` updates are the primary mitigation; the model layer tolerates missing fields.
- **poToken.** Some networks/accounts now require an attestation token. We expose `poToken` but do not generate one.
- **Legal/ToS.** Unofficial API usage is not endorsed by Google. The README carries a disclaimer; users are responsible for their own use.
- **Executing player JS.** Deciphering requires evaluating code fetched from YouTube. We run it in a separate `node:vm` context with a timeout and no I/O globals.
- **Local proxy exposure.** The proxy has no auth and uses the client's cookie when one is configured. Localhost binding limits the blast radius, but CORS defaults to `*` for convenience; the README documents how to restrict it.

## Roadmap

1. Cookie parsing helper and device-code auth.
2. Recorded fixtures and a conformance suite for non-JS ports.
3. Proxy access tokens for shared machines.
4. Library actions (like, add to playlist, uploads).
5. Optional yt-dlp extractor fallback.

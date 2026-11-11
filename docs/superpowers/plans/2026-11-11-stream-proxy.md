# ytmkit v0.2 — Local stream proxy

**Goal:** Give browser-based clients one stable URL per track that handles CORS, HTTP Range seeking, expiring googlevideo links, and transient 403s.

**Architecture:** An opt-in `node:http` server (`src/proxy.ts`) that uses an existing `YtmClient` (or creates one) to resolve `StreamInfo`, caches it per track/format, and pipes the upstream audio response to the local caller. No new runtime dependencies.

**Tech stack:** Node `http`, global `fetch`, `stream.Readable.fromWeb`, `stream/promises.pipeline`, Vitest.

## Contract

```ts
createStreamProxy(options?): Promise<StreamProxy>
proxy.url: string
proxy.streamUrl(videoId, options?): string
proxy.close(): Promise<void>

// routes
GET /health
GET|HEAD /stream/:videoId?codec=opus|aac&itag=251
OPTIONS *
```

## Tasks

- [x] Write failing HTTP tests for health, streaming, CORS, Range, HEAD, caching, expiry refresh, 403 retry, URL building, validation, CORS-off, and close.
- [x] Watch all 10 tests fail because the proxy was a stub.
- [x] Implement the server, cache, refresh, retry, routing, and validation.
- [x] Watch all 10 tests pass.
- [x] Add a live test that requests `bytes=0-2047` through the proxy against real googlevideo and asserts a 206 plus CORS headers.
- [x] Export the API from `src/index.ts`.
- [x] Add `ytmkit proxy --port 8080` to the CLI.
- [x] Verify the CLI proxy starts and `/health` returns `{"ok":true}`.
- [x] Document the proxy in README and DESIGN.

## Security decisions

- Bind to `127.0.0.1` by default.
- CORS defaults to `*` for local app convenience; `corsOrigin: false` disables it, a string restricts it.
- No authentication in v0.2; README and DESIGN state this plainly. Access tokens are on the roadmap.
- Only 11-character video IDs are accepted, so the proxy cannot be used as a generic URL fetcher.
- The resolved googlevideo URL is never returned to the browser.

## Verification

- `npm run typecheck` — passed.
- `npm test` — 54 passed, 1 skipped (live).
- `YTMKIT_LIVE=1 npx vitest run tests/live.test.ts` — passed, including a real 206 Range response through the proxy.
- CLI smoke: `proxy --port 8127`, `GET /health` returned `{"ok":true}`.

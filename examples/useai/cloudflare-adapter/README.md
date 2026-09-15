# cloudflare-adapter

Runs this app (a Vite-based [Catalyst](https://catalyst.1mg.com) SSR app) **natively on a
Cloudflare Worker** (via `httpServerHandler` + `nodejs_compat`), not in a container. This
directory is copied in from [catalyst-cloudflare-plugin](https://github.com/sauravvarma/catalyst-cloudflare-plugin)
rather than installed as an npm package — see the note at the top of `lib/adapter.mjs` for why.

## Usage

Already wired up in this app: `npm run build:worker` (after `npm run build`) generates
`worker/index.js` + `wrangler.jsonc` from the app's `catalystCloudflare` config in
`package.json`, then `npm run dev:worker` / `deploy:worker` run `wrangler dev` / `wrangler
deploy`.

### Configuration

Set in the app's `package.json`; edit it and rerun `build:worker` to regenerate:

```jsonc
"catalystCloudflare": {
  "name": "my-app",
  "routes": ["/", "/api/*"],
  // optional: shallow-merged into the generated wrangler.jsonc, for custom bindings
  "wrangler": {
    "kv_namespaces": [{ "binding": "KV", "id": "..." }],
    "vars": { "MY_FLAG": "on" }
  }
}
```

The generated `worker/index.js` and `wrangler.jsonc` are build artifacts (gitignored) — do not
edit them by hand.

## Server-side data fetching (the isomorphism)

Catalyst runs one data operation per route in two transports: `serverFetcher` on direct
hit/SSR, `clientFetcher` on client navigation, both must hit the **same** handler. A Worker
can't fetch its own public hostname, so the adapter reroutes server-side same-origin fetches
through the `SELF` binding (in-process), forwarding the inbound request's cookies/auth. Zero app
change needed — this app's own `api.js` already writes the standard pattern:

```js
const baseURL = typeof window === "undefined" ? `http://${NODE_SERVER_HOSTNAME}:${NODE_SERVER_PORT}` : API_URL
fetch(baseURL + url, options)
```

`runtime.js` is seeded (via `CATALYST_SELF_HOST_ALIAS`, derived from `config/config.json`) to
recognize that literal `host:port` as "self" too, not just the Worker's real inbound host.

## What the adapter provides

| File | Role |
|---|---|
| `worker/runtime.js` | logger shim, same-origin fetch reroute + context forwarding, `createWorker(app)`, Content-Encoding opt-out (see below) |
| `worker/fs-shim.js` | serves the Vite build manifest (`manifest.json`/`asset-categories.json`) + CSS the renderer reads via `fs` at request time |
| `worker/react-dom-server-shim.js` | `renderToPipeableStream`/`resumeToPipeableStream` over `react-dom/server.edge`'s Web-Streams API — shell timing is real (`onShellReady` fires as soon as it's ready), but the byte flush to the destination is single-shot, not incremental (see the file's own comments) |
| `worker/react-dom-static-shim.js` | `prerenderToNodeStream` over `react-dom/static.edge`'s `prerender` (PPR/static's prerender pass) |
| `worker/{body-parser,middleware-factory,tty,empty}-stub.js` | stubs for Node-only/edge-unneeded deps (body-parser, compression, express-static-gzip, tty, OpenTelemetry) |
| `lib/adapter.mjs` | owns the worker-entry + wrangler.jsonc templates and the config schema |
| `prebuild.mjs` | generates worker/index.js + wrangler.jsonc, stages `build/client` -> `dist/public/client` for Workers Assets, generates the fs-assets map |

## Known limitations / gotchas

- SSR **buffers the full response before flushing it to the client** — writing a real
  Node Transform stream's many small chunks through to `res` via plain `.pipe()` reliably
  delivered only the first chunk under workerd's Node-compat `httpServerHandler` bridge
  and then silently dropped the rest (the destination's `'finish'` event never fired,
  even after an explicit `.end()`). Collapsing to a single write + end avoids that at the
  cost of true incremental streaming — `onShellReady` still fires at the real "shell
  ready" moment, but nothing reaches the client before the whole tree (including
  anything deferred) has resolved. See `react-dom-server-shim.js`'s comments.
- **Cloudflare's automatic response compression buffers the whole body.** Any real browser sends
  `Accept-Encoding`, which triggers this unless the response already declares its own
  `Content-Encoding` — `runtime.js`'s generated worker entry sets `Content-Encoding: identity` on
  every response specifically to opt out of it. Don't remove that without understanding this.
- No request-body parsing (`body-parser` stubbed); GET-oriented.
- OpenTelemetry disabled (stubbed).
- The `catalyst-ai` server route (`AI_CONFIG` / `/ai/*`) **is** mounted on Workers —
  `lib/adapter.mjs`'s `WORKER_ENTRY` statically imports `catalyst-ai/route` and mounts it
  (mirroring catalyst-core Node's `expressServer.js`'s `mountAIRouter`, minus the dynamic
  `require.resolve` that doesn't work in a Wrangler-bundled Worker). Needs two other pieces
  working together:
  - **Secrets, not `vars`.** `AI_CONFIG` (which carries provider API keys) must be supplied
    as a Worker secret — `.dev.vars` (gitignored) for local `wrangler dev`, `wrangler secret
    put AI_CONFIG` for a real deploy — never baked into `wrangler.jsonc`'s `vars`/`define`
    (plaintext, printed to the terminal on every `wrangler dev` start, visible in the
    dashboard). `nodejs_compat` mirrors both secrets and vars into `process.env`, so the read
    (`process.env.AI_CONFIG`) is identical to the Node target's.
  - **Real JSON body parsing.** `worker/body-parser-stub.js`'s `json()` used to be a
    no-op passthrough (this app's SSR routes are all GET) — catalyst-ai's routes are
    POST+JSON, so it now actually reads and parses the request body off workerd's real
    Node-compat `IncomingMessage` stream (no `raw-body`/`iconv-lite` needed).
  - `runtime.js` also patches `http.ServerResponse.prototype.flushHeaders` — workerd fires a
    spurious `'close'` event as a side effect of it (used by the AI route's SSE
    `/:provider/stream` to send headers before any body exists), which aborts the request
    immediately since the standard `res.on("close", () => abortController.abort())`
    disconnect-guard pattern reads that as the client hanging up before the handler even
    starts. See the comment there for the exact workaround.
- Coupled to catalyst-core's Vite-built `build/` layout (`build/client/assets/**`, `build/.vite/*.json`, `build/server/index.js`).
- `prebuild.mjs` strips both `PUBLIC_STATIC_ASSET_URL` (the origin) and `PUBLIC_STATIC_ASSET_PATH`
  (this app's config.json uses `/assets/`) from the built output, since Workers Assets serves
  `dist/public` at the site root with neither prefix. The path is matched as a JSON-quoted
  literal (`"/assets/"`, quotes included) rather than a bare substring — Vite's own manifest
  "file" entries look like `"client/assets/main-<hash>.js"`, so an unquoted search for
  `/assets/` also matches inside `client/assets/...` and corrupts it.
- This app's `catalyst-core` had to be patched locally (see the repo's root `packages/catalyst-core`)
  to import router hooks/components from `react-router-dom` (v6) instead of the top-level
  `react-router` (v7) — `@tata1mg/router`, the router library this app uses, is still built
  against v6, and mixing the two majors in one tree throws "may be used only in the context of
  a `<Router>` component" even though a router genuinely is mounted (just the wrong version's).
  That's a local-only patch pending reconciliation upstream, unrelated to this adapter.

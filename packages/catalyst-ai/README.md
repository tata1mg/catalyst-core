# catalyst-ai

Multi-provider AI integration for catalyst-core apps — OpenAI/Gemini SSE routes plus
`useCloudAI`, `useWebAI`, and `useNativeAI` React hooks.

## Security: authentication and rate limiting

The Express router exposed by this package (`src/route.js`, mounted at `AI_CONFIG.basePath`
— default `/ai` — by `catalyst-core`'s `expressServer.js`) does **not** implement its own
authentication, session checks, or rate limiting. It only gates requests on
`AI_CONFIG.enabled` and on a provider having a configured API key.

`catalyst-core` mounts app-defined middleware (`addMiddlewares` from `server/server.js`)
*before* this router, so any auth/session/rate-limit middleware your app registers via
`addMiddlewares` already applies to `/ai/*` routes. **If you expose these routes beyond a
trusted internal network, add authentication and per-caller rate limiting in your app's
`addMiddlewares` — the framework does not provide this for you.** Each request that reaches
`/ai/:provider/generate` or `/ai/:provider/stream` makes a real call to the configured
provider using your app's API key, so an unauthenticated deployment is an open proxy to
your provider account.

## `useWebAI` — remote script execution

`useWebAI` (the in-browser/Transformers.js provider) loads `@huggingface/transformers` from
a jsDelivr CDN URL at runtime inside a Web Worker, rather than bundling it as a dependency.
This is convenient for a zero-install experimental path but means the worker executes
third-party code fetched over the network at runtime. If your app has a Content-Security-Policy,
you'll need to allow `https://cdn.jsdelivr.net` for `worker-src`/`script-src`, or fork this
provider to bundle the library instead. Treat `useWebAI` as a demo/fallback path, not
production-ready, per the EXPERIMENTAL note in its source.

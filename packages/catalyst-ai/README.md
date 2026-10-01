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

## Native AI on iOS

`useNativeAI` (and `useAI({ provider: "native" })`) also runs on-device on iOS. Set
`ai.enabled: true` in `WEBVIEW_CONFIG`, install `catalyst-ai` in the app, and build the iOS app as usual.
The build then adds this package's `plugins/ai` module, the LiteRT-LM Swift package, and the
`com.apple.developer.kernel.increased-memory-limit` entitlement.

**Requirements**

- **Git LFS** on every machine that builds the iOS app (`brew install git-lfs && git lfs install`). The
  LiteRT-LM Swift package needs it; the build stops early with instructions if it is missing.
- Apple Silicon Mac for the simulator (the LiteRT-LM binary has no Intel simulator slice).
- Adds roughly 120 MB (LiteRT-LM) to the app binary.
- On a device, the **Increased Memory Limit** capability must be allowed for your App ID, or signing fails.

**Engines.** Two on-device engines sit behind the same hook, chosen when `initAI` runs (`engine` option):

| `engine` | Behaviour |
| --- | --- |
| `"auto"` (default) | LiteRT-LM if its model is already downloaded; otherwise Apple Foundation Models if available; otherwise LiteRT-LM, which downloads the model first. |
| `"litert"` | LiteRT-LM (Gemma 4 E2B by default). The model, about 2.6 GB, is downloaded once into Application Support (excluded from iCloud backup). Progress arrives as `nativeDownloadProgress`. Needs an iPhone 13 Pro or newer (6 GB RAM). |
| `"foundation-models"` | Apple's system model: no download, iOS 26+ on Apple Intelligence devices, about 4,000 tokens of context shared by the system prompt, history and reply. |

`auto` never starts the large download on its own just because Foundation Models happens to be
available. To use the downloadable model on such a device, pass `engine: "litert"`:

```js
const ai = useAI({ provider: "native", engine: "litert", model: "gemma-4-E2B" })
```

`model` and `modelPath` work on both platforms. The `ON_AI_READY` payload includes `engine` so the UI
can show which one is active.

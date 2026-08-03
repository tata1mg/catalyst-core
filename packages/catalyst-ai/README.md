# catalyst-ai

Multi-provider AI integration for catalyst-core apps — OpenAI/Gemini SSE routes plus
`useCloudAI`, `useWebAI`, and `useNativeAI` React hooks.

> **Requires `catalyst-core` as a peer dependency.** This package does not work standalone —
> `catalyst-core`'s `useAI` hook loads it via `require("catalyst-ai")` at runtime, and its
> Express router is meant to be mounted by `catalyst-core`'s server. See `peerDependencies` in
> `package.json` for the minimum compatible `catalyst-core` version.

## Install

```bash
npm install catalyst-ai
```

`catalyst-core` must already be installed in the app (`>=0.3.0-0`, per this package's
`peerDependencies`) — install will fail its `preinstall` peer check otherwise.

## Usage

### 1. Configure the server (`AI_CONFIG` env var)

`catalyst-core`'s `expressServer.js` auto-mounts this package's router when it's installed and
`AI_CONFIG.enabled` is `true`. Set `AI_CONFIG` as a JSON string in your app's environment:

```json
{
  "enabled": true,
  "basePath": "/ai",
  "providers": {
    "openai": { "apiKey": "sk-...", "model": "gpt-5" },
    "gemini": { "apiKey": "...", "model": "gemini-2.5-flash" }
  }
}
```

No `providers.<name>.apiKey` means that provider's routes are disabled. See the **Security**
section below before exposing `/ai/*` beyond a trusted internal network.

### 2. Call the hook from a component

Prefer `catalyst-core`'s `useAI` — it picks the right sub-hook (`useCloudAI` / `useWebAI` /
`useNativeAI`) based on `options.provider`:

```jsx
import { useAI } from "catalyst-core/hooks"

function Chat() {
    const { output, streaming, generate, cancel, error } = useAI({
        provider: "openai",      // "openai" | "gemini" → cloud, "transformers" → web, "native" → native
        systemPrompt: "You are a helpful assistant.",
    })

    return (
        <div>
            <button onClick={() => generate("Hello!")} disabled={streaming}>Send</button>
            <p>{output}</p>
        </div>
    )
}
```

Or import a specific hook directly from `catalyst-ai` if you don't need provider auto-routing:

```jsx
import { useCloudAI } from "catalyst-ai"

const { output, streaming, generate, cancel, error } = useCloudAI({
    basePath: "/ai",           // must match AI_CONFIG.basePath
    provider: "openai",        // or "gemini"
    sessionMode: "stateless",  // or "stateful"
})
```

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

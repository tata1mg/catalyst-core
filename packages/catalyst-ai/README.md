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

## Model prices

Cost metrics and cost-based routing need a price per model. catalyst-ai ships a best-effort table that goes stale, so
the prices that count are yours, in `AI_CONFIG.pricing` (USD per 1M tokens, they win over the built-in table):

```json
"pricing": { "gemini-3.8-flash": { "input": 0.75, "output": 3.75, "cachedInput": 0.075 } }
```

Do not edit the token rates by hand: run the command from your app root and it asks. (`perImage`, below, is the one price you add by hand: the command manages token rates only.)

```bash
npx catalyst-ai pricing            # lists the cloud models in AI_CONFIG, asks for the ones with no price
npx catalyst-ai pricing --all      # walk every model; Enter keeps the current price
npx catalyst-ai pricing --check    # print the table, exit 1 if a model has no price (CI)
npx catalyst-ai pricing --set gpt-x=2,10,0.2   # input,output[,cachedInput] without asking
```

Each entry may also carry `audioInput` (USD per 1M audio input tokens; without it audio is never priced at the text rate and
the cost is reported as partial, `audioCostUnknown`) and, for image models, `perImage` (USD per generated image, which may be
the only field: `{ "perImage": 0.04 }`). `AI_CONFIG.pricing` is part of the browser-visible config, so it is not secret.
Precedence for routing: an explicit `routing.cloud[].price`, then `AI_CONFIG.pricing[model]`, then the built-in table.
A text model with no price anywhere is costed as free, which makes cost-weighted routing prefer it, so `check_config`
warns about it. An image model with no price reports its cost as `null` (unknown), never `0`; with token rates but no
`perImage` it reports the token amount with `costPartial: true`. Look prices up on your provider's pricing page; they change, and some models have introductory rates.
`cachedInput` defaults to the input price. The file also holds API keys; the command never prints them.

## Claude (`anthropic`)

Add `"anthropic": { "apiKey": "...", "defaultModel": "claude-opus-5-5" }` under `AI_CONFIG.providers` and use
`provider: "anthropic"`, or list it as a cloud candidate (`"provider": "anthropic"`) for `provider: "auto"` routing.
The route calls the Messages API directly, like the other providers (no SDK dependency).

- **Does:** text, images (png, jpeg, webp, gif), PDFs and structured outputs.
- **Does not:** audio input, image generation or embeddings (Claude offers none); those stay with other providers.
- **PDF.** A server-side part `{ type: "document", data: "data:application/pdf;base64,..." }` (10 MB, 2 per request).
  Other providers refuse it with `unsupported-modality`. The client hooks do not build document parts yet.
- **Structured outputs.** `genConfig.responseSchema` (a JSON Schema object) sets `output_config.format`, so the reply
  matches the schema.
- **Stateless.** The full history is sent every turn and `conversationId` is ignored.
- **Sampling.** `temperature` and `topP` are sent only to models that still accept them (Claude Opus 4.6, Sonnet 4.6,
  Haiku 4.5 and older); newer models reject them, so they are dropped for those.
- **Thinking** is left at the model default and never streamed; thinking tokens are billed as output tokens.
- A safety decline (`stop_reason: "refusal"`) is reported as an error instead of an empty reply.

## Image and audio input

`messages[].content` may be a string or an array of parts: `{ type: "text", text }`,
`{ type: "image", data: "data:image/...;base64,..." }`, `{ type: "audio", data: "data:audio/...;base64,..." }`.
Text-only calls behave exactly as before.

- **Cloud needs an explicit choice.** `useAI({ provider: "cloud" | "openai" | "gemini" | "anthropic" })` may send media to the
  provider. If a native or web engine was requested but is unavailable, `useAI` falls back to cloud for text only and
  refuses media with `cloud-media-not-allowed`, so a photo or voice clip is never sent to a provider by accident.
- **What each endpoint accepts** (anything else is refused with `unsupported-modality` before any provider call):
  OpenAI Chat Completions: images, plus wav/mp3 audio on `*audio*` models. OpenAI Responses (stateful): images only.
  Gemini `generateContent`: images and audio. Gemini Interactions (stateful): images only. The refused combinations
  are ones whose request format is not confirmed in the provider docs.
- **Request size.** `catalyst-core` raises the JSON body limit to 20 MB on the AI path only (other routes keep the
  100 kb default). Set `AI_CONFIG.maxRequestMB` (1 to 100) to change it. The route also re-validates every part:
  type, base64 data URL, size (image 8 MB, audio 10 MB), and count (4 images, 2 audio clips). Larger bodies make an
  unauthenticated deployment more expensive to abuse, so the authentication note above matters more with media.
- **Preparation on the device.** Images are resized (long edge 1536 px, JPEG; GIF becomes its first frame). Audio going to an
  on-device model or a cloud provider other than Gemini is converted to 16 kHz mono WAV and capped at 30 s per clip (a longer
  clip is truncated; use `prepareAudioChunks`, below, for long recordings). Audio going to Gemini `generateContent` is not
  converted: only the codec parameters are stripped from its MIME type (`audio/webm;codecs=opus` becomes `audio/webm`), so
  what browsers and phones record (webm, mp4, ogg, ...) is sent as it is.
- **Cost.** Cloud metrics bill audio tokens at the model's audio rate (`audioInput`). A model without a confirmed rate reports
  `audioCostUnknown: true` and a partial cost instead of pricing audio as text. On-device runs may report
  `cloudEquivalent`, an estimate from the on-device token counts at a reference model's text rates.

## Image generation and editing

Set the image model per provider in `AI_CONFIG.providers.<name>.imageModel` (letters, digits and `. _ : -`). It is never
inferred from `defaultModel`, because image model names change often. `openai` and `gemini` can draw; `anthropic` cannot
(`400`). The API key stays on the server.

```json
"providers": { "openai": { "apiKey": "...", "defaultModel": "gpt-5", "imageModel": "gpt-image-1" } }
```

- **Route.** `POST {basePath}/:provider/image` with `{ prompt, n?, size?, model?, images? }`. `prompt` is 1 to 4000 characters,
  `n` is 1 to 4, `size` is `"auto"` or `WIDTHxHEIGHT`, and `model` overrides the provider's `imageModel` for that request.
  Gemini returns one image per request and has no size setting: omit `n` and `size` (or send `1` / `"auto"`); anything else is a
  `400`, not a silent default. It answers `{ images: [{ mimeType, data }], usage, model }` with `data` as base64.
- **Editing.** Add `images` (1 to 4 inputs) to edit or transform instead of generate. Each is `{ mimeType, data }` with raw
  base64 `data` (the client helpers also accept `data:` URLs and strip the prefix), `mimeType` is `image/png`, `image/jpeg` or
  `image/webp`, and each image may decode to at most 8 MB. The server re-checks all of it. OpenAI uses its image edits
  endpoint, without a mask (masks are not supported); Gemini takes the images as inputs to the same call.
- **Client.** `requestImage({ basePath, provider, prompt, n, size, model, images, signal })` is a plain async function that
  resolves `{ images: [{ mimeType, data, url }], usage, model, cost, costPartial }` (`url` is a `data:` URL for `<img src>`;
  `cost` is USD from `AI_CONFIG.pricing`, or `null` when no price applies) and rejects with the server's message.
  `useImageGen({ basePath, provider, model, size, n })` returns `{ generate(prompt, overrides), cancel, reset, images, loading, error, usage }`;
  `overrides` are per-call options and win over the hook's. `provider: "device"` draws on this device instead (desktop browser
  with WebGPU, once an engine is registered with `registerDeviceImageEngine`) and costs `0`.
- **Authentication and limits.** Like every route here it spends your API key and has no authentication or rate limit of its
  own: see the security note at the top before exposing it.

## Speech synthesis

Set `speechModel` next to `imageModel` for the provider that should speak.

- **Route.** `POST {basePath}/:provider/speech` with `{ text, voice?, format?, model? }`: `text` is 1 to 4000 characters,
  `voice` may contain letters, digits and `. _ -` (defaults: `alloy` on OpenAI, `Kore` on Gemini), `format` is `mp3`, `wav` or
  `opus` and is OpenAI only (Gemini returns `wav`; any other format is a `400`). It answers
  `{ audio: { mimeType, data }, usage, model }` with `data` as base64; audio over about 24 MB is refused.
- **Client.** `requestSpeech({ basePath, provider, text, voice, format, model, signal })` resolves
  `{ audio: { mimeType, data, url }, usage, model }` (`url` is a `data:` URL for `new Audio(url)`).
  `useSpeech({ basePath, provider, voice, format, model })` returns `{ speak(text, overrides), cancel, reset, audio, url, loading, error, usage }`.

## Live transcription (Gemini Live)

Streams the microphone to Gemini and returns partial text while you talk. **Cloud only: the audio goes to Google.** The
browser opens the WebSocket itself with a one-use token, so the API key never leaves the server.

- **Config.** Set `AI_CONFIG.providers.gemini.liveModel` to a Gemini Live model id. Without it (or a `model` in the request)
  the token route answers `400`. The example template ships `liveModel` empty, so set it before using Live.
- **Route.** `POST {basePath}/gemini/live-token` with `{ model? }` answers `{ token, model, expiresAt, startBy, url, setup }`.
  The token can be used once and must be used to start a session before `startBy`.
- **Client.** `requestLiveToken({ basePath, model, signal })` fetches it (abortable). `startLiveTranscription({ basePath, model, onPartial, onFinal, onLevel, onStatus, onError, signal })`
  opens the microphone and the socket, and resolves `{ stop(): Promise<string>, cancel() }` once Gemini accepted the session;
  `onStatus` is `"connecting"`, `"listening"`, `"finishing"` or `"closed"`. `useLiveTranscribe({ basePath, model, onFinished })`
  wraps it as `{ start, stop, cancel, state, listening, partial, text, level, seconds, error }`. The microphone is released
  however the session ends (stop, cancel, an unexpected close, unmount).

## Long recordings

`prepareAudioChunks(source, { chunkSeconds, maxSeconds })` decodes a recording once and cuts it at quiet moments into pieces
that each fit an on-device audio encoder: `MAX_AUDIO_SECONDS` (30 s) is the encoder limit per piece, `CHUNK_SECONDS` (28 s)
the default piece length, and `MAX_CLIP_SECONDS` (120 s) the longest recording accepted: beyond it the audio is cut and the
result reports `truncated: true`. `chunkSeconds` must be a finite number of seconds greater than zero (otherwise a
`RangeError`). `useTranscribe` in `catalyst-core/hooks` uses this and joins the transcripts.

## `useWebAI` engines

`useWebAI({ engine })` runs in the browser with one of two engines: `"transformers"` (default: Transformers.js in a worker,
needs WebGPU) or `"prompt-api"`, **Chrome's built-in model** (the Prompt API). `useAI({ provider: "prompt-api" })` selects the
second one directly; under `provider: "auto"` an `onDevice.web*` entry with `"engine": "prompt-api"` does.

- Desktop Chrome only; a mobile browser is refused with a clear error. Chrome owns the model and its download, so there is no
  WebGPU requirement. Called directly (no routing), the first `generate()` starts the download, so call it from a user gesture.
- It takes text, and image or audio where Chrome supports that input. `getPromptApiAvailability()` (exported) reports whether
  Chrome can serve it.
- `genConfig.temperature` and `topK` are applied together (Chrome needs both); `responseConstraint` (a JSON Schema or RegExp)
  is passed through; other settings, such as token limits, are ignored and logged.

## Voice input and the microphone

The hooks are in `catalyst-core/hooks`; they use this package for the model call.

```jsx
import { useTranscribe, useMicrophone } from "catalyst-core/hooks"

const voice = useTranscribe({ language: "en-US" })
const heard = await voice.listen()                 // { text, engine, durationSec, truncated, ... } or null (read voice.status)
if (voice.status === "needs-consent") await voice.approve({ cloud: true })   // only after the person agreed

const mic = useMicrophone({ onRecorded: (clip) => voice.transcribe(clip) })  // or record yourself, then transcribe the clip
await mic.start()                                  // { started: true } or { started: false, error }
```

- Inside the iOS and Android apps `listen()` uses the phone's own on-device recogniser; in a browser it records and sends the
  clip to the routed model. Audio goes to a cloud provider only when the routing policy allows it.
- `supported` (on `useMicrophone`) is `false` where the page cannot record (no `MediaRecorder`/`getUserMedia`, e.g. a non-secure
  page). A refused permission comes back as `{ started: false, error }`, not as a throw. Recordings over 120 s are cut and
  reported as `truncated`. The iOS Simulator has no on-device speech model files, so use a device for the phone recogniser.
- Full options and result tables: `docs/content/11-API Reference/01-Hooks.md` (`useTranscribe`, `useMicrophone`, `useSpeechRecognition`).

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
`com.apple.developer.kernel.increased-memory-limit` entitlement. None of this happens unless
`ai.enabled` is true: installing `catalyst-ai` alone adds nothing to the iOS build. The LiteRT-LM Swift wrapper
is vendored (`plugins/ai/LiteRTLM`), so no Git LFS or large clone is needed.

**Requirements**

- Apple Silicon Mac for the simulator (the LiteRT-LM binary has no Intel simulator slice).
- Adds roughly 120 MB (the LiteRT-LM framework, downloaded once by SwiftPM) to the app binary.
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
const ai = useAI({ provider: "litert", model: "gemma-4-E2B" })      // pin LiteRT-LM
const ai = useAI({ provider: "foundation-models" })                  // pin Apple Foundation Models
```

With `auto`, LiteRT-LM is the preferred engine and Apple Foundation Models is its fallback: if LiteRT-LM cannot load its
model, or fails before it has produced any text, the same request is answered by Foundation Models (no download needed)
and the app stays on it until the next `initAI`. This applies to `auto` only; pinning `litert` fails as asked. A failure
after text has started streaming is reported, not retried. The conversation continues under the same id, but only the
current message is replayed to the fallback, so its first answer lacks earlier turns.

The provider names `native` (auto), `litert` and `foundation-models` can also be set app-wide in the AI
config, so components don't have to choose:

```json
"AI_CONFIG": { "browser": { "provider": "foundation-models" } }
```

(`"provider": "native"` with `"engine": "litert"` is equivalent to `"provider": "litert"`.)

`model` and `modelPath` work on both platforms. The `ON_AI_READY` payload includes `engine` so the UI
can show which one is active.

# Making Catalyst Agentic — A Discussion

---

## Hook

Every time you add an AI feature today, you make the same decisions:

Which provider? How do I stream tokens into state? What happens when the user is offline? Do I use a local model or call the server? How do I manage sessions across navigations? Where do I put the API key so it doesn't leak?

None of that is your app. None of that is your business logic.

**Catalyst's next step is to take all of it away.**

---

## The Fragmented Stack

<!-- HyperFrame 1: "The Fragmented Stack" — animated cascade of 7 decisions before business logic -->

Here's what shipping a single AI feature looks like today — even with the best tools available:

```
You want to:   summarize this document

What you actually do:
  1. Pick a provider          (OpenAI? Anthropic? Local model?)
  2. Secure the API key       (env var, server proxy, or leak it)
  3. Wire up streaming        (SSE? WebSocket? polling?)
  4. Pipe tokens into state   (useReducer? ref? external store?)
  5. Detect the environment   (WebView? desktop browser? offline?)
  6. Write the fallback       (what if the provider is down?)
  7. Handle sessions          (stateful chat vs one-shot? when to clear?)
  8. Think about cost         (are you burning tokens on every keystroke?)

Then — finally — you write the summarize call.
```

Seven infrastructure decisions before one line of product logic. And you repeat this for every AI feature, every team, every app — from scratch.

Libraries help with pieces. Vercel AI SDK handles the streaming. LangChain handles the orchestration. Transformers.js runs inference in the browser.

But none of them make the decisions for you. You still wire them together. You still handle the environment. You still write the glue.

---

## What "Agentic" Actually Means

Agentic gets thrown around a lot. Here's what it means for Catalyst — concretely:

> **The framework makes the infrastructure decisions. You write the intent.**

Not abstractly. Look at what the developer writes:

```js
// Before — developer owns the infrastructure
const provider = new OpenAI({ apiKey: process.env.OPENAI_KEY })
const stream = await provider.chat.completions.create({
  model: 'gpt-4o',
  stream: true,
  messages: [{ role: 'user', content: `Summarize: ${document}` }]
})
for await (const chunk of stream) {
  setSummary(prev => prev + chunk.choices[0].delta.content)
}

// After — developer writes the intent
const ai = useAI()
const summary = await ai.summarize(document)
```

Same outcome. One of these is infrastructure. One of these is business logic.

Agentic doesn't mean the app has agents running around making autonomous decisions. It means the **framework** is the agent — handling routing, environment, fallback, lifecycle — so the developer never has to be.

---

## Why a Framework — Not a Library

<!-- HyperFrame 2: "The Routing Layer" — animated local > server > cloud cascade, developer sees nothing -->

Here's the question that settles this:

**Who knows which model to use right now?**

A library doesn't know. You imported it. It has no idea if you're running inside an iOS WebView with a CoreML model available 30ms away. It has no idea if you're offline. It gives you tools — you still make the decision.

Catalyst already knows. It owns the environment.

```
useAI() called
        │
        ▼
    AIRouter  ← framework, not userland
   /         \
local        cloud
  ↓            ↓
Native      Server-local    Cloud
Bridge      (Transformers.js (Anthropic /
CoreML /    on Node /        OpenAI /
ONNX        Ollama)          Ollama API)
   \         |              /
             ▼
      same hook interface
      same state shape
      developer sees nothing
```

The routing decision requires knowing the environment. That's framework knowledge. No library can have it, because a library doesn't own the runtime.

This is why `useAI` is not a wrapper around an existing library. It's a capability primitive that the framework provides, the same way `useCamera` or `useFilePicker` are — not because those are hard to build, but because they require the framework to make decisions the developer shouldn't have to make.

---

## The Two Verticals

Every AI call in Catalyst routes to one of two verticals: **local** or **cloud**. That's the only decision the developer ever needs to think about.

```
LOCAL                               CLOUD
────────────────────────────        ────────────────────────────
On-device. Private. Free.           Your server or third-party.
No API key. No data leaves.         Managed keys. Pay per token.

├── Native Bridge (Universal App)   ├── Anthropic
│   CoreML (iOS Neural Engine)      ├── OpenAI
│   ONNX / LiteRT (Android NPU)     └── Ollama (self-hosted)
│
├── TensorFlow.js WASM (mobile web)
│   Tiny bundled models
│   25–50MB, no download cost
│   Works on mobile browser via WASM
│   Runs in Web Worker — main thread safe
│
├── LiteRT-LM (desktop web, opt-in)
│   WebGPU + WebNN backends
│   76 tok/s on consumer hardware
│   Same .litertlm model format as Native Bridge
│   Runs in Web Worker — main thread safe
│
└── Server-local (Catalyst Express)
    Transformers.js on Node
    Ollama on your own infra
    Private, no third-party API
```

**Browser-local threading model:** All browser inference — TF.js and LiteRT-LM — runs inside a Web Worker by default. This keeps the main thread free for gestures, input, and animations during token generation. The framework manages the worker lifecycle; the developer never touches it.

**A note on browser-local heavy models (WebLLM, Transformers.js in browser):**
These are supported as opt-in for specific use cases — desktop web apps where the developer explicitly wants offline-capable full LLM inference. Not the default because 1–4GB downloads are not a production-grade mobile experience. For desktop web, LiteRT-LM is the preferred opt-in engine: it's faster than Transformers.js on WebGPU, uses the same model format as our Android native bridge, and has cleaner Web Worker isolation.

**A note on browser storage for local models:** LiteRT-LM assets are cached in the browser's persistent storage (IndexedDB / OPFS). On iOS and low-disk environments, the OS may evict this cache under storage pressure, triggering a redownload on next use. The framework surfaces this as `MODEL_UNAVAILABLE` → `progress.state: 'downloading'` automatically — the developer does not need to handle it explicitly, but should be aware that the download consent UX may appear more than once on storage-constrained devices.

**A note on Chrome Built-in AI (window.ai / Gemini Nano):**
Real technology, not viable as a framework default. Requires 22GB free disk, >4GB VRAM or 16GB RAM, desktop Chrome only — no Android, no iOS, no WebView. Too narrow a hardware target for a framework that runs on mobile. Not in the routing stack.

---

## The Routing Policy

Default routing: **local first, cloud as fallback.**

But "local first" means different things depending on context:

```
Universal App running?
  → Native Bridge (CoreML / ONNX / LiteRT on Neural Engine)  — fastest, truly private

Web browser (mobile)?
  → TensorFlow.js WASM (bundled, instant, Web Worker)  — lightweight, no download

Web browser (desktop, opt-in)?
  → LiteRT-LM via WebGPU (preferred) or Transformers.js  — fast, Web Worker safe

No local model available or capable?
  → Server-local (Transformers.js on Node / Ollama)  — private, your infra

No server-local configured?
  → Cloud (Anthropic / OpenAI)  — always available, most capable
```

**Cloud is instant — local gets better over time.**

On first launch, cloud responds immediately while the local model loads in the background. Once local is ready, subsequent calls prefer local silently. The developer sees nothing change — the same `useAI` interface, the same state shape, just progressively cheaper and more private.

---

## The Interface

This is the entire public surface a developer touches:

```js
const ai = useAI()

// Generate
await ai.generate("Explain this error message")

// Stream — tokens arrive live
const { stream, cancel } = ai.stream("Write a product description for...")

// Named capabilities
await ai.summarize(article, { type: 'bullets', length: 'short' })
await ai.translate(text, { from: 'en', to: 'es' })
await ai.rewrite(draft, { tone: 'formal' })
await ai.write("Onboarding email for a fintech app", { format: 'email' })

// Vision
await ai.vision(receiptImage, "Extract the total amount")

// Stateful chat — session memory managed automatically
const ai = useAI({ sessionMode: 'stateful' })
await ai.generate("What is the capital of France?")
await ai.generate("And its population?")   // session remembers

// Provider-specific when you need explicit control
const gpt    = useAI({ provider: 'openai' })
const claude = useAI({ provider: 'anthropic' })
const result = await Promise.race([gpt.generate(prompt), claude.generate(prompt)])
```

No provider setup. No key management. No stream plumbing. No environment detection.

The hook handles model routing, download progress, warmup, token streaming, session lifecycle, cancellation, and fallback. The developer handles the product.

**The same interface works on server and client.** During SSR, `useAI` routes to cloud automatically (no browser or native available server-side) and returns a complete response. On the client, it hydrates into the existing state — no double call, no mismatch. Streaming is client-only; server always returns a complete response.

---

## Configuring the Interface

`useAI` works out of the box with zero config. But every layer is tunable when you need it.

### Config hierarchy

Options resolve in this order — higher priority wins:

```
catalyst.config.js         ← app-wide defaults (lowest priority)
        ↓
Remote config (/ai/config) ← ops-controlled, no rebuild needed
        ↓
useAI({ ... })             ← hook-level defaults
        ↓
ai.summarize(text, { ... }) ← per-call override (highest priority)
```

### Hook-level defaults

```js
const ai = useAI({
  provider: 'anthropic',
  sessionMode: 'stateful',
  temperature: 0.3,
  maxTokens: 1024,
  routing: 'auto',          // 'auto' | 'local-only' | 'cloud-only'
  systemPrompt: 'You are a helpful medical assistant. Be concise and accurate.',
})
```

### Per-call overrides

```js
const ai = useAI({ temperature: 0.3 })

await ai.summarize(article)                                      // uses 0.3
await ai.generate("Write a creative tagline", { temperature: 0.9 })  // overrides
```

### Named capability options

```js
await ai.summarize(article, {
  type: 'bullets' | 'paragraph' | 'tldr',
  length: 'short' | 'medium' | 'long',
  audience: 'technical' | 'general',
})

await ai.translate(text, {
  from: 'en',
  to: 'ja',
  formality: 'formal' | 'casual',
})

await ai.rewrite(draft, {
  tone: 'formal' | 'casual' | 'persuasive' | 'empathetic',
  readingLevel: 'simple' | 'standard' | 'advanced',
})

await ai.write("Rejection email for a job application", {
  format: 'email' | 'markdown' | 'plain',
  length: 'short' | 'medium' | 'long',
  tone: 'professional',
})

await ai.vision(image, "Extract all line items and their prices", {
  format: 'json',
})
```

### Routing control

```js
// Default — Catalyst decides
const ai = useAI({ routing: 'auto' })

// Force local — for compliance, sensitive data
const ai = useAI({ routing: 'local-only' })
// If no local model available → clear error, no silent cloud fallback

// Force cloud — for quality-critical features
const ai = useAI({ routing: 'cloud-only' })

// Per-call routing override
await ai.summarize(patientNote, { routing: 'local-only' })  // sensitive
await ai.summarize(publicArticle)                           // uses hook default
```

### Prompt adapters

For named capabilities (`summarize`, `translate`, etc.) Catalyst maintains internal prompt templates per layer — the developer never sees them. For raw `generate()` calls with custom prompts, a small model and a large cloud model need different instructions to produce equivalent quality output.

Use `cloudPrompt` to supply a richer prompt that only runs on cloud:

```js
// Local gets the short, direct prompt.
// Cloud gets the expanded version — both produce equivalent output.
await ai.generate("Extract receipt details: {text}", {
  cloudPrompt: "You are an expert data extractor. Analyze the following receipt text, fix any OCR errors, and extract all line items with their prices. Return clean structured data: {text}"
})
```

If `cloudPrompt` is omitted, the same prompt runs on all layers. For named capabilities, Catalyst's internal adapters handle this automatically — you only need `cloudPrompt` on bare `generate()` or `stream()` calls where you control the prompt directly.

### Structured outputs

When you need typed, validated data — not raw text:

```js
import { z } from 'zod'

const ReceiptSchema = z.object({
  vendor: z.string(),
  total: z.number(),
  items: z.array(z.object({ name: z.string(), price: z.number() }))
})

const { data } = await ai.vision(receiptImage, "Extract receipt details", {
  schema: ReceiptSchema
})
// data is fully typed and guaranteed valid
// Catalyst retries once with correction prompt if validation fails
// After 2 failures → error.code = 'SCHEMA_VALIDATION_FAILED'
```

### Streaming with control

```js
const { stream, cancel } = ai.stream("Write a detailed product spec for...")

const reader = stream.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  setOutput(prev => prev + value.delta)   // value.delta = new text only
}

cancel()  // partial text preserved, state lands on 'cancelled'
```

### Progress and loading state

```js
const { progress, loading, error } = useAI()

// progress.state:
//   'idle' | 'starting' | 'downloading' | 'warming' | 'streaming' | 'complete' | 'error' | 'cancelled'
// progress.downloadProgress: 0–100
// progress.tokensGenerated: number
// progress.eta: seconds remaining on model download (estimated)
// progress.modelReady: boolean — is local model available
// loading: true during starting / downloading / warming / streaming

if (progress.state === 'downloading') {
  return <ProgressBar value={progress.downloadProgress} eta={progress.eta} />
}
if (progress.state === 'warming') {
  return <Spinner label="Almost ready..." />
}
if (progress.state === 'streaming') {
  return <StreamingText value={data} tokens={progress.tokensGenerated} />
}
```

### Usage and cost visibility

Every response includes a `usage` object — useful for SaaS apps with credit systems, or for showing users what ran:

```js
const { data, usage } = await ai.summarize(article)

usage.ttft            // ms to first token
usage.totalLatency    // ms total
usage.inputTokens     // null for local
usage.outputTokens    // null for local
usage.estimatedCost   // USD, null for local (calculated from built-in pricing table)
usage.provider        // 'native' | 'transformers-node' | 'openai' | 'anthropic' | 'ollama'
usage.model           // exact model used e.g. 'claude-haiku-4-5'
usage.layer           // 'local' | 'server-local' | 'cloud'
```

### Stateful sessions

```js
const ai = useAI({ sessionMode: 'stateful' })

await ai.generate("What causes inflation?")
await ai.generate("How does that affect housing prices?")
await ai.generate("Give me a real-world example from 2008")

ai.clearSession()   // start fresh
```

**Session continuity across layer switches:** When a session migrates between layers — for example, a `CONTEXT_OVERFLOW` auto-upscale from local to cloud, or a network restoration routing a call back to cloud — the full conversation history is serialized and replayed to the new provider. The session continues without fragmentation. The developer sees nothing change; the state shape is identical before and after the switch.

### Global config via `catalyst.config.js`

```js
module.exports = {
  ai: {
    routing: 'auto',              // global routing default

    // Cloud providers — keys via env vars only, never in config
    providers: {
      anthropic: { model: 'claude-haiku-4-5' },
      openai:    { model: 'gpt-4o-mini' },
      ollama:    { baseUrl: 'http://localhost:11434', model: 'llama3.2' },
    },
    defaultProvider: 'anthropic',

    // Server-local (Transformers.js on Node)
    selfHosted: {
      provider: 'transformers',
      model: 'Xenova/distilbart-cnn-12-6',
    },

    // Browser-local mobile (default, bundled — no download)
    // TF.js WASM runs in Web Worker automatically
    browserMobile: {
      provider: 'tfjs',           // bundled lightweight models, WASM backend
    },

    // Browser-local desktop (opt-in — requires user download consent)
    // LiteRT-LM preferred: faster WebGPU, same model format as Native Bridge
    browserDesktop: {
      provider: 'litert',         // 'litert' | 'transformers' | 'webllm'
      modelPath: 'https://your-cdn/model.litertlm',
      fallbackToServer: true,     // use server while local model downloads/warms
      downloadConsent: true,      // prompt user before downloading
    },

    sessionMode: 'one-shot',
    session: {
      ttlMs: 1800000,
      maxHistoryMessages: 20,
      store: 'memory',            // 'memory' | 'redis'
      redisUrl: process.env.REDIS_URL,
    },

    capabilityDefaults: {
      summarize:  { temperature: 0.3, type: 'paragraph' },
      translate:  { temperature: 0.1, formality: 'formal' },
      rewrite:    { temperature: 0.5, tone: 'professional' },
      generate:   { temperature: 0.7 },
      write:      { temperature: 0.9, format: 'markdown' },
    },
  },
}
```

### Runtime config (no rebuild required)

Catalyst Express serves a `/ai/config` endpoint. Whatever your deployment platform sets as environment variables (Vercel dashboard, Kubernetes ConfigMap, AWS Parameter Store) is picked up at request time — no rebuild, no redeploy of the app bundle.

**Two types of config fields:**

- **Fixed** — set in `catalyst.config.js` as the compliance floor. Remote config cannot override these. Use for routing restrictions in sensitive apps (`local-only` for medical, legal, financial).
- **Dynamic** — everything else. Remote config can override at runtime: provider selection, model version, temperature defaults, rate limits, and **pricing table**. The framework ships a built-in pricing table for `usage.estimatedCost` calculations, but AI providers reprice frequently. Rather than coupling the pricing table to a framework release, ops can push updated token costs via `/ai/config` at any time — no rebuild, no redeploy.

This means a compliance team can lock `routing: 'local-only'` for patient data at build time, while ops can still switch models, tune defaults, or update pricing without a release.

---

## Error Handling

Every `useAI` call returns a typed error — never throws. Errors are either retryable (try again) or fatal (something structural is wrong).

```js
const { data, error } = await ai.summarize(text)

if (error) {
  switch (error.code) {
    case 'COMPLIANCE_BLOCKED':
      // routing: 'local-only' but no local model available
      // show "AI unavailable on this device"
      break
    case 'NETWORK_ERROR':
      // transient — show retry button
      // error.retryable = true
      break
    case 'RATE_LIMITED':
      // cloud provider rate limit
      // error.retryAfter = seconds to wait
      break
    case 'SCHEMA_VALIDATION_FAILED':
      // structured output didn't match schema after 2 retries
      break
  }
}
```

**Full error taxonomy:**

| Code | Retryable | Cause |
|---|---|---|
| `MODEL_UNAVAILABLE` | ❌ | No local model, no cloud configured |
| `NETWORK_ERROR` | ✅ | Lost connection mid-stream |
| `RATE_LIMITED` | ✅ after delay | Provider rate limit hit |
| `CONTEXT_OVERFLOW` | ✅ auto | Input too large — router upscales to cloud |
| `SCHEMA_VALIDATION_FAILED` | ❌ | Structured output failed after retries |
| `COMPLIANCE_BLOCKED` | ❌ | `local-only` but no local model available |
| `PROVIDER_ERROR` | ✅ | Cloud provider returned 5xx |
| `AUTH_ERROR` | ❌ | API key missing or invalid |

`STREAM_CANCELLED` is not an error. `progress.state` goes to `'cancelled'`, partial data is preserved, `error` stays null.

Catalyst automatically retries `NETWORK_ERROR` and `PROVIDER_ERROR` once before surfacing to the developer. `CONTEXT_OVERFLOW` triggers an automatic upscale to a cloud model — the developer never sees it.

---

## Observability

Catalyst instruments every `useAI` call automatically. No setup required from the developer.

### OTel (OpenTelemetry)

Every call becomes a span: `ai.generate`, `ai.summarize`, etc. Attributes on the span:

```
ai.layer           local | server-local | cloud
ai.provider        native | transformers-node | anthropic | openai
ai.model           claude-haiku-4-5
ai.ttft_ms         time to first token
ai.input_tokens    token count
ai.output_tokens   token count
ai.estimated_cost  USD
ai.fallback_reason why router fell back (if it did)
```

Flows into Datadog, Grafana, Honeycomb — whatever you already have.

**Use OTel for:** debugging TTFT spikes, tracking which layer was hit, monitoring fallback rates, alerting when cloud fallback rate exceeds a threshold, aggregating cost per user.

### Sentry

`useAI` errors surface as Sentry events automatically: `ON_AI_ERROR`, cancelled streams, schema validation failures, context window overflows. Sentry breadcrumbs capture what the user did before the AI call failed.

**Use Sentry for:** user-facing AI failures, schema validation errors, auth errors, debugging specific user reports.

### Real-world benchmarks (for reference)

| Layer | Typical TTFT | Throughput | Cost |
|---|---|---|---|
| Native (CoreML / ONNX / LiteRT) | < 100ms | device NPU | $0 |
| TensorFlow.js WASM (mobile web) | < 50ms | WASM | $0 |
| LiteRT-LM (desktop web, WebGPU) | < 100ms | ~76 tok/s | $0 |
| Server-local (Transformers.js / Ollama) | 200–500ms | server GPU | $0 (infra cost) |
| Cloud — Haiku 4.5 | ~600ms | — | $0.80 / $4.00 per 1M tokens |
| Cloud — Sonnet 4.6 | ~900ms | — | $3.00 / $15.00 per 1M tokens |

The `usage` object on every response exposes TTFT and estimated cost so you can surface this to users or use it for alerting.

---

## Compared to Everything Else

| Tool | Streaming | Multi-env routing | Native on-device | Framework-managed lifecycle | Makes infra decisions for you |
|---|---|---|---|---|---|
| Vercel AI SDK | ✓ | ✗ | ✗ | ✗ | ✗ |
| LangChain | partial | ✗ | ✗ | ✗ | ✗ |
| Chrome AI APIs | ✓ | ✗ (Chrome only) | ✗ | ✗ | ✗ |
| Transformers.js | ✓ | ✗ (browser only) | ✗ | ✗ | ✗ |
| **Catalyst useAI** | **✓** | **✓** | **✓** | **✓** | **✓** |

The last column is the one that matters. Every other tool gives you capabilities. Catalyst makes the decisions.

---

## The Vision

<!-- HyperFrame 3: "The Vision" — same 2 lines of code, 3 environments animate in sequence underneath -->

Same two lines of developer code. Three different environments. Three different things happening underneath — all invisible.

```
Developer writes:
  const ai = useAI()
  await ai.summarize(document)

On iPhone (Universal App):
  → Native Bridge → CoreML on Neural Engine
  → no network call
  → data never leaves the device
  → response in ~100ms

On mobile web browser:
  → TensorFlow.js (bundled, 25MB)
  → extractive summary, instant
  → no download, no server cost
  → response in ~50ms

On desktop / server SSR:
  → POST /ai/stream → Anthropic
  → SSE streams tokens
  → session managed server-side
  → response in ~600ms
```

The developer didn't write any of that. They wrote `ai.summarize(document)`.

That's the goal. That's what agentic means.

---

## What We're Not Building

To be clear about scope:

- **Not a chat UI library.** `useAI` is a primitive. You build the chat component.
- **Not a model hosting service.** You bring your own API keys and models.
- **Not competing with LangChain** for complex multi-step agent pipelines. If you need RAG, memory graphs, or tool-calling orchestration — LangChain is the right tool. `useAI` is the foundation those can sit on top of.
- **Not an AI features library.** We're not shipping a summarize button. We're shipping the thing that makes building a summarize button take two lines.

---

## Open for Discussion

1. **Routing priority** — we landed on `local-first, cloud-as-fallback`. Does that match your use case, or do you want explicit control over the order?

2. **Browser-local heavy models** — WebLLM and Transformers.js in-browser are supported as opt-in for desktop web. Should Catalyst provide a consent UI component, or leave that entirely to the developer?

3. **Cost visibility** — the `usage` object exposes `estimatedCost` calculated from a pricing table served by `/ai/config`. Ops can update it at runtime without a framework release. Should developers also be able to override pricing in `catalyst.config.js`, or is ops-only sufficient?

4. **Compliance modes** — `routing: 'local-only'` blocks cloud silently. Should Catalyst surface a standard "AI unavailable on this device" UI, or always leave error handling to the developer?

5. **What AI capabilities are you missing?** We have generate, summarize, translate, rewrite, write, vision. What's the first thing you'd add?

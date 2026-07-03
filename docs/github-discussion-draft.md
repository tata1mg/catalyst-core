# RFC: Making Catalyst Agentic — a `useAI` primitive for every environment

**Status:** Open RFC — looking for feedback before implementation begins  
**Branch:** `feature/web_fallback_clean`  
**TL;DR:** Add a single `useAI` hook that makes every AI infrastructure decision invisible. You write the intent. Catalyst handles the rest.

---

## The problem

Every time you add an AI feature today, you make the same decisions — regardless of which library you use:

- Which provider? (OpenAI? Anthropic? Local model?)
- How do I stream tokens into state?
- What happens when the user is offline?
- Do I use a local model or hit the server?
- How do I manage sessions across navigations?
- Where do I put the API key so it doesn't leak?
- What if the provider is down?

**None of that is your app.** None of that is business logic. And you repeat it for every feature, every team, every app — from scratch.

<!-- HF1: The Fragmented Stack -->
![The Fragmented Stack](https://github.com/user-attachments/assets/HF1_PLACEHOLDER)

---

## The proposal

One hook. All environments. Zero infrastructure decisions.

```js
const ai = useAI()
await ai.summarize(document)
```

That's it. No provider setup. No key management. No stream plumbing. No environment detection. The same call works in a native iOS app, an Android WebView, a mobile browser, a desktop browser, and a Next.js server — and routes to the right model automatically.

---

## How routing works: two verticals

Every `useAI` call routes to one of two verticals: **LOCAL** or **CLOUD**. That's the only decision the developer ever needs to think about — and even that defaults to `'auto'`.

<!-- HF2: Two Verticals -->
![Two Verticals](https://github.com/user-attachments/assets/HF2_PLACEHOLDER)

```
LOCAL                               CLOUD
────────────────────                ────────────────────
On-device. Private. Free.           Managed keys. Pay per token.

├── Native Bridge                   ├── Anthropic
│   CoreML (iOS)                    ├── OpenAI
│   ONNX / LiteRT (Android)         └── Ollama (self-hosted)
├── TF.js WASM (mobile web)
├── LiteRT-LM (desktop web)
└── Server-local (Node / Ollama)
```

Default policy: **cloud responds instantly on first call** while the local model loads in the background. Once local is ready, subsequent calls prefer local silently. The developer sees nothing change.

---

## The browser tier

Browser-local inference is split by device capability — and the framework picks automatically:

<!-- HF3: The Browser Tier -->
![The Browser Tier](https://github.com/user-attachments/assets/HF3_PLACEHOLDER)

| Environment | Engine | Notes |
|---|---|---|
| Mobile browser | TF.js WASM | 25–50MB bundled, zero download, instant |
| Desktop browser (opt-in) | LiteRT-LM via WebGPU | 76 tok/s, same `.litertlm` format as Android Native Bridge |

Both run inside a **Web Worker by default**. Main thread stays free for gestures, input, and animations. The framework manages the worker lifecycle — developer never touches it.

> **Why not Chrome Built-in AI (window.ai)?**  
> Requires 22GB free disk, >4GB VRAM, desktop Chrome only — no Android, no iOS, no WebView. Too narrow for a mobile-first framework.

---

## The interface

The full public surface a developer touches:

<!-- HF4: The Interface -->
![The Interface](https://github.com/user-attachments/assets/HF4_PLACEHOLDER)

```js
const ai = useAI()

// Named capabilities — declare the intent, framework handles the prompt
await ai.summarize(article, { type: 'bullets', length: 'short' })
await ai.translate(text, { from: 'en', to: 'ja' })
await ai.rewrite(draft, { tone: 'formal' })
await ai.write("Onboarding email for a fintech app", { format: 'email' })
await ai.vision(receiptImage, "Extract the total amount")

// Raw calls when you need them
await ai.generate("Explain this error message")
const { stream, cancel } = ai.stream("Write a product description for...")

// Stateful sessions — history managed automatically
const ai = useAI({ sessionMode: 'stateful' })
await ai.generate("What is the capital of France?")
await ai.generate("And its population?")  // hook remembers
```

Every parameter is tunable — nothing is required:

```js
const ai = useAI({
  provider: 'anthropic',     // or 'openai', 'ollama'
  routing: 'auto',           // 'local-only' | 'cloud-only'
  sessionMode: 'stateful',   // or 'one-shot'
  temperature: 0.3,
  systemPrompt: 'You are a medical assistant. Be concise and accurate.',
  maxTokens: 1024,
})
```

Config resolves in layers — compliance floor → ops runtime override → hook defaults → per-call override. Highest wins.

---

## From intent to output

<!-- HF5: From Intent to Output -->
![From Intent to Output](https://github.com/user-attachments/assets/HF5_PLACEHOLDER)

**SSR:** `useAI` on the server routes to cloud, returns a complete response, pre-populates state.  
**Hydration:** Client mounts, sees the state is already there, skips the AI call entirely. No double cost. No flicker.  
**CSR streaming:** `ai.stream()` pushes delta chunks live into state — token by token.  
**Stateful:** Session history is serialized and replayed automatically on layer switches (e.g. CONTEXT_OVERFLOW → cloud upscale).  
**Usage:** Every response includes `ttft`, `totalLatency`, `inputTokens`, `outputTokens`, `estimatedCost`, `provider`, `layer` — zero extra code. OTel span emitted automatically.

---

## What's NOT in scope (for this RFC)

- Agent loops / multi-step reasoning — this is a single-call primitive
- Fine-tuning or model training
- Provider billing integration beyond `estimatedCost` on the usage object

---

## Open questions for the community

1. **Routing transparency** — should `useAI` expose which layer was used on every render, or only on demand via the usage object?
2. **Download consent UX** — for LiteRT-LM desktop opt-in, should Catalyst provide a default consent dialog, or leave that to the app?
3. **Named capability extensibility** — should developers be able to register custom named capabilities (e.g. `ai.diagnose()`, `ai.review()`) or keep the set fixed?
4. **Session persistence** — should stateful sessions survive page reloads (via IndexedDB/localStorage), or reset on navigation by default?
5. **Compliance floor** — what fields in `catalyst.config.js` should be locked (non-overridable by ops or hook), and which should be dynamic?

---

## Implementation plan

The work splits into three phases:

**Phase 1 — Core types and adapters**
- `packages/catalyst-core/src/ai/types.ts` — full TypeScript interfaces
- `packages/catalyst-core/src/ai/adapters/` — browserAdapter, nativeAdapter, serverAdapter
- `packages/catalyst-core/src/ai/AIRouter.ts`

**Phase 2 — The hook and server endpoint**
- `packages/catalyst-core/src/ai/useAI.ts`
- `packages/catalyst-core/src/server/routes/ai.ts` — SSE streaming endpoint

**Phase 3 — Native bridge**
- `NativeInterfaces.js` — AI_GENERATE, AI_STREAM_CANCEL, AI_MODEL_STATUS commands
- iOS `BridgeCommandHandler.swift` — CoreML inference
- Android `NativeBridge.kt` — ONNX / LiteRT inference

---

Feedback welcome on the open questions, the interface shape, or anything missing. This is an early RFC — nothing is locked.

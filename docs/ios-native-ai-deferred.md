# iOS Native AI — Deferred Decision Record

**Date:** 2026-06-17  
**Status:** Deferred — revisit when FoundationModels (iOS 26+) stabilises  
**Author:** Mayank Mahavar

---

## Context

After completing Android native AI (LiteRT-LM, confirmed working on physical OnePlus 11), we investigated replicating the same capability on iOS. This document records what we researched, why we deferred, and exactly what to do when we revisit.

---

## What Android Has (the baseline)

| Piece | Android |
|---|---|
| Runtime | LiteRT-LM (`com.google.ai.edge.litertlm:0.13.1`) |
| Model format | `.litertlm` (HuggingFace `litert-community/`) |
| Models | `gemma-4-E2B-it.litertlm` (~1.87GB), `Qwen3-0.6B-it-int4.litertlm` (~474MB) |
| GPU | OpenCL via `Backend.GPU()`, CPU fallback |
| Stateful sessions | `Conversation` object persisted in `NativeBridge.kt` |
| SSE server | Ktor (`POST /framework-{sessionId}/ai/stream`) |
| Bridge | `@JavascriptInterface` — `initAI`, `generateNative`, `clearNativeConversation` |

---

## What iOS Would Need

### 1. Model Runtime

**Researched options (June 2026):**

| Option | Tok/s | Streaming | Multi-turn | Notes |
|---|---|---|---|---|
| `SpeziLLM` (StanfordSpezi) | 15–25 | ✓ AsyncThrowingStream | ✓ LLMLocalSession | Research SDK, not production mobile |
| `ggml-org/llama.cpp` SPM | 15–30 | ✓ | ✓ (explicit llama_context) | C++ bindings, build complexity |
| MLX Swift | ~61 | ✓ | ✓ | MLX model format, not GGUF |
| `FoundationModels` (Apple) | ~30 | ✓ | ✓ | **iOS 26+ / iPhone 15 Pro+ only. Zero download. Best long-term option.** |

**Why we didn't proceed:**
- SpeziLLM is Stanford research tooling — not a production mobile SDK like LiteRT-LM
- llama.cpp raw = C++ Swift bindings, binary size hit, simulator broken
- MLX requires different model format (not GGUF)
- FoundationModels requires iOS 26+ and Apple Intelligence eligibility — not a baseline yet

**Recommended runtime when we revisit:** `FoundationModels` framework once iOS 26 is the minimum target.

### 2. Model Files

iOS would use **GGUF format** (not `.litertlm` — completely different):

| Model key | HuggingFace repo | File | Size | Quantization |
|---|---|---|---|---|
| `qwen3-0.6B` | `Qwen/Qwen3-0.6B-GGUF` | `qwen3-0.6b-q4_k_m.gguf` | ~400MB | Q4_K_M |
| `gemma-3-4B` | `google/gemma-3-4b-it-qat-q4_0-gguf` | `gemma-3-4b-it-q4_0.gguf` | ~2.5GB | Q4_0 |

Recommended quantization for iPhone: **Q4_K_M** (best balance of speed/quality/size).

### 3. HTTP Server (SSE)

**Current iOS `FrameworkServerUtils.swift`** uses `NWListener` — GET-only, one-shot (cancels after every response). SSE needs POST + keep-alive + streaming. Rewriting NWListener for SSE is significant surgery.

**Researched alternatives:**
- `WKURLSchemeHandler` — **ruled out permanently**: WebKit bug #191362 drops POST body, iOS 17+ CSS regressions
- `FlyingFox` — modern async/await but no documented SSE/chunked streaming examples
- **`Hummingbird 2`** — best fit: async/await native, documented streaming, mature. This is the one to use.

**When we revisit:** Replace or extend `FrameworkServerUtils.swift` with Hummingbird 2. Add:
- `POST /framework-{sessionId}/ai/stream` — reads `{prompt, genConfig, conversationId}`, streams SSE frames
- `OPTIONS /framework-{sessionId}/ai/stream` — CORS preflight
- Keep existing `GET /file-{fileId}` and `GET /status` routes

### 4. NativeBridge.swift Changes Needed

Three new cases in `executeCommand()` switch:
```swift
case "initAI":                  // download + load model, set stream URL
case "generateNative":          // re-emit ON_AI_READY if engine warm
case "clearNativeConversation": // nil conversation vars
```

Events to emit (already in NativeInterfaces.js from Android work):
- `ON_AI_LOG` — debug messages
- `ON_AI_PROGRESS` — `{phase, percent, bytesLoaded, bytesTotal, detail}`
- `ON_AI_READY` — `{url, port, sessionId}`
- `ON_AI_ERROR` — error string

### 5. Simulator Limitation

| What | Simulator | Physical Device |
|---|---|---|
| Build + SPM resolve | ✓ | ✓ |
| FrameworkServer start | ✓ | ✓ |
| Bridge command routing | ✓ | ✓ |
| Model download | ✓ | ✓ |
| Engine load (Metal) | ✗ hangs/crashes | ✓ |
| Token streaming | ✗ | ✓ |
| Stateful sessions | ✗ | ✓ |

Physical iPhone required for any real testing. Same constraint as Android (emulator didn't work there either).

---

## Why We Deferred

1. **Cloud path already works** — `useAI` hook with OpenAI cloud provider covers every iPhone, every iOS version, today. Stateful sessions, attachment system, streaming — all working.
2. **No production-grade iOS runtime** — LiteRT-LM has no iOS equivalent. The closest options (SpeziLLM, llama.cpp SPM) are research/community projects with unknown production stability.
3. **FoundationModels is the right answer, just too early** — Apple's own on-device framework with zero download, ~30 tok/s, private. But iOS 26+ / iPhone 15 Pro+ only as of June 2026. Not a baseline.
4. **High unknown count** — Hummingbird SSE unproven, SpeziLLM stateful session details undocumented, simulator broken for testing, GGUF separate from .litertlm.
5. **Better use of time** — pending cloud path todos (example-based system prompt, genConfig wiring, E2E attachment tests) deliver more immediate value.

---

## Revisit Trigger

**Primary:** When `FoundationModels` framework is the right minimum iOS target (iOS 26+ adoption reaches ~70%+ of active devices). Expected: late 2027.

**Secondary:** If a concrete user requirement for offline inference emerges that cloud cannot satisfy.

---

## Implementation Plan (when revisiting)

### Phase 1 — FoundationModels path (recommended)
1. Add `import FoundationModels` — no SPM dependency, ships with iOS 26+
2. Guard with `@available(iOS 26, *)` and `SystemLanguageModel.isAvailable`
3. `LanguageModelSession` already handles multi-turn context — no custom KV-cache management
4. Wire `generateResponse(prompt:)` async stream into existing SSE supplier pattern
5. Estimated: 2–3 days

### Phase 2 — llama.cpp fallback for older devices (optional)
1. Add `ggml-org/llama.cpp` SPM package
2. Implement `MODEL_REGISTRY` with GGUF entries (see table above)
3. Download to `Documents/ai_models/` with temp+rename pattern
4. Wrap `llama_context` for stateful sessions
5. Replace NWListener SSE with Hummingbird 2
6. Estimated: 1–2 weeks, needs physical device throughout

### JS side
No changes needed to `useAI.js` — the SSE URL contract and event names are identical to Android.

---

## Related Files

- `NativeBridge.kt` — Android reference implementation for all AI methods
- `FrameworkServerUtils.kt` — Android Ktor SSE route reference
- `NativeBridge.swift` — iOS file to extend
- `FrameworkServerUtils.swift` — iOS file to extend (NWListener → Hummingbird)
- `useAI.js` — JS hook, no changes needed
- `docs/content/useai-rfc.md` — useAI RFC with full architecture

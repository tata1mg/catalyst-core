---
title: Errors
slug: errors
id: errors
---

# Errors

The AI hooks report a problem through `error`, with a code you can test and a message that says what to do. This page lists what you can see
and why.

## When something is missing

When a requirement is missing, the AI hooks report it through `error`. What is missing decides what you get:

| What is missing | What you see | Code |
|-----------------|--------------|------|
| `catalyst-ai` is not installed | `error` says to run `npm install catalyst-ai`; `generate()` returns that error. Logged once to the console | [`AI-010`](https://github.com/tata1mg/catalyst-core/blob/main/errors/AI/AI-010.md) |
| The provider has no key, or AI is switched off on the server | An error from the route that says which | `AI-001`, `AI-002` |
| The page is not inside the native app (for `native`, `litert`, `foundation-models`) | `error` explains that the bridge is unavailable. With `provider: "auto"` the hook picks another model instead | `AI-004` |
| The browser has no WebGPU, or the worker could not start | `error` with the reason; the other models are still available | `AI-008`, `AI-009` |
| Microphone permission was refused | `error.code` is `PERMISSION_DENIED`, not a generic failure | |
| The shell is too old to know a command (iOS) | The hook answers at once that the feature is unavailable. It does not wait | |
| `web-txt2img` is not installed (on-device pictures) | "On-device image generation needs the web-txt2img package. Install it with: npm i web-txt2img @xenova/transformers onnxruntime-web" | |

Check `error.code` and show `error.message`: it already says what to do.

```javascript
const { error } = useAI({ provider: "litert" });

if (error?.code === "AI-004") return <p>On-device AI needs the app.</p>;
```

## Rules the AI hooks follow

These are checked by tests for the AI hooks:

1. **Importing does not need the package.** Only calling an AI hook does.
2. **A missing requirement is reported, not thrown during render.** The hook returns `error` (a registry error with a code and a suggested
   action) and its action (`generate`, `scan`, `transcribe`, `run`) returns an error result.
3. **Fallbacks are chosen by you, not by surprise.** Where a fallback exists (`auto` routing picks another model) it is named in
   [Choosing a Hook](/content/Catalyst%20AI/choosing-a-hook). Nothing leaves the device unless your policy allows it.
4. **`cancel()` stops the work**, and a call that was replaced does not overwrite the newer one.

## Related

- [Hooks reference](/content/API%20Reference/hooks): every hook's return values and examples, and which platforms support it.
- Error codes: see the `AI-0xx` pages in the [error index](https://github.com/tata1mg/catalyst-core/tree/main/errors/AI).

---
title: What is Catalyst AI
slug: what-is-catalyst-ai
id: what-is-catalyst-ai
---

# What is Catalyst AI

Say your app lets a customer record a voice note and wants a one-paragraph summary.

- On a new iPhone the summary can be made **on the phone**: the audio never leaves it, it works offline, and it costs nothing per request.
- In a desktop browser it can run in the **browser tab**, after a one-time model download.
- On an older Android phone, where the model will not fit, it can fall back to a **cloud model**, if you allow that.

Catalyst AI is the part of Catalyst that makes this one piece of code instead of three:

```javascript
const { generate, output, error } = useAI({ provider: "auto" });
```

`provider: "auto"` looks at the device, your cost limits and your privacy rules, and picks where the model runs. You can also name the
place yourself (`"native"`, `"transformers"`, `"openai"`, `"gemini"`), and you handle one result shape and one error shape either way.

## Words used on these pages

| Term | Meaning here |
|------|--------------|
| **Provider** | Where a model runs: a cloud service (`openai`, `gemini`, `anthropic`), the browser (`transformers`, `prompt-api`), or the phone (`native`, `litert`, `foundation-models`) |
| **On-device** | The model runs on the person's own phone, inside your Catalyst app. Nothing is sent to a server |
| **WebGPU** | A browser feature that lets a page use the graphics chip. In-browser models need it |
| **Routing policy** | Your rules for `provider: "auto"`: which places are allowed, what may leave the device, and cost and speed limits. It lives in `AI_CONFIG.routing` |
| **Consent** | When the policy says "ask", the hook pauses with status `"needs-consent"` until the person agrees |
| **Tool** | A function of yours that a model may call (`useAgent`) |

## Why it exists

A modern app has three places a model can run, and each one is good at something different:

| Where | Good at | Costs you |
|-------|---------|-----------|
| **On the device** (the phone's own model) | Privacy, working offline, no per-request bill | A first download (hundreds of MB to a few GB), battery, smaller models |
| **In the browser** (WebGPU, Chrome's built-in model) | Reaching people who have not installed your app | A download per browser, a capable device |
| **In the cloud** (OpenAI, Gemini, Anthropic) | The strongest models, works on any device | Money per request, and the data leaves the device |

Without a framework you would write three integrations, three loading states, three ways to fail, and a pile of `if` statements to choose
between them. Catalyst AI gives you one hook and one error model, and moves the choice into configuration.

## How it fits into Catalyst

Catalyst AI is deliberately **optional**. The framework (`catalyst-core`) works without it. When you need AI you add the package, and the
hooks that were already importable start working:

```text
your React code
   |  useAI, useVision, useTranscribe, useAgent, usePipeline ...      (catalyst-core/hooks)
   v
catalyst-ai  (npm package you install)
   |-- cloud models   -> your Express server route (/ai)  -> OpenAI / Gemini / Anthropic   (the API keys are read from your server's config; the browser only calls your `/ai` route)
   |-- browser models -> a web worker (Transformers.js on WebGPU, or Chrome's Prompt API)
   '-- device models  -> the native app shell (iOS and Android)  -> Gemma 4, Qwen3, Apple Foundation Models
```

- **The hooks** live in `catalyst-core/hooks`, next to `useCamera` and `useFilePicker`, and follow the same rules: they report errors through
  an `error` value, and tell you what is missing.
- **The package** (`catalyst-ai`) holds the model engines, the server route, and the native plugins. You install it only if you use AI.
- **The server route** keeps your API keys on the server and gives the browser a single endpoint.
- **The native plugins** run models on the phone, download them with pause and resume, and ask for permissions for you.

If you call an AI hook without the package installed, you get an error that says `npm install catalyst-ai`. The rest of `catalyst-core` keeps
working.

## What you can build with it

| You want to | Use |
|-------------|-----|
| Chat, summarise, rewrite, answer | [`useAI`](/content/Catalyst%20AI/hooks-and-errors) |
| Read a receipt, form or screenshot into typed data | `useVision` |
| Turn speech into text, live or from a recording | `useTranscribe` |
| Let a model use your app's functions | `useAgent` |
| Chain speech, text, data and pictures into one flow | `usePipeline` |
| Make pictures, or speak text aloud | `useImageGen`, `useSpeech` |

## What you can rely on

- **On-device first.** With `provider: "auto"` the phone's own model is tried before the browser and the cloud.
- **Media stays put.** Images and audio are sent to a cloud model only if your routing policy allows it (`cloudMedia`). Text asks first when the
  policy is `"ask"`.
- **A problem is an `error`, not a blank screen.** A missing package, a missing key, a refused microphone permission or a model that is not ready
  each give an `error` with a code and a message. The table in [Hooks and Errors](/content/Catalyst%20AI/hooks-and-errors#when-something-is-missing) lists them.
- **You set the limits.** Cost caps, consent, `cancel()`, and the list of models that may be used are all configuration or options.
- **It is optional.** An app that does not use AI does not install `catalyst-ai`.

## Next

- [Quick Start](/content/Catalyst%20AI/quick-start): install it and get a first answer on screen.
- [Hooks and Errors](/content/Catalyst%20AI/hooks-and-errors): every AI hook, where the model runs, and what happens when something is missing.
- [Hooks reference](/content/API%20Reference/hooks): every hook, with return values and examples.

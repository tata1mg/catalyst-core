---
title: What is Catalyst AI
slug: what-is-catalyst-ai
id: what-is-catalyst-ai
---

# What is Catalyst AI

**One hook. Any model. Your rules.**

Catalyst AI is how a Catalyst app talks to a language model, wherever that model lives: on your server's cloud account, inside the browser, or
on the phone itself. You write the same code for all of them. The framework worries about where the model is, what it costs, and whether the
person's words are allowed to leave their device.

```javascript
const { generate, output, error } = useAI({ provider: "auto" });
```

That one line can end up talking to Gemma running on an iPhone, Apple's built-in model, a model in the browser tab, or Gemini in the cloud,
depending on the device and on the policy you set.

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
   |-- cloud models   -> your Express server route (/ai)  -> OpenAI / Gemini / Anthropic   (keys never reach the browser)
   |-- browser models -> a web worker (Transformers.js on WebGPU, or Chrome's Prompt API)
   '-- device models  -> the native app shell (iOS and Android)  -> Gemma 4, Qwen3, Apple Foundation Models
```

- **The hooks** live in `catalyst-core/hooks`, next to `useCamera` and `useFilePicker`, and follow the same rules: they report errors through
  an `error` value, and tell you what is missing.
- **The package** (`catalyst-ai`) holds the model engines, the server route, and the native plugins. You install it only if you use AI.
- **The server route** keeps your API keys on the server and gives the browser a single endpoint.
- **The native plugins** run models on the phone, download them with pause and resume, and ask for permissions for you.

If you call an AI hook without the package installed, you get a clear error that says `npm install catalyst-ai`. Nothing else in your app
is affected.

## What you can build with it

| You want to | Use |
|-------------|-----|
| Chat, summarise, rewrite, answer | [`useAI`](/content/Catalyst%20AI/hooks-and-errors) |
| Read a receipt, form or screenshot into typed data | `useVision` |
| Turn speech into text, live or from a recording | `useTranscribe` |
| Let a model use your app's functions | `useAgent` |
| Chain speech, text, data and pictures into one flow | `usePipeline` |
| Make pictures, or speak text aloud | `useImageGen`, `useSpeech` |

## Principles

1. **Private by default.** On-device comes first when you use `provider: "auto"`. Images and audio do not go to the cloud unless your policy
   says so, and text asks first.
2. **Nothing fails silently.** A missing package, a missing key, a refused permission or a model that is not ready is an `error` with a code
   and a message that says what to do.
3. **You stay in control.** Cost limits, consent, cancel, and which models are allowed are all yours to set.
4. **Optional.** Apps that do not use AI do not pay for it.

## Next

- [Quick Start](/content/Catalyst%20AI/quick-start): install it and get a first answer on screen.
- [Hooks and Errors](/content/Catalyst%20AI/hooks-and-errors): every AI hook, where the model runs, and what happens when something is missing.
- [Hooks reference](/content/API%20Reference/hooks): every hook, with return values and examples.

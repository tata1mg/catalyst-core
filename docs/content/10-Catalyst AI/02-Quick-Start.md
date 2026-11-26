---
title: Quick Start
slug: quick-start
id: quick-start
---

# Quick Start

This gets a first answer on screen using a cloud model, then shows how to move it onto the device.

## 1. Install

```bash
npm install catalyst-ai
```

`catalyst-core` must already be in your app. Nothing else is installed with it: the packages for on-device pictures (`web-txt2img`) and
the browser engines are optional and are only needed if you use those features.

## 2. Configure

Add `AI_CONFIG` to your app's `config/config.json`. Keep keys out of source control.

```json
{
  "AI_CONFIG": {
    "enabled": true,
    "basePath": "/ai",
    "providers": {
      "gemini": { "apiKey": "", "defaultModel": "gemini-3.5-flash" }
    }
  }
}
```

- `providers`: the cloud providers you use and their keys. The server holds the keys; the browser only calls `/ai`. Put the real `apiKey` in a config
  file that is not committed (or generate it at deploy time from your secrets store). A provider with an empty key is reported as not configured, and the
  Ask button below will show that error.
- `browser`: the model used for `provider: "transformers"` (runs in the browser).
- `routing`: the policy for `provider: "auto"` (where models may run, what may leave the device, cost limits).

> **Protect the route before you deploy it.** `/ai` has no sign-in or rate limiting of its own: anyone who can reach it can spend your provider
> account. Put it behind your own authentication and a rate limit.

## 3. Ask

```javascript
import { useAI } from "catalyst-core/hooks";

export default function Ask() {
  const { generate, output, loading, streaming, error } = useAI({ provider: "gemini" });

  return (
    <>
      <button disabled={loading || streaming} onClick={() => generate({ messages: [{ role: "user", content: "Say hello" }] })}>
        Ask
      </button>
      {error && <p role="alert">{error.message}</p>}
      <p>{output}</p>
    </>
  );
}
```

If `catalyst-ai` is missing, the button shows the error "useAI requires catalyst-ai, which is not installed. Run: npm install catalyst-ai".

## 4. Move it onto the device

Change one option:

| Option | What happens |
|--------|--------------|
| `provider: "transformers"` | Runs in the browser on WebGPU. The model downloads once and is cached |
| `provider: "native"` | Runs on the phone inside the app (Gemma 4 on iOS and Android, Apple's model as the iOS fallback). Requires `WEBVIEW_CONFIG.ai.enabled` |
| `provider: "auto"` | Picks for you: on the device first, then by speed and cost, within your `routing` policy |

On the device the first use downloads the model (Gemma 4 E2B is about 2.6 GB). The download can be paused, and resumes from where it stopped. With
`native`, the first call waits for the model: read `modelReady` and `downloadProgress` from the hook to keep the button disabled and show progress.

## 5. Handle what can go wrong

Failures arrive as `error` with a `message` you can show. Failures the framework recognises carry a `code` you can test; a cloud request that the
server rejects (a bad key, a rate limit, a provider outage) arrives as a plain error whose message holds the status and the server's reason, with no `code`:

```javascript
if (error?.code === "AI-010") {
  // catalyst-ai is not installed
} else if (error) {
  // show error.message: it says what happened
}
```

The full list of cases, and what each one means, is in [Errors](/content/Catalyst%20AI/errors#when-something-is-missing).

## What to build next

[Recipes](/content/Catalyst%20AI/recipes) has five complete examples: a chat that picks the best model, reading a photo into typed data, a voice note summary that stays on the phone, an assistant that calls your functions, and a voice-to-picture pipeline.

## Try it on a phone

The `examples/useai` app in the repository has working pages for text, images and audio, a camera scanner, and a pipeline lab. Its
`IOS_DEVICE_TEST.md` (in `examples/useai`) walks through running it on a real iPhone.

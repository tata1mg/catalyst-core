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

- `providers`: the cloud providers you use and their keys. The server holds the keys; the browser only calls `/ai`.
- `browser`: the model used for `provider: "transformers"` (runs in the browser).
- `routing`: the policy for `provider: "auto"` (where models may run, what may leave the device, cost limits).

## 3. Ask

```javascript
import { useAI } from "catalyst-core/hooks";

export default function Ask() {
  const { generate, output, loading, error } = useAI({ provider: "gemini" });

  return (
    <>
      <button disabled={loading} onClick={() => generate({ messages: [{ role: "user", content: "Say hello" }] })}>
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

On the device the first use downloads the model (Gemma 4 E2B is about 2.6 GB). The download can be paused, and resumes from where it stopped.

## 5. Handle what can go wrong

Every failure arrives as `error`, with a `code` you can test and a `message` you can show:

```javascript
if (error?.code === "AI-010") {
  // catalyst-ai is not installed
}
```

The full list of cases, and what each one means, is in [Hooks and Errors](/content/Catalyst%20AI/hooks-and-errors#when-something-is-missing).

## Try it on a phone

The `examples/useai` app in the repository has working pages for text, images and audio, a camera scanner, and a pipeline lab. The
[iOS device test guide](https://github.com/tata1mg/catalyst-core/blob/main/examples/useai/IOS_DEVICE_TEST.md) walks through running it on a real iPhone.

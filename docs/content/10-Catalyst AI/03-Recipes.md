---
title: Recipes
slug: recipes
id: recipes
---

# Recipes

Five things people build with Catalyst AI, each with the config and the code. Every recipe assumes `npm install catalyst-ai` and an
`AI_CONFIG` block in `config/config.json` (see the [Quick Start](/content/Catalyst%20AI/quick-start)).

## 1. A chat that uses the best model for the device

**You want:** answers from the phone's own model when it can, and a cloud model only when it cannot.

```json
{
  "AI_CONFIG": {
    "enabled": true,
    "providers": { "gemini": { "apiKey": "", "defaultModel": "gemini-3.5-flash" } },
    "routing": {
      "policy": { "objective": "balanced", "order": ["onDevice", "cost", "latency"], "cloud": "ask", "cloudMedia": "deny" },
      "onDevice": {
        "ios": [{ "id": "gemma-e2b", "engine": "litert", "modalities": ["text", "image", "audio"] }],
        "android": [{ "id": "gemma-e2b", "engine": "litert", "modalities": ["text", "image", "audio"] }]
      },
      "cloud": [{ "id": "gemini-flash", "provider": "gemini", "model": "gemini-3.5-flash", "modalities": ["text", "image", "audio"] }]
    }
  }
}
```

```javascript
import { useAI } from "catalyst-core/hooks";

function Chat() {
  const ai = useAI({ provider: "auto" });
  const send = async (text) => {
    const result = await ai.generate({ messages: [{ role: "user", content: text }] });
    if (result.route?.action === "ask") {
      // The policy said "ask" and only the cloud can answer: show a button, then ai.generate(..., { cloud: true })
    }
  };
  return <p>{ai.output}</p>;
}
```

`order` puts on-device models first, then the cheaper one, then the faster one. `cloud: "ask"` means text only leaves the device after the
person agrees. `cloudMedia: "deny"` means photos and audio never do.

## 2. Read a photo into typed data

**You want:** a lab report, receipt or form turned into an object your code can trust.

```javascript
import { useEffect } from "react";
import { useVision, useCamera } from "catalyst-core/hooks";

const schema = {
  type: "object",
  required: ["merchant", "total"],
  properties: { merchant: { type: "string" }, total: { type: "number" }, currency: { type: "string" } },
};

function ScanReceipt() {
  const camera = useCamera();
  const { scan, data, status, error } = useVision({ schema, instructions: "Read this receipt." });

  // The photo arrives asynchronously from the camera: scan it once per capture.
  useEffect(() => {
    if (camera.data) scan(camera.data);
  }, [camera.data]);

  return (
    <>
      <button onClick={() => camera.execute()}>Take photo</button>
      {status === "needs-consent" && <p>Only a cloud model can read this. Ask the person first.</p>}
      {data && <p>{data.merchant}: {data.total} {data.currency}</p>}
      {error && <p role="alert">{error.message}</p>}
    </>
  );
}
```

`useVision` does not open the camera itself: capture with `useCamera` (or a file input) and pass the result to `scan`.
The reply is checked against `schema`. If it is unusable the model is told what was wrong and tried again (`maxAttempts`, default 2).
With `cloudMedia: "deny"`, a cloud model never sees the photo unless the person approves it.

## 3. Turn a voice note into a summary, on the phone

**You want:** speech to text and a summary, with nothing leaving the device.

```javascript
import { useTranscribe, useAI } from "catalyst-core/hooks";

function VoiceNote() {
  const voice = useTranscribe({ language: "en-US", routing: { cloud: "deny", cloudMedia: "deny" } });
  const ai = useAI({ provider: "auto", routing: { cloud: "deny", cloudMedia: "deny" } });

  const run = async () => {
    const heard = await voice.listen(); // the phone's own recogniser inside the app
    if (!heard?.text) return;
    await ai.generate({ messages: [{ role: "user", content: `Summarise in one paragraph:\n${heard.text}` }] });
  };
  return <><button onClick={run}>Record</button><p>{voice.partial || voice.text}</p><p>{ai.output}</p></>;
}
```

`cloud: "deny"` means there is no consent step: if no on-device engine can do it, nothing is sent anywhere, and `route` tells you why.

## 4. An assistant that uses your app's own functions

**You want:** "scan this report and fill in the form", where the model decides the steps and your code does them.

```javascript
import { useAgent } from "catalyst-core/hooks";

const agent = useAgent({
  instructions: "You help the user file a lab report.",
  limits: { maxSteps: 6, maxSpendUsd: 0.05 },
  tools: [
    { name: "scan_report", description: "Read the lab report on screen", run: () => scan() },
    { name: "fill_form", description: "Fill the form fields", parameters: { type: "object", required: ["values"], properties: { values: { type: "object" } } }, run: ({ values }) => setForm(values) },
    { name: "submit_form", description: "Submit the form", sideEffect: true, run: () => submit() },
  ],
});

await agent.run("Scan this report and fill in the form");
// agent.pendingConfirmation is { tool: "submit_form", ... }: show a button, then agent.approve() or agent.deny()
```

A tool marked `sideEffect` never runs without `approve()`. `maxSteps` and `maxSpendUsd` are enforced in code, not left to the prompt.

## 5. Voice to picture, as one flow

**You want:** speak a scene, get a picture, and stop if a step would send data somewhere you did not allow.

```javascript
// `voice` is a useTranscribe(...) and `ai` a useAI(...) from your component; `schema` describes the scene (for example { scene: string }).
import { usePipeline, transcribeStage, jsonStage, imageStage } from "catalyst-core/hooks";
import { requestImage, imageCost } from "catalyst-ai";

const stages = [
  transcribeStage((audio) => voice.transcribe(audio).then((r) => r?.text ?? "")),
  jsonStage({ schema, generate: (prompt) => ai.generate({ messages: [{ role: "user", content: prompt }] }) }),
  imageStage({ requestImage, prompt: (json) => json.scene, cost: (r) => r.usage && imageCost(r.usage).cost }),
];
const pipeline = usePipeline(stages, { maxCostUsd: 0.1 });

await pipeline.run(recording);
if (pipeline.status === "needs-consent") await pipeline.run(recording, { cloudPolicy: "allow" }); // after the person agreed
```

A stage whose output type does not match the next stage's input is caught before the run starts, and a transcript of a person speaking is
not sent to a cloud stage unless you allow it.

## Where next

- [Choosing a Hook](/content/Catalyst%20AI/choosing-a-hook) and [Errors](/content/Catalyst%20AI/errors): every option and result, and what each failure looks like.
- [What is Catalyst AI](/content/Catalyst%20AI/what-is-catalyst-ai): how the pieces fit together.

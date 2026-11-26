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
import { useState } from "react";
import { useAI } from "catalyst-core/hooks";

function Chat() {
  const ai = useAI({ provider: "auto" });
  const [text, setText] = useState("");
  const [waiting, setWaiting] = useState(null); // a question the person has not answered yet

  const send = async (consent) => {
    const args = waiting ?? { messages: [{ role: "user", content: text }] };
    const result = await ai.generate(args, consent);
    // The policy said "ask" and only the cloud can answer: keep the question and show a button.
    setWaiting(result.route?.action === "ask" ? args : null);
  };

  return (
    <>
      <input value={text} onChange={(e) => setText(e.target.value)} />
      <button onClick={() => send()}>Send</button>
      {waiting && <button onClick={() => send({ cloud: true })}>Allow the cloud for this question</button>}
      <p>{ai.output}</p>
    </>
  );
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
      {status === "denied" && <p>Only a cloud model could read this, and your policy does not allow photos to leave the device.</p>}
      {data && <p>{data.merchant}: {data.total} {data.currency}</p>}
      {error && <p role="alert">{error.message}</p>}
    </>
  );
}
```

`useVision` does not open the camera itself: capture with `useCamera` (or a file input) and pass the result to `scan`.
The reply is checked against `schema`. If it is unusable the model is told what was wrong and tried again (`maxAttempts`, default 2).
With `cloudMedia: "deny"` (as in recipe 1) a photo never goes to the cloud: if only a cloud model could read it, the scan ends as `denied`. With
`cloudMedia: "ask"` it stops at `needs-consent` instead, and `approve({ cloud: true })` runs the same scan again.

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

const done = agent.run("Scan this report and fill in the form"); // pending until the run ends
// While it is pending, render the approval from state: agent.pendingConfirmation is { tool: "submit_form", ... } once the model asks
// for it. Show a button that calls agent.approve() or agent.deny(); the run then continues.
const result = await done;
```

A tool marked `sideEffect` never runs without `approve()`. `maxSteps` is a hard limit enforced in code. `maxSpendUsd` is a soft budget: it is checked between model turns against estimated prices, so a run can
end a little above it.

## 5. Voice to picture, as one flow

**You want:** speak a scene, get a picture, and stop if a step would send data somewhere you did not allow.

```javascript
// `voice` is a useTranscribe(...) and `ai` a useAI(...) from your component; `schema` describes the scene (for example { scene: string }).
import { usePipeline, transcribeStage, jsonStage, imageStage } from "catalyst-core/hooks";
import { requestImage, imageCost } from "catalyst-ai";

const stages = [
  // voice = useTranscribe({ routing: { cloud: "deny", cloudMedia: "deny" } }): the recording stays on the device, so this stage is not `cloud`.
  // If the hook may use a cloud model, pass { cloud: true } as the second argument so cloudPolicy holds the stage back.
  transcribeStage(async (audio) => {
    const heard = await voice.transcribe(audio);
    if (!heard) throw voice.error ?? new Error("The recording could not be transcribed"); // stop the run: no empty transcript for the next stage
    return heard.text;
  }),
  jsonStage({ schema, cloud: true, generate: (prompt) => ai.generate({ messages: [{ role: "user", content: prompt }] }) }),
  imageStage({ requestImage, prompt: (json) => json.scene, cost: (r) => r.usage && imageCost(r.usage).cost }),
];
const pipeline = usePipeline(stages, { maxCostUsd: 0.1, cloudPolicy: "ask" });

const [held, setHeld] = useState(null);

const start = async () => {
  const result = await pipeline.run(recording);
  // Read the returned result: `pipeline.status` is the value from the render before the run, and is stale here.
  if (result.status === "needs-consent") setHeld(recording); // keep the recording and show an "Allow the cloud" button
};

// Only the person's tap runs it again, with the cloud allowed:
const approve = () => pipeline.run(held, { cloudPolicy: "allow" });
```

A stage whose output type does not match the next stage's input is caught before the run starts. Stages marked `cloud: true` (the JSON stage and
the picture stage here) do not run on a transcript of a person speaking unless `cloudPolicy` allows it: the default is `"deny"`, and `"ask"`, used
above, stops with `needs-consent` so you can ask first.

## Where next

- [Choosing a Hook](/content/Catalyst%20AI/choosing-a-hook) and [Errors](/content/Catalyst%20AI/errors): every option and result, and what each failure looks like.
- [What is Catalyst AI](/content/Catalyst%20AI/what-is-catalyst-ai): how the pieces fit together.

## Getting Started

Commence development by initiating the the following commands:

For running the application in development mode, run:

```bash
npm run start
```

For a production build, change NODE_ENV to "production" in config/config.json, then run :

```bash
npm run build
```

To serve the production build, execute:

```bash
npm run serve
```

## Documentation

Explore the complete documentation at [https://catalyst.1mg.com](https://catalyst.1mg.com).

## Pipeline Lab (`/pipeline-lab`)

A demo of `usePipeline`: speech or typed text becomes a transcript, then a JSON scene (checked against a schema), then an image,
either through cloud providers or with the phone's own models. Open `/pipeline-lab` from the home page.

- Copy `config/config.template.json` to `config/config.json` and fill in a provider key. For the image step set
  `AI_CONFIG.providers.<provider>.imageModel` (and `speechModel` for spoken output); for live transcription set
  `providers.gemini.liveModel`. The template ships these empty, so the matching steps report a missing model until you set them.
- In the cloud mode every model stage is a cloud call, so a run stops at **needs consent** until you press Allow: a voice
  recording's words must not reach a provider silently. In the on-device mode the text and speech stages run on the phone.
- The page shows each stage's events as they happen, the estimated spend, and why a run stopped. Cancelling is cooperative
  (see `usePipeline` in the hooks reference).

## On-device pictures (optional)

Pipeline Lab can make pictures in the browser (SD-Turbo on WebGPU). This app declares `web-txt2img` so the page builds, but the engine's own
runtime packages are not installed with it: run `npm install @xenova/transformers onnxruntime-web` in this folder to use the "On-device" image
model. Without them the page says so and offers the cloud model instead.


// Source of the in-browser inference worker, kept in its own file so it can be loaded as a Blob by useWebAI and
// exercised directly by a plain HTML test page (no React, no bundler).

import { createOpfsStorage, createResumableFetch } from "./resumableFetch.js"

export const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js"

export const WORKER_SCRIPT = `
const TRANSFORMERS_CDN = "${TRANSFORMERS_CDN}";

// Resumable downloads (see resumableFetch.js): the two functions are embedded as source because this is a Blob script.
${createOpfsStorage.toString()}
${createResumableFetch.toString()}

let resumable = null;
let downloadPolicy = {};
let pageOnline = typeof navigator === "undefined" || navigator.onLine !== false;

// Point Transformers.js at a fetch that pauses, waits and resumes with Range instead of failing a multi-gigabyte
// download. Anything that cannot be made resumable (no OPFS, small files) just goes through the normal fetch.
async function installResumableFetch(env) {
    try {
        if (!resumable) {
            const storage = await createOpfsStorage();
            if (!storage) {
                self.postMessage({ type: "log", msg: "[worker] origin-private storage unavailable: downloads are not resumable" });
                return;
            }
            resumable = createResumableFetch({
                storage,
                policy: downloadPolicy,
                online: pageOnline,
                fetch: (...args) => fetch(...args),
                onStatus: (status) => self.postMessage(Object.assign({ type: "download_status" }, status)),
                log: (msg) => self.postMessage({ type: "log", msg: "[worker] " + msg }),
            });
        }
        env.fetch = resumable.fetch;
        self.postMessage({ type: "log", msg: "[worker] resumable downloads on" });
    } catch (err) {
        self.postMessage({ type: "log", msg: "[worker] resumable downloads disabled: " + err.message });
    }
}

self.addEventListener("online", () => { pageOnline = true; if (resumable) resumable.setOnline(true); });
self.addEventListener("offline", () => { pageOnline = false; if (resumable) resumable.setOnline(false); });
let pipe = null;
let TextStreamer = null;
let loadedModel = null;
let loadedDevice = null;
let gemma = null; // { processor, model } for media-capable models (Gemma 4), loaded with AutoProcessor + Gemma4ForConditionalGeneration

function makeProgress(fileTotals) {
    return (info) => {
        const { status, file, name, loaded, total } = info;
        const pct = total > 0 ? Math.round((loaded / total) * 100) : null;
        if (total) fileTotals[file || name] = total;
        if (status === "initiate") {
            self.postMessage({ type: "progress", file: file || name, percent: 0, status: "initiate" });
            self.postMessage({ type: "log", msg: "[worker] download initiate: " + (file || name) });
        } else if (status === "download" || status === "progress") {
            self.postMessage({ type: "progress", file: file || name, percent: pct, loaded, total, status: "downloading" });
        } else if (status === "done") {
            self.postMessage({ type: "progress", file: file || name, percent: 100, status: "done" });
            self.postMessage({ type: "log", msg: "[worker] download done: " + (file || name) });
        }
    };
}

// Media-capable path (spike 0.3): WebGPU q4f16 only. There is no wasm fallback: the weights are ~3.4 GB.
async function loadGemma(model) {
    if (gemma && loadedModel === model) {
        self.postMessage({ type: "log", msg: "[worker] gemma cache hit — " + model });
        return;
    }
    self.postMessage({ type: "log", msg: "[worker] importing transformers from CDN..." });
    const mod = await import(TRANSFORMERS_CDN);
    mod.env.allowLocalModels = false;
    await installResumableFetch(mod.env);
    TextStreamer = mod.TextStreamer;
    if (!self.isSecureContext) {
        throw new Error("WebGPU is only available on secure origins (https:// or localhost), and this page is served from " + self.location.origin + ". Open it via https or http://localhost to use image and audio input in the browser.");
    }
    if (!(await navigator.gpu?.requestAdapter())) {
        throw new Error("This browser has no usable WebGPU adapter, which image and audio input need");
    }
    const fileTotals = {};
    const dlStart = performance.now();
    const processor = await mod.AutoProcessor.from_pretrained(model);
    const loaded = await mod.Gemma4ForConditionalGeneration.from_pretrained(model, {
        device: "webgpu",
        dtype: "q4f16",
        progress_callback: makeProgress(fileTotals),
    });
    gemma = { processor, model: loaded, load_image: mod.load_image };
    loadedModel = model;
    loadedDevice = "webgpu";
    const loadMs = Math.round(performance.now() - dlStart);
    const totalBytes = Object.values(fileTotals).reduce((sum, n) => sum + n, 0);
    self.postMessage({ type: "model_ready", device: "webgpu", dtype: "q4f16", loadMs, totalBytes });
}

// The main thread has already converted audio to 16 kHz mono 16-bit WAV (audioPrep.js); workers have no AudioContext.
async function wavToFloat32(dataUrl) {
    const bytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
    const view = new DataView(bytes.buffer);
    const tag = String.fromCharCode(...bytes.slice(0, 4)) + String.fromCharCode(...bytes.slice(8, 12));
    if (tag !== "RIFFWAVE" || view.getUint32(24, true) !== 16000 || view.getUint16(22, true) !== 1) {
        throw new Error("Audio could not be converted to 16 kHz mono WAV for the web engine");
    }
    const samples = new Float32Array((bytes.length - 44) >> 1);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32768;
    return samples;
}

async function loadPipeline(model) {
    if (loadedModel === model && pipe) {
        self.postMessage({ type: "log", msg: "[worker] pipeline cache hit — " + model + " on " + loadedDevice });
        return;
    }

    self.postMessage({ type: "log", msg: "[worker] importing transformers from CDN..." });
    const mod = await import(TRANSFORMERS_CDN);
    mod.env.allowLocalModels = false;
    await installResumableFetch(mod.env);
    TextStreamer = mod.TextStreamer;

    const backends = [
        { device: "webgpu", dtype: "q4f16" },
        { device: "wasm",   dtype: "q4"    },
    ];

    let lastErr = null;
    for (const { device, dtype } of backends) {
        try {
            self.postMessage({ type: "log", msg: "[worker] trying device=" + device + " dtype=" + dtype });
            const fileTotals = {};
            const dlStart = performance.now();

            pipe = await mod.pipeline("text-generation", model, {
                device,
                dtype,
                progress_callback: makeProgress(fileTotals),
            });

            loadedModel = model;
            loadedDevice = device;
            const loadMs = Math.round(performance.now() - dlStart);
            const totalBytes = Object.values(fileTotals).reduce((sum, n) => sum + n, 0);
            self.postMessage({ type: "model_ready", device, dtype, loadMs, totalBytes });
            self.postMessage({ type: "log", msg: "[worker] pipeline ready — device=" + device + " loadMs=" + loadMs });
            return;
        } catch (err) {
            self.postMessage({ type: "log", msg: "[worker] " + device + " failed (" + err.message + "), trying next..." });
            lastErr = err;
            pipe = null;
        }
    }
    throw lastErr || new Error("All backends failed");
}

async function generateWithMedia(model, messages, genConfig, media) {
    await loadGemma(model);
    const { processor, model: net, load_image } = gemma;
    const prompt = processor.apply_chat_template(messages, { enable_thinking: false, add_generation_prompt: true });
    const image = media.images[0] ? await load_image(media.images[0]) : null;
    const audio = media.audios[0] ? await wavToFloat32(media.audios[0]) : null;
    const inputs = await processor(prompt, image, audio, { add_special_tokens: false });
    self.postMessage({ type: "log", msg: "[worker] gemma inputs: promptTokens=" + inputs.input_ids.dims.at(-1) + " image=" + !!image + " audio=" + !!audio });
    self.postMessage({ type: "streaming_start" });

    let tokenCount = 0;
    let ttftFired = false;
    const tGen = performance.now();
    const streamer = new TextStreamer(processor.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        token_callback_function: () => {
            if (!ttftFired) {
                ttftFired = true;
                self.postMessage({ type: "ttft", ms: Math.round(performance.now() - tGen) });
            }
            tokenCount++;
        },
        callback_function: (text) => self.postMessage({ type: "token", text }),
    });
    const { maxTokens, temperature, topP } = genConfig;
    await net.generate({
        ...inputs,
        max_new_tokens: maxTokens ?? 512,
        do_sample: temperature > 0,
        ...(temperature > 0 && { temperature, top_p: topP }),
        streamer,
    });
    const genMs = Math.round(performance.now() - tGen);
    const tps = tokenCount > 0 ? parseFloat((tokenCount / (genMs / 1000)).toFixed(1)) : 0;
    self.postMessage({ type: "done", totalTokens: tokenCount, genMs, tps, promptTokens: inputs.input_ids.dims.at(-1) });
}

self.onmessage = async (e) => {
    const { type, model, messages, genConfig, formatPrompt, media } = e.data;
    // These arrive while a model is still loading (the handler below is awaiting), so they must not queue behind it.
    if (type === "configure") {
        downloadPolicy = e.data.policy || {};
        if (typeof e.data.online === "boolean") pageOnline = e.data.online;
        if (resumable) resumable.setOnline(pageOnline);
        return;
    }
    if (type === "network") {
        pageOnline = !!e.data.online;
        if (resumable) resumable.setOnline(pageOnline);
        return;
    }
    if (type !== "generate") return;

    try {
        if (media) {
            await generateWithMedia(model, messages, genConfig, media);
            return;
        }
        await loadPipeline(model);

        let pipeInput;
        if (formatPrompt) {
            try {
                const overrideFn = new Function("return (" + formatPrompt + ")")();
                const text = overrideFn(messages);
                pipeInput = text;
                self.postMessage({ type: "log", msg: "[worker] using custom formatPrompt (" + text.length + " chars)" });
            } catch (err) {
                self.postMessage({ type: "log", msg: "[worker] formatPrompt failed (" + err.message + "), falling back to tokenizer template" });
            }
        }
        if (!pipeInput) {
            try {
                const text = pipe.tokenizer.apply_chat_template(messages, { tokenize: false, add_generation_prompt: true });
                pipeInput = text;
                self.postMessage({ type: "log", msg: "[worker] chat template applied (" + text.length + " chars)" });
            } catch (err) {
                pipeInput = messages;
                self.postMessage({ type: "log", msg: "[worker] no chat template (" + err.message + "), passing messages array" });
            }
        }

        const pipeInputType = typeof pipeInput === "string" ? "string" : Array.isArray(pipeInput) ? "messages[]" : typeof pipeInput;
        const pipeInputLength = typeof pipeInput === "string" ? pipeInput.length : Array.isArray(pipeInput) ? pipeInput.length : 0;
        self.postMessage({ type: "log", msg: "[worker] pipe input: type=" + pipeInputType + " length=" + pipeInputLength });
        self.postMessage({ type: "streaming_start" });

        let tokenCount = 0;
        let ttftFired = false;
        const tGen = performance.now();

        let batch = "";
        let batchTimer = null;
        const flushBatch = () => {
            batchTimer = null;
            if (!batch) return;
            self.postMessage({ type: "token", text: batch });
            batch = "";
        };

        const streamer = new TextStreamer(pipe.tokenizer, {
            skip_prompt: true,
            skip_special_tokens: true,
            token_callback_function: () => {
                if (!ttftFired) {
                    ttftFired = true;
                    self.postMessage({ type: "ttft", ms: Math.round(performance.now() - tGen) });
                }
                tokenCount++;
            },
            callback_function: (text) => {
                batch += text;
                if (tokenCount % 8 === 0) { clearTimeout(batchTimer); flushBatch(); }
                else if (!batchTimer) { batchTimer = setTimeout(flushBatch, 80); }
            },
        });

        const { maxTokens, temperature, topP, repetitionPenalty, noRepeatNgramSize, earlyStop, ...rest } = genConfig;
        await pipe(pipeInput, {
            max_new_tokens: maxTokens,
            do_sample: temperature > 0,
            temperature,
            top_p: topP,
            repetition_penalty: repetitionPenalty,
            no_repeat_ngram_size: noRepeatNgramSize ?? 3,
            early_stopping: earlyStop ?? true,
            ...rest,
            streamer,
        });

        clearTimeout(batchTimer);
        flushBatch();

        const genMs = Math.round(performance.now() - tGen);
        const tps = tokenCount > 0 ? parseFloat((tokenCount / (genMs / 1000)).toFixed(1)) : 0;
        self.postMessage({ type: "done", totalTokens: tokenCount, genMs, tps });
    } catch (err) {
        self.postMessage({ type: "error", message: err.message || String(err) });
    }
};
`

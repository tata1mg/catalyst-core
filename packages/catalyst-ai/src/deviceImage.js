// image.generate on the device (web desktop): SD-Turbo through the optional `web-txt2img` package on WebGPU (#611).
// Same result shape as the cloud route, so imageStage / useImageGen need no special case: provider "device" swaps the
// backend only. The first call downloads the model (~2.3 GB, then cached by the browser); nothing leaves the device
// except that one download from Hugging Face. Needs a WebGPU browser; phones' tabs will usually run out of memory.

export const DEVICE_IMAGE_MODEL = "sd-turbo"
const DEFAULT_SIZE = 512

// The app owns the heavy optional dependency, so catalyst-ai never imports it (that would make every app's bundler resolve
// it, installed or not). The app registers it once:  registerDeviceImageEngine(() => import("web-txt2img")).
let registered = null
let libPromise = null
let engineOptions = {}
/** options.wasmPaths: where onnxruntime-web finds its .wasm files (a URL prefix ending in "/"), e.g. a CDN folder or your own static path. */
export function registerDeviceImageEngine(loader, options = {}) {
    registered = typeof loader === "function" ? loader : null
    engineOptions = options || {}
    libPromise = null
}
const loadLibrary = () => {
    if (!registered) return Promise.reject(new Error("No on-device image engine registered. Call registerDeviceImageEngine(() => import(\"web-txt2img\")) once at startup."))
    // The package is optional: a loader that fails (not installed) must tell the developer what to install, not surface a raw
    // module-resolution error. A failed load is not remembered, so installing the package and retrying works.
    return (libPromise ??= Promise.resolve().then(registered).catch((error) => {
        libPromise = null
        throw Object.assign(new Error("On-device image generation needs the web-txt2img package. Install it with: npm i web-txt2img @xenova/transformers onnxruntime-web"), { cause: error })
    }))
}

/**
 * Frees SD-Turbo from GPU/RAM (the downloaded files stay cached, so the next picture only re-initialises it).
 * A no-op when nothing is loaded or no engine is registered.
 */
export async function unloadDeviceImage({ load = loadLibrary } = {}) {
    if (!registered && load === loadLibrary) return
    let lib
    try { lib = await load() } catch { return }
    if (lib.isModelLoaded?.(DEVICE_IMAGE_MODEL)) await lib.unloadModel?.(DEVICE_IMAGE_MODEL)
}

// arrayBuffer() + btoa works in browsers and in Node (tests); FileReader would not.
async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ""
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
}

/** { available, reason? }: false when the browser has no WebGPU or the optional package is not installed. */
export async function deviceImageSupport({ load = loadLibrary } = {}) {
    if (typeof navigator === "undefined" || !navigator.gpu) return { available: false, reason: "This browser has no WebGPU (use a recent Chrome or Edge)." }
    try {
        await load()
    } catch {
        return { available: false, reason: "On-device image generation needs the web-txt2img package registered (npm i web-txt2img @xenova/transformers onnxruntime-web, then registerDeviceImageEngine)." }
    }
    return { available: true }
}

/** "512x512" | "auto" | undefined -> { width, height }; SD-Turbo makes 512x512, anything else is refused rather than silently ignored. */
export function parseDeviceSize(size) {
    if (size === undefined || size === "auto") return { width: DEFAULT_SIZE, height: DEFAULT_SIZE }
    const m = /^(\d{3,4})x(\d{3,4})$/.exec(size)
    if (!m) throw new Error('size must be "auto" or WIDTHxHEIGHT')
    const [width, height] = [Number(m[1]), Number(m[2])]
    if (width !== DEFAULT_SIZE || height !== DEFAULT_SIZE) throw new Error(`The on-device image model makes ${DEFAULT_SIZE}x${DEFAULT_SIZE} pictures only`)
    return { width, height }
}

/**
 * -> { images: [{ mimeType, data, url }], usage, model, cost: 0, costPartial: false }  (same shape as the cloud route).
 * `onProgress({ phase, pct?, message? })` reports "loading" (model download, pct 0-100) then denoising/decoding.
 * The model is freed from GPU/RAM after the picture (cached files stay) unless `keepLoaded: true`, because it is ~2.3 GB and
 * usually shares the page with a text model. `load` is injectable for tests. Rejects on cancel, missing WebGPU, or a failed load/generation.
 * @param {any} [options] Destructured here; typed loosely so TypeScript 7 does not narrow callers to the listed defaults.
 */
export async function generateOnDevice({ prompt, size, seed, n, images: inputImages, signal, onProgress, keepLoaded = false, load = loadLibrary } = {}) {
    if (typeof prompt !== "string" || prompt.trim() === "") throw new Error("prompt must be a non-empty string")
    if (inputImages && inputImages.length > 0) throw new Error("The on-device image model cannot edit images yet; use a cloud provider for edits")
    if (n && n > 1) throw new Error("The on-device image model makes one picture per request")
    const { width, height } = parseDeviceSize(size)
    const support = await deviceImageSupport({ load })
    if (!support.available) throw new Error(support.reason)
    const lib = await load()

    let result
    const started = Date.now()
    try {
        if (!lib.isModelLoaded(DEVICE_IMAGE_MODEL)) {
            const loaded = await lib.loadModel(DEVICE_IMAGE_MODEL, {
                backendPreference: ["webgpu"],
                ...(engineOptions.wasmPaths && { wasmPaths: engineOptions.wasmPaths }),
                onProgress: (p) => onProgress?.({ phase: "loading", pct: p.pct, message: p.message }),
            })
            if (!loaded.ok) throw new Error(`Could not load the on-device image model: ${loaded.message || loaded.reason}`)
        }
        if (signal?.aborted) throw new Error("cancelled")

        result = await lib.generateImage({ model: DEVICE_IMAGE_MODEL, prompt, seed, width, height, signal, onProgress })
        if (!result.ok) throw new Error(result.reason === "cancelled" ? "cancelled" : `On-device image generation failed: ${result.message || result.reason}`)
    } finally {
        if (!keepLoaded) await lib.unloadModel?.(DEVICE_IMAGE_MODEL)?.catch?.(() => {})
    }
    const mimeType = result.blob.type || "image/png"
    const data = await blobToBase64(result.blob)
    return {
        images: [{ mimeType, data, url: `data:${mimeType};base64,${data}` }],
        usage: { model: DEVICE_IMAGE_MODEL, images: 1, promptTokens: 0, completionTokens: 0, onDevice: true, timeMs: result.timeMs ?? Date.now() - started },
        model: DEVICE_IMAGE_MODEL,
        cost: 0, // runs on the user's hardware
        costPartial: false,
    }
}

import React, { useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import { useAI, useFilePicker } from "catalyst-core/hooks"
import { renderOutput } from "../../utils/ai"

// Verifies image/audio input through useAI (catalyst-ai content parts) on a real device.
// Native and web run Gemma 4 on the device. Cloud sends the image/audio to the chosen provider, only on this explicit tab.

// Same rule as catalyst-ai's isNativeAIAvailable(), so the page never asks for "native" when useAI would fall back to
// cloud. Kept inline: the app reaches catalyst-ai only through catalyst-core/hooks.
const nativeAIAvailable = () => {
    const bridge = window.NativeBridge
    if (bridge && typeof bridge.isAIAvailable === "function") return !!bridge.isAIAvailable()
    return !!window.webkit?.messageHandlers?.PluginBridge && Array.isArray(window.CatalystPlugins?.["io.catalyst.ai"])
}

const readAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
    })

// Known picture so the answer is checkable: red square, blue circle, the word CATALYST.
const sampleImage = () => {
    const canvas = document.createElement("canvas")
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, 512, 512)
    ctx.fillStyle = "#e11"
    ctx.fillRect(60, 60, 200, 200)
    ctx.fillStyle = "#11e"
    ctx.beginPath()
    ctx.arc(370, 370, 90, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = "#000"
    ctx.font = "bold 56px sans-serif"
    ctx.fillText("CATALYST", 60, 340)
    return canvas.toDataURL("image/png")
}

// Same structured-output components the AITest dashboard uses: the model answers with <tool:create_attachment>
// blocks and renderOutput turns them into Header / InfoCard / list / table components.
const ATTACHMENT_COMPONENTS = {
    Header: { attrs: { level: "1|2|3" }, hint: "section title, body is the heading text" },
    InfoCard: { attrs: { title: "string", type: "info|warning|success" }, hint: "1 sentence callout only" },
    OrderedList: { hint: "steps or lists, one item per line in body" },
    DataTable: { hint: "structured data, body is a markdown table" },
}
const SYSTEM_PROMPT = "You are a helpful assistant. Describe or transcribe exactly what you are given, then structure your answer clearly."

// Web fallback (no native module): models run in Transformers.js. Sizes are what the first Run downloads (cached after),
// measured from the model repos' files for the dtypes the worker loads. "speech" models only transcribe: they return
// plain text and ignore the prompt, so compare them on transcript accuracy, not on structure.
const WEB_MODELS = [
    { id: "onnx-community/gemma-4-E2B-it-ONNX", label: "Gemma 4 E2B (image + audio + text)", size: "~3.4 GB", kind: "multimodal" },
    { id: "onnx-community/gemma-4-E4B-it-ONNX", label: "Gemma 4 E4B (bigger, may not fit in GPU memory)", size: "~4.4 GB", kind: "multimodal" },
    { id: "onnx-community/whisper-tiny", label: "Whisper tiny (speech only)", size: "~120 MB", kind: "speech" },
    { id: "onnx-community/whisper-base", label: "Whisper base (speech only)", size: "~210 MB", kind: "speech" },
    { id: "onnx-community/whisper-small", label: "Whisper small (speech only)", size: "~590 MB", kind: "speech" },
    { id: "onnx-community/whisper-large-v3-turbo", label: "Whisper large-v3-turbo (speech only, needs fp16 GPU)", size: "~570 MB", kind: "speech" },
    { id: "onnx-community/moonshine-tiny-ONNX", label: "Moonshine tiny (speech only, English)", size: "~80 MB", kind: "speech" },
    { id: "onnx-community/moonshine-base-ONNX", label: "Moonshine base (speech only, English)", size: "~155 MB", kind: "speech" },
    // Two steps in two workers: a small speech model hears the clip, then Gemma 4 E2B (text only) lays the transcript out.
    { id: "pipeline:whisper-base+gemma-4-e2b", label: "Whisper base → Gemma 4 E2B (two steps)", size: "~3.6 GB (210 MB + 3.4 GB)", kind: "pipeline", asr: "onnx-community/whisper-base", structure: "onnx-community/gemma-4-E2B-it-ONNX" },
]

// Step 2 of the pipeline. The model gets the exact words, so it only has to format them (the part a 2B model is good at).
const pipelinePrompt = (transcript) =>
    `Below is the exact transcript of a spoken audio clip.\n\nTranscript:\n"""\n${transcript}\n"""\n\nRepeat the transcript exactly, then list every number in it as a table with the item and its value. Do not add anything that is not in the transcript.`

const TABS = {
    native: { label: "📱 Native", hint: "The platform picks its own model: Gemma 4 via LiteRT-LM on Android, the best available on iOS." },
    cloud: {
        label: "☁️ Cloud",
        hint: "Your image and audio are SENT to the selected provider. Gemini takes images and audio; OpenAI gpt-4o-mini takes images only, and audio is refused with an unsupported-modality error.",
    },
}

export default function Multimodal() {
    const [nativeAvailable, setNativeAvailable] = useState(false)
    const [tab, setTab] = useState("native")
    const [prompt, setPrompt] = useState("Describe this image briefly: shapes, colors, any text.")
    const [image, setImage] = useState(null)
    const [audio, setAudio] = useState(null)
    // One picker only: every useFilePicker instance listens to the same native callback, so two instances would
    // both receive each result. `wanted` remembers which slot the user asked for.
    const picker = useFilePicker()
    // Everything the picker effect needs is read through a ref and the effect is keyed on the file's URL string. In the
    // browser fallback, getFileObject is recreated every render and selectedFile may be a fresh object each render, so
    // using either as a dependency re-runs the effect forever (fetch -> setState -> render -> fetch ...).
    const pickerRef = useRef(picker)
    pickerRef.current = picker
    const pickedSrc = picker.selectedFile?.fileSrc ?? null
    const wanted = useRef(null)
    const [pickError, setPickError] = useState(null)

    useEffect(() => {
        setNativeAvailable(nativeAIAvailable())
    }, [])

    // No native module in this build -> the "native" tab becomes on-device web inference (Transformers.js).
    const [cloudProvider, setCloudProvider] = useState("gemini")
    const [webModelId, setWebModelId] = useState(WEB_MODELS[0].id)
    const webModel = WEB_MODELS.find((m) => m.id === webModelId) ?? WEB_MODELS[0]
    const provider = tab === "cloud" ? cloudProvider : nativeAvailable ? "native" : "transformers"
    const isPipeline = provider === "transformers" && webModel.kind === "pipeline"
    const ai = useAI({
        provider,
        ...(provider === "transformers" && { model: isPipeline ? webModel.structure : webModel.id }),
        sessionMode: "stateless",
        genConfig: { stream: true },
        systemPrompt: SYSTEM_PROMPT,
        attachmentComponents: ATTACHMENT_COMPONENTS,
    })

    // Step 1 of the pipeline. A second hook means a second worker, so the speech model and Gemma stay loaded side by side
    // (one worker swapping between them would reload Gemma's 3.4 GB on every call). Nothing loads until it is used.
    const speech = useAI({ provider: "transformers", model: WEB_MODELS.find((m) => m.kind === "pipeline").asr, sessionMode: "stateless", genConfig: { stream: true } })
    const [pipe, setPipe] = useState(null)
    const busy = ai.loading || ai.streaming || speech.loading || speech.streaming || pipe?.step === "transcribing" || pipe?.step === "structuring"

    const engineLabel = ai.isNative ? "native model" : ai.isLocal ? "web (Transformers.js)" : "cloud"
    const percent = ai.nativeDownloadProgress?.percent ?? ai.downloadProgress?.percent ?? null

    // useFilePicker hands back a native handle (URL or base64 depending on transport); getFileObject() turns it
    // into a File, which becomes the data URL that useAI content parts expect. The file's own MIME type decides
    // the slot, so an image can never end up in the audio player (or the reverse).
    useEffect(() => {
        if (!pickedSrc) return
        const { selectedFile, getFileObject, isWeb } = pickerRef.current
        let cancelled = false
        const slot = wanted.current
        // Native hands back a handle that getFileObject() turns into a File. The browser fallback only returns a blob
        // URL (its getFileObject is a stub), so fetch that instead.
        const loadFile = isWeb
            ? fetch(selectedFile.fileSrc)
                  .then((response) => response.blob())
                  .then((blob) => new File([blob], selectedFile.fileName, { type: selectedFile.mimeType || blob.type }))
            : getFileObject()
        loadFile
            .then(async (file) => {
                if (!file || cancelled) return
                const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : null
                if (!kind || (slot && kind !== slot)) {
                    setPickError(`Expected ${slot ?? "an image or audio"} file, got ${file.type || "an unknown type"}`)
                    return
                }
                const data = await readAsDataUrl(file)
                if (cancelled) return
                setPickError(null)
                ;(kind === "image" ? setImage : setAudio)({ name: file.name, data })
            })
            .catch((err) => setPickError(`Could not read the picked file: ${err.message}`))
        return () => {
            cancelled = true
        }
    }, [pickedSrc])

    const pickMedia = (kind) => {
        wanted.current = kind
        setPickError(null)
        picker.clear?.()
        picker.execute({ mimeType: `${kind}/*` })
    }

    const runPipeline = async () => {
        if (!audio) {
            setPickError("This pipeline starts from speech: pick an audio clip first")
            return
        }
        setPickError(null)
        ai.reset?.()
        const t0 = performance.now()
        setPipe({ step: "transcribing", transcript: null, asrMs: null, structMs: null })
        const heard = await speech.generate({ messages: [{ role: "user", content: [{ type: "audio", data: audio.data }, { type: "text", text: "Transcribe" }] }] })
        const transcript = heard?.output?.trim()
        if (!transcript) {
            setPipe((p) => ({ ...p, step: "failed", asrMs: Math.round(performance.now() - t0) }))
            return
        }
        const asrMs = Math.round(performance.now() - t0)
        setPipe({ step: "structuring", transcript, asrMs, structMs: null })
        const t1 = performance.now()
        await ai.generate({ messages: [{ role: "user", content: pipelinePrompt(transcript) }] })
        setPipe({ step: "done", transcript, asrMs, structMs: Math.round(performance.now() - t1) })
    }

    const stop = () => {
        speech.cancel?.()
        ai.cancel?.()
        setPipe((p) => (p && (p.step === "transcribing" || p.step === "structuring") ? { ...p, step: "stopped" } : p))
    }

    const run = () => {
        if (isPipeline) {
            runPipeline()
            return
        }
        setPipe(null)
        const content = []
        if (image) content.push({ type: "image", data: image.data })
        if (audio) content.push({ type: "audio", data: audio.data })
        content.push({ type: "text", text: prompt })
        ai.generate({ messages: [{ role: "user", content }] })
    }

    const state = ai.error
        ? "error"
        : ai.streaming
          ? "streaming"
          : ai.loading
            ? "loading"
            : ai.modelReady || tab === "cloud"
              ? "ready"
              : provider === "transformers"
                ? `not loaded yet (downloads ${webModel.size} on first Run, cached after)`
                : "preparing model"

    const chip = "px-3 py-1.5 rounded-lg border border-[var(--border)] text-[12px]"

    return (
        <div className="max-w-[720px] mx-auto px-6 py-10 text-[var(--text-2)]">
            <Link to="/" className="font-mono text-[11px] uppercase text-[var(--text-2)] no-underline">
                ← Back
            </Link>
            <h1 className="text-3xl font-semibold text-white mt-4 mb-2">Image / audio input</h1>
            <p className="mb-5 text-[14px]">{TABS[tab].hint}{tab === "native" && !nativeAvailable && ` (No native module in this build, so this runs in the browser on WebGPU. Pick the model below; the first Run downloads ${webModel.size}. One image and one audio clip per request.)`}</p>

            <div className="flex gap-2 mb-5">
                {Object.entries(TABS).map(([key, t]) => (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        className={`${chip} ${tab === key ? "bg-purple-500 border-purple-500 text-white" : ""}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === "native" && !nativeAvailable && (
                <div className="mb-4">
                    <label className="block font-mono text-[11px] uppercase mb-1" htmlFor="web-model">Model</label>
                    <select
                        id="web-model"
                        data-testid="web-model"
                        value={webModelId}
                        onChange={(e) => setWebModelId(e.target.value)}
                        disabled={busy}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-neutral-900 text-white text-[13px]"
                    >
                        {WEB_MODELS.map((m) => (
                            <option key={m.id} value={m.id}>{m.label} · {m.size}</option>
                        ))}
                    </select>
                    {webModel.kind === "pipeline" && (
                        <p className="mt-1 text-[12px]">Two steps: Whisper base writes the transcript, then Gemma 4 E2B lays it out as components. Needs an audio clip; the prompt box and any image are ignored. Both models stay loaded after the first Run.</p>
                    )}
                    {webModel.kind === "speech" && (
                        <p className="mt-1 text-[12px]">Speech model: returns a plain transcript of the audio clip and ignores the prompt and any image. Judge it on transcript accuracy.</p>
                    )}
                </div>
            )}

            {tab === "cloud" && (
                <div className="flex gap-2 mb-4">
                    {["gemini", "openai"].map((p) => (
                        <button
                            key={p}
                            onClick={() => setCloudProvider(p)}
                            className={`${chip} ${cloudProvider === p ? "bg-indigo-500 border-indigo-500 text-white" : ""}`}
                        >
                            {p}
                        </button>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap gap-2 mb-4">
                <button onClick={() => setImage({ name: "sample.png", data: sampleImage() })} className={chip}>Sample image</button>
                <button onClick={() => pickMedia("image")} className={chip}>Pick image</button>
                <button onClick={() => pickMedia("audio")} className={chip}>Pick audio</button>
            </div>

            {(image || audio) && (
                <div className="mb-4 rounded-xl border border-[var(--border)] p-3 flex flex-col gap-3">
                    {image && (
                        <div>
                            <img src={image.data} alt={image.name} className="max-h-48 rounded-lg" />
                            <div className="font-mono text-[11px] mt-1">{image.name} <button onClick={() => setImage(null)} className="ml-2 underline">remove</button></div>
                        </div>
                    )}
                    {audio && (
                        <div>
                            <audio controls src={audio.data} className="w-full" />
                            <div className="font-mono text-[11px] mt-1">{audio.name} <button onClick={() => setAudio(null)} className="ml-2 underline">remove</button></div>
                        </div>
                    )}
                </div>
            )}

            <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[13px] text-white mb-3"
            />
            <div className="flex items-center gap-3">
                <button onClick={run} disabled={busy} className="px-4 py-2 rounded-lg bg-indigo-500 text-white text-[13px] font-semibold disabled:opacity-50">
                    Run
                </button>
                {busy && <button onClick={isPipeline ? stop : ai.cancel} className={chip}>Stop</button>}
            </div>

            <div className="mt-4 font-mono text-[12px]" data-testid="status">
                engine: {engineLabel} · provider: {provider} · state: {state}
                {percent != null && percent < 100 && ` · download ${percent}%`}
                {ai.metrics?.tps ? ` · ${ai.metrics.tps} tok/s` : ""}
                {typeof ai.metrics?.cost === "number" && ` · cost $${ai.metrics.cost.toFixed(5)}${ai.metrics.audioCostUnknown ? " (audio not priced)" : ""}`}
                {ai.metrics?.cloudEquivalent && ` · ≈ $${ai.metrics.cloudEquivalent.cost.toFixed(5)} on ${ai.metrics.cloudEquivalent.model} (estimate)`}
            </div>
            {pipe && (
                <div className="mt-2 font-mono text-[12px]" data-testid="pipeline-status">
                    step 1 · Whisper base: {pipe.step === "transcribing" ? `transcribing${speech.downloadProgress?.percent != null && speech.downloadProgress.percent < 100 ? ` (download ${speech.downloadProgress.percent}%)` : ""}…` : pipe.asrMs != null ? `${(pipe.asrMs / 1000).toFixed(1)} s` : "failed"}
                    {" · "}step 2 · Gemma 4 E2B: {pipe.step === "structuring" ? `structuring${percent != null && percent < 100 ? ` (download ${percent}%)` : ""}…` : pipe.structMs != null ? `${(pipe.structMs / 1000).toFixed(1)} s` : pipe.step === "transcribing" ? "waiting" : pipe.step}
                </div>
            )}
            {pipe?.transcript && (
                <div className="mt-2 text-[12px]" data-testid="pipeline-transcript">
                    <div className="font-mono uppercase text-[11px]">Step 1 transcript (Whisper base)</div>
                    <div className="mt-1 whitespace-pre-wrap text-neutral-300">{pipe.transcript}</div>
                </div>
            )}
            {speech.error && isPipeline && (
                <div className="mt-2 text-[13px] text-red-400" data-testid="speech-error">
                    step 1: {speech.error.reason ? `[${speech.error.reason}] ` : ""}{speech.error.message}
                    <button onClick={speech.clearError} className="ml-2 underline">dismiss</button>
                </div>
            )}
            {ai.inputInfo && <div className="mt-1 font-mono text-[11px]" data-testid="input-info">model input: {ai.inputInfo}</div>}
            {(pickError || picker.error) && (
                <div className="mt-2 text-[13px] text-red-400" data-testid="pick-error">
                    {pickError ?? picker.error?.message ?? String(picker.error)}
                </div>
            )}
            {ai.error && (
                <div className="mt-2 text-[13px] text-red-400" data-testid="error">
                    {ai.error.reason ? `[${ai.error.reason}] ` : ""}{ai.error.message}
                    <button onClick={ai.clearError} className="ml-2 underline">dismiss</button>
                </div>
            )}
            <div data-testid="output" className="mt-3 text-[14px] text-white">{renderOutput(ai.output, ai.streaming)}</div>
        </div>
    )
}

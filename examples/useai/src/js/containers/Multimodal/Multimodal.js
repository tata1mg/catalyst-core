import React, { useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import { useAI, useFilePicker } from "catalyst-core/hooks"
import { renderOutput } from "../../utils/ai"

// Verifies image/audio input through useAI (catalyst-ai content parts) on a real device.
// Native only: the on-device Gemma 4 model takes image and audio. Cloud/web engines refuse media with a typed error.

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

const TABS = {
    native: { label: "📱 Native", hint: "The platform picks its own model: Gemma 4 via LiteRT-LM on Android, the best available on iOS." },
    cloud: { label: "☁️ Cloud", hint: "Text only for now. Media is refused with an unsupported-modality error." },
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
    const { selectedFile, getFileObject } = picker
    const wanted = useRef(null)
    const [pickError, setPickError] = useState(null)

    useEffect(() => {
        setNativeAvailable(!!window.NativeBridge || Array.isArray(window.CatalystPlugins?.["io.catalyst.ai"]))
    }, [])

    // No native module in this build -> the "native" tab becomes on-device web inference (Transformers.js).
    const provider = tab === "cloud" ? "cloud" : nativeAvailable ? "native" : "transformers"
    const ai = useAI({
        provider,
        sessionMode: "stateless",
        genConfig: { stream: true },
        systemPrompt: SYSTEM_PROMPT,
        attachmentComponents: ATTACHMENT_COMPONENTS,
    })

    const engineLabel = ai.isNative ? "native model" : ai.isLocal ? "web (Transformers.js)" : "cloud"
    const percent = ai.nativeDownloadProgress?.percent ?? ai.downloadProgress?.percent ?? null

    // useFilePicker hands back a native handle (URL or base64 depending on transport); getFileObject() turns it
    // into a File, which becomes the data URL that useAI content parts expect. The file's own MIME type decides
    // the slot, so an image can never end up in the audio player (or the reverse).
    useEffect(() => {
        if (!selectedFile) return
        let cancelled = false
        const slot = wanted.current
        getFileObject()
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
    }, [selectedFile, getFileObject])

    const pickMedia = (kind) => {
        wanted.current = kind
        setPickError(null)
        picker.clear?.()
        picker.execute({ mimeType: `${kind}/*` })
    }

    const run = () => {
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
              : "preparing model"

    const chip = "px-3 py-1.5 rounded-lg border border-[var(--border)] text-[12px]"

    return (
        <div className="max-w-[720px] mx-auto px-6 py-10 text-[var(--text-2)]">
            <Link to="/" className="font-mono text-[11px] uppercase text-[var(--text-2)] no-underline">
                ← Back
            </Link>
            <h1 className="text-3xl font-semibold text-white mt-4 mb-2">Image / audio input</h1>
            <p className="mb-5 text-[14px]">{TABS[tab].hint}{tab === "native" && !nativeAvailable && " (No native module in this build, so this runs on-device in the web view.)"}</p>

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
                <button onClick={run} disabled={ai.loading || ai.streaming} className="px-4 py-2 rounded-lg bg-indigo-500 text-white text-[13px] font-semibold disabled:opacity-50">
                    Run
                </button>
                {(ai.loading || ai.streaming) && <button onClick={ai.cancel} className={chip}>Stop</button>}
            </div>

            <div className="mt-4 font-mono text-[12px]" data-testid="status">
                engine: {engineLabel} · state: {state}
                {percent != null && percent < 100 && ` · download ${percent}%`}
                {ai.metrics?.tps ? ` · ${ai.metrics.tps} tok/s` : ""}
            </div>
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

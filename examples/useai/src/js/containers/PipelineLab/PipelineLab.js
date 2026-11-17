import React, { useMemo, useRef, useState } from "react"
import { Link } from "react-router"
import { useAI, usePipeline, transcribeStage, jsonStage, imageStage, requestImage } from "catalyst-core/hooks"

// #611 demo: audio (or typed text) -> transcript -> JSON scene spec -> generated image, as one typed pipeline.
// Every model stage here is a cloud call, so nothing runs until the user agrees ("needs-consent" -> Allow button):
// a voice recording's words must not reach a provider silently. requestImage comes from catalyst-core/hooks.

const SCENE_SCHEMA = {
    type: "object",
    properties: {
        scene: { type: "string", description: "One sentence describing what the image shows" },
        style: { type: "string", description: "Art style, e.g. watercolor, photo, flat illustration" },
        mood: { type: "string", description: "One or two words" },
    },
    required: ["scene", "style"],
}

const readAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
    })

const chip = "px-3 py-1.5 rounded-full border border-[var(--border)] text-[12px] cursor-pointer bg-transparent text-[var(--text-2)]"

export default function PipelineLab() {
    const [textProvider, setTextProvider] = useState("gemini")
    const [imageProvider, setImageProvider] = useState("openai")
    const [mode, setMode] = useState("text")
    const [typed, setTyped] = useState("A calm morning by a lake, painted softly, with a small red boat.")
    const [audio, setAudio] = useState(null)
    const [pickError, setPickError] = useState(null)

    // Stateless cloud hook used by the transcribe and JSON stages. Held in a ref so the stage array stays stable.
    const ai = useAI({ provider: textProvider, sessionMode: "stateless" })
    const aiRef = useRef(ai)
    aiRef.current = ai
    const providerRef = useRef(imageProvider)
    providerRef.current = imageProvider

    const ask = async (content) => {
        const result = await aiRef.current.generate({ messages: [{ role: "user", content }] })
        if (result?.error) throw result.error instanceof Error ? result.error : new Error(String(result.error))
        return (result?.output ?? "").trim()
    }

    const stages = useMemo(() => {
        const toJson = jsonStage({
            schema: SCENE_SCHEMA,
            cloud: true,
            instructions: "Turn the text into a scene to illustrate.",
            generate: async (prompt) => ask(prompt),
        })
        const draw = imageStage({
            requestImage: (args) => requestImage({ ...args, provider: providerRef.current }),
            prompt: (spec) => `${spec.scene}. Style: ${spec.style}.${spec.mood ? ` Mood: ${spec.mood}.` : ""}`,
        })
        const hear = transcribeStage(
            (data) => ask([{ type: "audio", data }, { type: "text", text: "Transcribe this audio exactly. Reply with the transcript only." }]),
            { cloud: true }
        )
        return { fromText: [toJson, draw], fromAudio: [hear, toJson, draw] }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const textPipe = usePipeline(stages.fromText, { cloudPolicy: "ask" })
    const audioPipe = usePipeline(stages.fromAudio, { cloudPolicy: "ask" })
    const pipe = mode === "audio" ? audioPipe : textPipe
    const input = mode === "audio" ? audio?.data : typed
    const running = pipe.status === "running"

    const run = (overrides) => {
        if (!input) {
            setPickError(mode === "audio" ? "Pick an audio clip first" : "Type a description first")
            return
        }
        setPickError(null)
        pipe.run(input, overrides)
    }

    const onFile = async (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        if (!file.type.startsWith("audio/")) return setPickError(`Expected an audio file, got ${file.type || "unknown"}`)
        setPickError(null)
        setAudio({ name: file.name, data: await readAsDataUrl(file) })
    }

    const imageUrl = pipe.output?.url ?? pipe.output?.[0]?.url ?? (typeof pipe.output === "string" ? pipe.output : null)
    const needsConsent = pipe.status === "needs-consent" || pipe.status === "denied"

    return (
        <div className="max-w-[720px] mx-auto px-6 py-10 text-[var(--text-2)]">
            <Link to="/" className="font-mono text-[11px] uppercase text-[var(--text-2)] no-underline">← Back</Link>
            <h1 className="text-3xl font-semibold text-white mt-4 mb-2">Pipeline lab</h1>
            <p className="mb-5 text-[14px]">
                {mode === "audio" ? "audio → transcript → JSON scene → image" : "text → JSON scene → image"}. Each arrow is a typed stage; the run stops for your consent before any cloud call.
            </p>

            <div className="flex gap-2 mb-4">
                {["text", "audio"].map((m) => (
                    <button key={m} data-testid={`mode-${m}`} onClick={() => setMode(m)} disabled={running} className={`${chip} ${mode === m ? "bg-purple-500 border-purple-500 text-white" : ""}`}>
                        Start from {m}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4 text-[12px]">
                <label>Text model
                    <select value={textProvider} onChange={(e) => setTextProvider(e.target.value)} disabled={running} className="w-full mt-1 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-neutral-900 text-white">
                        <option value="gemini">Gemini</option>
                        <option value="openai">OpenAI (no audio)</option>
                    </select>
                </label>
                <label>Image model
                    <select value={imageProvider} onChange={(e) => setImageProvider(e.target.value)} disabled={running} className="w-full mt-1 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-neutral-900 text-white">
                        <option value="openai">OpenAI</option>
                        <option value="gemini">Gemini</option>
                    </select>
                </label>
            </div>

            {mode === "text" ? (
                <textarea data-testid="typed" value={typed} onChange={(e) => setTyped(e.target.value)} rows={3} disabled={running} className="w-full mb-3 px-3 py-2 rounded-lg border border-[var(--border)] bg-neutral-900 text-white text-[13px]" />
            ) : (
                <div className="mb-3 text-[13px]">
                    <input data-testid="audio-file" type="file" accept="audio/*" onChange={onFile} disabled={running} />
                    {audio && <p className="mt-1 text-[12px]">{audio.name}</p>}
                </div>
            )}
            {pickError && <p className="mb-3 text-[12px] text-red-400">{pickError}</p>}

            <div className="flex gap-2 mb-5">
                <button data-testid="run" onClick={() => run()} disabled={running} className={`${chip} bg-purple-500 border-purple-500 text-white`}>{running ? "Running…" : "Run pipeline"}</button>
                {running && <button data-testid="stop" onClick={pipe.cancel} className={chip}>Stop</button>}
            </div>

            {needsConsent && (
                <div data-testid="consent" className="mb-5 p-3 rounded-lg border border-yellow-500/40 text-[13px]">
                    A stage wants to send {mode === "audio" ? "your voice and its transcript" : "your text"} to {textProvider}/{imageProvider}.{" "}
                    <button data-testid="allow" onClick={() => run({ cloudPolicy: "allow" })} className={`${chip} ml-2`}>Allow and run</button>
                </div>
            )}

            <ol data-testid="steps" className="mb-5 space-y-1 font-mono text-[11.5px]">
                {pipe.steps.map((s, i) => (
                    <li key={i}>
                        {s.type === "start" && `▶ ${s.stage} (${s.inputType}${s.cloud ? ", cloud" : ""}): ${s.preview}`}
                        {s.type === "end" && `✓ ${s.stage} → ${s.outputType} in ${s.durationMs} ms: ${s.preview}`}
                        {s.type === "error" && `✗ ${s.stage}: ${s.error ?? "failed"}`}
                        {s.type === "blocked" && `⏸ ${s.stage}: ${s.reason ?? "waiting for consent"}`}
                    </li>
                ))}
            </ol>

            {pipe.error && <p data-testid="error" className="mb-4 text-[13px] text-red-400">{pipe.error.message}</p>}
            {imageUrl && <img data-testid="result" src={imageUrl} alt="Generated from the pipeline" className="w-full rounded-xl border border-[var(--border)]" />}
            <p className="mt-3 text-[11px]">status: {pipe.status}{pipe.spentUsd ? ` · spent $${pipe.spentUsd.toFixed(4)}` : ""}</p>
        </div>
    )
}

import React, { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router"
import { useVoiceRecorder, MAX_SECONDS } from "./useVoiceRecorder"
import { useAI, useTranscribe, usePipeline, transcribeStage, jsonStage, imageStage, requestImage, useLiveTranscribe, registerDeviceImageEngine, deviceImageSupport } from "catalyst-core/hooks"

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

// On-device engines. In the native app the platform's own model does text and audio (Gemma via LiteRT on Android, the best
// available on iOS). In a plain browser, Gemma 4 E2B (~3.4 GB) does the text/JSON step and Whisper base (~210 MB) hears the
// speech, both through Transformers.js on WebGPU; nothing downloads until the first run.
// The app owns the heavy optional dependency: SD-Turbo through web-txt2img (WebGPU). Loaded only when a picture is first made on the device.
registerDeviceImageEngine(() => import("web-txt2img"), { wasmPaths: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/" })

const GEMMA_WEB = "onnx-community/gemma-4-E2B-it-ONNX"
const WHISPER_WEB = "onnx-community/whisper-base"
const nativeAIAvailable = () => {
    const bridge = typeof window !== "undefined" && window.NativeBridge
    if (bridge && typeof bridge.isAIAvailable === "function") return !!bridge.isAIAvailable()
    return typeof window !== "undefined" && !!window.webkit?.messageHandlers?.PluginBridge && Array.isArray(window.CatalystPlugins?.["io.catalyst.ai"])
}

export default function PipelineLab() {
    const [engine, setEngine] = useState("cloud") // "cloud" | "device"
    const [skipImage, setSkipImage] = useState(false) // device only: stop after the JSON scene so nothing leaves the device
    const nativeAvailable = useMemo(() => nativeAIAvailable(), [])
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
    // On-device pictures (SD-Turbo): available only with WebGPU and the registered engine. Progress covers the model download.
    const [deviceImage, setDeviceImage] = useState({ available: false, reason: "checking…" })
    const [imgProgress, setImgProgress] = useState(null)
    useEffect(() => {
        deviceImageSupport().then(setDeviceImage, (e) => setDeviceImage({ available: false, reason: String(e?.message || e) }))
    }, [])

    // The app's on-device model (a LiteRT-LM registry key). Gemma needs about 2.6 GB of storage and several GB of RAM; Qwen3 0.6B
    // is a quarter of that, for small emulators and low-end phones. It writes the scene JSON; it cannot hear audio.
    const NATIVE_MODELS = [
        ["gemma-4-E2B", "Gemma 4 E2B (2.6 GB, text and audio)"],
        ["qwen3-0.6B", "Qwen3 0.6B (0.5 GB, text only: small emulators)"],
    ]
    const [nativeModel, setNativeModel] = useState(() => {
        try { return localStorage.getItem("lab.nativeModel") || "gemma-4-E2B" } catch { return "gemma-4-E2B" }
    })
    // Qwen3 0.6B cannot hear audio, so a recording must not be offered to it (live speech is fine: the phone's own
    // recogniser turns it into text first).
    const nativeTextOnly = nativeAvailable && nativeModel === "qwen3-0.6B"
    const chooseNativeModel = (key) => {
        setNativeModel(key)
        try { localStorage.setItem("lab.nativeModel", key) } catch { /* the choice just is not remembered */ }
    }

    // On-device hooks. Instantiating them loads nothing; a model only downloads when a device run first calls generate().
    const device = useAI({
        provider: nativeAvailable ? "native" : "transformers",
        ...(nativeAvailable ? { model: nativeModel } : { model: GEMMA_WEB }),
        sessionMode: "stateless",
        genConfig: { stream: true },
    })
    const deviceRef = useRef(device)
    deviceRef.current = device
    // Speech to text in the browser. useTranscribe cuts a recording longer than the encoder takes (30 s) into pieces at quiet
    // moments, transcribes them one after another and frees Whisper once at the end (up to 120 s per recording).
    const asr = useTranscribe({ provider: "transformers", model: WHISPER_WEB, sessionMode: "stateless", genConfig: { stream: true }, instructions: "Transcribe" })
    const asrRef = useRef(asr)
    asrRef.current = asr

    const ask = async (content) => {
        const result = await aiRef.current.generate({ messages: [{ role: "user", content }] })
        if (result?.error) throw result.error instanceof Error ? result.error : new Error(String(result.error))
        return (result?.output ?? "").trim()
    }

    // Lifecycle: downloads stay cached, but a model only stays in GPU/RAM while its stage runs. Gemma (~3.4 GB), Whisper and
    // SD-Turbo (~2.3 GB) together ran the tab out of memory, so each is released as soon as its stage is done.
    const askDevice = async (content) => {
        const result = await deviceRef.current.generate({ messages: [{ role: "user", content }] })
        deviceRef.current.unload?.()
        if (result?.error) throw result.error instanceof Error ? result.error : new Error(String(result.error))
        return (result?.output ?? "").trim()
    }
    // Speech to text on the device: Whisper in the browser, the platform model in the native app.
    const hearOnDevice = async (data) => {
        if (nativeAvailable) return askDevice([{ type: "audio", data }, { type: "text", text: "Transcribe this audio exactly. Reply with the transcript only." }])
        const heard = await asrRef.current.transcribe(data)
        if (!heard) throw asrRef.current.lastError() ?? new Error("The recording could not be transcribed")
        if (heard.truncated) console.warn(`[pipeline-lab] recording is ${heard.durationSec}s; only the first ${heard.durationSec}s were transcribed`)
        return heard.text
    }

    const stages = useMemo(() => {
        const toJson = jsonStage({
            schema: SCENE_SCHEMA,
            cloud: true,
            instructions: "Turn the text into a scene to illustrate.",
            generate: async (prompt) => ask(prompt),
        })
        const draw = imageStage({
            requestImage: async (args) => {
                setImgProgress(null)
                try {
                    return await requestImage({ ...args, provider: providerRef.current, onProgress: (p) => setImgProgress(p) })
                } finally {
                    setImgProgress(null)
                }
            },
            prompt: (spec) => `${spec.scene}. Style: ${spec.style}.${spec.mood ? ` Mood: ${spec.mood}.` : ""}`,
        })
        // The same image stage serves cloud and device: when the picture is made on the device the stage is not a cloud
        // stage, so no consent is needed. runPipeline reads `cloud` at run time, hence a getter.
        Object.defineProperty(draw, "cloud", { enumerable: true, get: () => providerRef.current !== "device" })
        const hear = transcribeStage(
            (data) => ask([{ type: "audio", data }, { type: "text", text: "Transcribe this audio exactly. Reply with the transcript only." }]),
            { cloud: true }
        )
        // Same chain on the device: speech and text stay local (cloud: false); only the picture stage can leave it.
        const toJsonDevice = jsonStage({ schema: SCENE_SCHEMA, cloud: false, instructions: "Turn the text into a scene to illustrate.", generate: async (prompt) => askDevice(prompt) })
        const hearDevice = transcribeStage((data) => hearOnDevice(data), { cloud: false })
        return { fromText: [toJson, draw], fromAudio: [hear, toJson, draw], deviceFromText: [toJsonDevice, draw], deviceFromAudio: [hearDevice, toJsonDevice, draw] }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const textPipe = usePipeline(stages.fromText, { cloudPolicy: "ask" })
    const audioPipe = usePipeline(stages.fromAudio, { cloudPolicy: "ask" })
    const textPipeD = usePipeline(stages.deviceFromText, { cloudPolicy: "ask" })
    const audioPipeD = usePipeline(stages.deviceFromAudio, { cloudPolicy: "ask" })
    const onDevice = engine === "device"
    const activeText = onDevice ? textPipeD : textPipe
    const activeAudio = onDevice ? audioPipeD : audioPipe
    // Device runs may stop before the picture: "deny" blocks only the cloud picture stage, so nothing leaves the device.
    const deviceOverrides = skipImage && imageProvider !== "device" ? { cloudPolicy: "deny" } : undefined
    const fromAudio = mode === "audio" || mode === "voice"
    const [voiceConsent, setVoiceConsent] = useState(false)
    // Live mode streams the microphone to Gemini and gets text back while you speak; that text then runs the text pipeline.
    const [liveText, setLiveText] = useState("")
    const live = useLiveTranscribe({
        onFinished: (finalText) => {
            setLiveText(finalText)
            setPickError(null)
            activeText.run(finalText, { cloudPolicy: "allow" }) // the checkbox is the consent for this run
        },
    })
    // On the device, voice goes through useTranscribe().listen(): the router picks the engine. Inside the app that is the phone's
    // own recogniser (on-device, partial text as you talk, no model to load); if it cannot run, a recording goes to the
    // on-device model instead. The cloud is denied outright, so a voice never leaves the phone from here.
    const voice = useTranscribe({ routing: { cloud: "deny", cloudMedia: "deny" } })
    const nativeSpeech = onDevice && voice.platformSpeech === true
    const listenAndRun = async () => {
        const heardIt = await voice.listen()
        if (!heardIt) return
        setLiveText(heardIt.text)
        setPickError(null)
        activeText.run(heardIt.text, deviceOverrides)
    }
    const voiceLiveSrc = {
              listening: voice.listening,
              state: voice.status === "running" ? "starting" : voice.listening ? "listening" : "idle",
              text: voice.text,
              partial: voice.partial,
              error:
                  voice.error?.message ??
                  (voice.status === "denied" || voice.status === "needs-consent"
                      ? "Nothing on this phone can take your voice here, and the cloud is turned off for it."
                      : null),
              start: listenAndRun,
              stop: voice.stopListening,
    }
    // Keep the voice controls for as long as the voice hook owns the microphone. If the phone's recogniser becomes
    // unavailable mid-session and useTranscribe falls back to its recorder, platformSpeech flips to false, but the
    // session (its text, state and stop) still belongs to `voice`, so the controls must not switch to the cloud hook.
    const voiceOwnsSession = voice.status === "running" || voice.listening
    const liveSrc = nativeSpeech || voiceOwnsSession ? voiceLiveSrc : live
    useEffect(() => {
        if (nativeTextOnly && (mode === "audio" || mode === "voice")) setMode("text")
    }, [nativeTextOnly, mode])
    const pipe = fromAudio ? activeAudio : activeText
    const input = mode === "live" ? liveText : fromAudio ? audio?.data : typed
    const recorder = useVoiceRecorder({
        onRecorded: (data, { seconds }) => {
            setAudio({ name: `live recording (${seconds}s)`, data })
            setPickError(null)
            activeAudio.run(data, onDevice ? deviceOverrides : voiceConsent ? { cloudPolicy: "allow" } : undefined)
        },
    })
    const heard = activeAudio.steps.find((s) => s.type === "end" && s.stage === "transcribe")?.preview
    const running = pipe.status === "running"

    const run = (overrides) => {
        if (!input) {
            setPickError(mode === "live" ? "Click the microphone and speak first" : fromAudio ? (mode === "voice" ? "Click the microphone and speak first" : "Pick an audio clip first") : "Type a description first")
            return
        }
        setPickError(null)
        pipe.run(input, overrides ?? (onDevice ? deviceOverrides : undefined))
    }

    const onFile = async (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        if (!file.type.startsWith("audio/")) return setPickError(`Expected an audio file, got ${file.type || "unknown"}`)
        setPickError(null)
        setAudio({ name: file.name, data: await readAsDataUrl(file) })
    }

    const percentOf = (h) => (h.nativeDownloadProgress?.percent ?? h.downloadProgress?.percent ?? null)
    const gemmaPct = percentOf(device)
    const whisperPct = asr.model.downloadProgress?.percent ?? null
    const sceneStep = pipe.steps.find((st) => st.type === "end" && st.stage === "json")?.preview
    const imageUrl = pipe.output?.url ?? pipe.output?.[0]?.url ?? (typeof pipe.output === "string" ? pipe.output : null)
    const keptOnDevice = onDevice && skipImage && imageProvider !== "device" && pipe.status === "denied"
    const needsConsent = (pipe.status === "needs-consent" || pipe.status === "denied") && !keptOnDevice

    return (
        <div className="max-w-[720px] mx-auto px-6 py-10 text-[var(--text-2)]">
            <Link to="/" className="font-mono text-[11px] uppercase text-[var(--text-2)] no-underline">← Back</Link>
            <h1 className="text-3xl font-semibold text-white mt-4 mb-2">Pipeline lab</h1>
            <p className="mb-5 text-[14px]">
                {mode === "live" ? "live speech → text (as you talk) → JSON scene → image" : fromAudio ? "audio → transcript → JSON scene → image" : "text → JSON scene → image"}. Each arrow is a typed stage; the run stops for your consent before anything leaves the device.
            </p>

            <div className="flex gap-2 mb-2">
                {[["cloud", "☁️ Cloud models"], ["device", "📱 On-device models"]].map(([key, label]) => (
                    <button key={key} data-testid={`engine-${key}`} onClick={() => { recorder.cancel(); live.cancel(); voice.cancel(); if (key === "device" && mode === "live" && !voice.platformSpeech) setMode("text"); if (key === "device" && deviceImage.available && !nativeAvailable) setImageProvider("device"); setEngine(key) }} disabled={running} className={`${chip} ${engine === key ? "bg-green-600 border-green-600 text-white" : ""}`}>
                        {label}
                    </button>
                ))}
            </div>
            {onDevice && (
                <div data-testid="device-note" className="mb-4 text-[12px]">
                    {nativeAvailable && (
                        <label className="mb-2 block">
                            <span className="mr-2">On-device model</span>
                            <select data-testid="native-model" value={nativeModel} onChange={(e) => chooseNativeModel(e.target.value)} disabled={running} className="px-2 py-1 rounded-lg border border-[var(--border)] bg-neutral-900 text-white">
                                {NATIVE_MODELS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                            </select>
                        </label>
                    )}
                    <p>
                        {nativeAvailable
                            ? nativeTextOnly
                                ? "Text runs on this phone's own model. This model cannot hear recordings, so audio and voice are off; speaking live still works because the phone's own recogniser turns it into text first. "
                                : "Speech and text run on this phone's own model. "
                            : "Running in the browser on WebGPU: Gemma 4 E2B (~3.4 GB) writes the scene and Whisper base (~210 MB) hears speech. The first run downloads them, then they stay cached. "}
                        Your voice and words stay on this device. {imageProvider === "device" ? "The picture is made on this device too, so nothing leaves it." : `The picture is made by ${imageProvider}; only the finished scene description can go there. Choose On-device as the image model to keep that local too.`}
                    </p>
                    {imageProvider !== "device" && <label className="mt-2 flex items-center gap-2">
                        <input type="checkbox" data-testid="skip-image" checked={skipImage} onChange={(e) => setSkipImage(e.target.checked)} />
                        Stop at the scene (no picture, nothing leaves the device)
                    </label>}
                    {asr.loading && asr.progress && asr.progress.of > 1 && <p data-testid="asr-progress" className="mt-1">Transcribing part {asr.progress.chunk} of {asr.progress.of}…</p>}
                    {(gemmaPct != null || whisperPct != null) && (
                        <p data-testid="device-progress" className="mt-1">
                            {gemmaPct != null && gemmaPct < 100 && `Gemma download ${gemmaPct}%. `}
                            {whisperPct != null && whisperPct < 100 && `Whisper download ${whisperPct}%.`}
                        </p>
                    )}
                </div>
            )}

            <div className="flex gap-2 mb-4">
                {["text", "audio", "voice", "live"].filter((m) => !(onDevice && m === "live" && !voice.platformSpeech) && !(nativeTextOnly && (m === "audio" || m === "voice"))).map((m) => (
                    <button key={m} data-testid={`mode-${m}`} onClick={() => { recorder.cancel(); live.cancel(); voice.cancel(); setMode(m) }} disabled={running} className={`${chip} ${mode === m ? "bg-purple-500 border-purple-500 text-white" : ""}`}>
                        {m === "live" ? (onDevice ? "Speak live (on this phone)" : "Speak live (streaming)") : m === "voice" ? "Record, then send" : `Start from ${m}`}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4 text-[12px]">
                <label>Text model
                    <select value={onDevice ? "device" : textProvider} onChange={(e) => setTextProvider(e.target.value)} disabled={running || onDevice} className="w-full mt-1 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-neutral-900 text-white">
                        {onDevice && <option value="device">{nativeAvailable ? "This phone's model" : "Gemma 4 E2B (browser)"}</option>}
                        <option value="gemini">Gemini</option>
                        <option value="openai">OpenAI (no audio)</option>
                    </select>
                </label>
                <label>Image model
                    <select value={imageProvider} onChange={(e) => setImageProvider(e.target.value)} disabled={running} className="w-full mt-1 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-neutral-900 text-white">
                        <option value="openai">OpenAI</option>
                        <option value="gemini">Gemini</option>
                        <option value="device" disabled={!deviceImage.available}>
                            {deviceImage.available ? "On-device (SD-Turbo, ~2.3 GB)" : `On-device unavailable: ${deviceImage.reason}`}
                        </option>
                    </select>
                </label>
            </div>
            {imageProvider === "device" && (
                <p data-testid="device-image-note" className="mb-3 text-[12px]">
                    The picture is made on this device with SD-Turbo on WebGPU (512×512). The first one downloads about 2.3 GB, then it is cached.
                    {imgProgress && ` Image model: ${imgProgress.phase}${imgProgress.pct != null ? ` ${Math.round(imgProgress.pct)}%` : ""}…`}
                </p>
            )}

            {mode === "text" ? (
                <textarea data-testid="typed" value={typed} onChange={(e) => setTyped(e.target.value)} rows={3} disabled={running} className="w-full mb-3 px-3 py-2 rounded-lg border border-[var(--border)] bg-neutral-900 text-white text-[13px]" />
            ) : mode === "live" ? (
                <div className="mb-3 text-[13px]">
                    <button
                        data-testid="live-mic"
                        onClick={liveSrc.listening ? liveSrc.stop : liveSrc.start}
                        disabled={running || liveSrc.state === "connecting" || liveSrc.state === "starting" || liveSrc.state === "finishing" || (!liveSrc.listening && !nativeSpeech && !voiceConsent)}
                        className={`${chip} text-[14px] px-5 py-3 ${liveSrc.listening ? "bg-red-500 border-red-500 text-white" : "bg-purple-500 border-purple-500 text-white"} disabled:opacity-50`}
                    >
                        {liveSrc.state === "connecting" || liveSrc.state === "starting" ? "Starting…" : liveSrc.state === "finishing" ? "Finishing…" : liveSrc.listening ? (nativeSpeech ? "● Listening… (click to finish)" : `● Live ${liveSrc.seconds}s (click to finish)`) : "🎙 Start live"}
                    </button>
                    {liveSrc.listening && !nativeSpeech && (
                        <div className="mt-2 h-2 w-full rounded bg-neutral-800 overflow-hidden">
                            <div data-testid="live-level" className="h-full bg-green-400" style={{ width: `${Math.round(live.level * 100)}%` }} />
                        </div>
                    )}
                    {!nativeSpeech && <label className="mt-2 flex items-start gap-2 text-[12px]">
                        <input type="checkbox" data-testid="voice-consent" checked={voiceConsent} onChange={(e) => setVoiceConsent(e.target.checked)} className="mt-0.5" />
                        <span>I agree my voice is streamed to Gemini while I speak, and the text goes on to {textProvider} and {imageProvider} to make the picture.</span>
                    </label>}
                    <p data-testid="live-text" className="mt-3 min-h-[3rem] text-[15px] text-white">
                        {[liveSrc.text, liveSrc.partial].filter(Boolean).join(" ") || (liveText ? liveText : <span className="text-[12px] text-[var(--text-2)]">Your words appear here as you speak.</span>)}
                    </p>
                    <p className="mt-1 text-[12px]">{nativeSpeech
                        ? "Your voice is turned into text by this phone's own recognizer, on the device, and never leaves it. It stops by itself when you pause; the text then goes to the on-device model."
                        : "Click to finish when you are done. Nothing is recorded to a file; audio streams straight to Gemini over a short-lived key from the server."}</p>
                    {liveSrc.error && <p className="mt-2 text-[12px] text-red-400">{liveSrc.error}</p>}
                </div>
            ) : mode === "voice" ? (
                <div className="mb-3 text-[13px]">
                    <button
                        data-testid="mic"
                        onClick={recorder.listening ? recorder.stop : recorder.start}
                        disabled={running}
                        className={`${chip} text-[14px] px-5 py-3 ${recorder.listening ? "bg-red-500 border-red-500 text-white" : "bg-purple-500 border-purple-500 text-white"}`}
                    >
                        {recorder.listening ? `● Listening… ${recorder.seconds}s / ${MAX_SECONDS}s (click to stop)` : "🎙 Click and speak"}
                    </button>
                    {recorder.listening && (
                        <div className="mt-2 h-2 w-full rounded bg-neutral-800 overflow-hidden">
                            <div data-testid="level" className="h-full bg-green-400" style={{ width: `${Math.round(recorder.level * 100)}%` }} />
                        </div>
                    )}
                    <p className="mt-2 text-[12px]">It stops by itself when you pause for two seconds, or at {MAX_SECONDS}s. {onDevice ? "The recording is heard on this device. " : "The recording goes to Gemini as recorded, with no conversion. "}Then the pipeline runs on its own.</p>
                    {!onDevice && textProvider !== "gemini" && <p className="mt-1 text-[12px] text-yellow-400">Voice needs a model that takes audio: set Text model to Gemini.</p>}
                    {!onDevice && (
                        <label className="mt-2 flex items-center gap-2 text-[12px]">
                            <input type="checkbox" data-testid="voice-consent" checked={voiceConsent} onChange={(e) => setVoiceConsent(e.target.checked)} />
                            Send my voice to {textProvider} without asking each time
                        </label>
                    )}
                    {recorder.error && <p className="mt-2 text-[12px] text-red-400">{recorder.error}</p>}
                    {heard && <p data-testid="heard" className="mt-2 text-[13px] text-white">You said: {heard.replace(/^"|"$/g, "")}</p>}
                </div>
            ) : (
                <div className="mb-3 text-[13px]">
                    <input data-testid="audio-file" type="file" accept="audio/*" onChange={onFile} disabled={running} />
                    {audio && <p className="mt-1 text-[12px]">{audio.name}</p>}
                </div>
            )}
            {pickError && <p className="mb-3 text-[12px] text-red-400">{pickError}</p>}

            <div className="flex gap-2 mb-5">
                {mode !== "live" && <button data-testid="run" onClick={() => run()} disabled={running} className={`${chip} bg-purple-500 border-purple-500 text-white`}>{running ? "Running…" : "Run pipeline"}</button>}
                {running && <button data-testid="stop" onClick={pipe.cancel} className={chip}>Stop</button>}
            </div>

            {needsConsent && (
                <div data-testid="consent" className="mb-5 p-3 rounded-lg border border-yellow-500/40 text-[13px]">
                    {onDevice
                        ? `The picture is made by ${imageProvider}. Only the scene description below (not your voice or transcript) would be sent.`
                        : `A stage wants to send ${fromAudio ? "your voice and its transcript" : "your text"} to ${textProvider}/${imageProvider}.`}{" "}
                    {sceneStep && <span data-testid="scene" className="block my-1 font-mono text-[11.5px] text-white">{sceneStep}</span>}
                    <button data-testid="allow" onClick={() => run({ cloudPolicy: "allow" })} className={`${chip} ml-2`}>Allow and run</button>
                </div>
            )}

            {keptOnDevice && (
                <div data-testid="kept-on-device" className="mb-5 p-3 rounded-lg border border-green-500/40 text-[13px]">
                    Stopped at the scene: nothing left this device. {sceneStep && <span className="block my-1 font-mono text-[11.5px] text-white">{sceneStep}</span>}
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

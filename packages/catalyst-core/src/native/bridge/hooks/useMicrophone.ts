import { useCallback, useEffect, useRef, useState } from "react"
import { requestMicrophonePermission } from "./microphonePermission.js"

// Click-to-talk recording for web pages. MediaRecorder gives the clip, an AnalyserNode gives a live level, and the
// recording stops by itself after `silenceMs` of quiet once speech was heard, or at `maxSeconds`. The clip is handed
// over as a data URL (what useAI and useTranscribe take) and never leaves the page here.
//
// Inside the Android and iOS apps the shell asks for the microphone first (requestMicrophonePermission), then the web
// view lets getUserMedia through. In a plain browser the browser's own prompt does the asking.

export interface UseMicrophoneOptions {
    /** Called with the finished clip as a data URL, e.g. "data:audio/webm;codecs=opus;base64,...". */
    onRecorded?: (dataUrl: string, info: { seconds: number }) => void
    /** Stop when the speaker pauses. Default true. */
    autoStop?: boolean
    /** Quiet time after speech that ends the recording, in ms. Default 2000. */
    silenceMs?: number
    /** Longest recording, in seconds. Default 120 (what useTranscribe accepts in one go). */
    maxSeconds?: number
    /** Called with the reason when a recording fails or ends with no speech (the same text as `error`). */
    onError?: (message: string) => void
}

/** What start() reports: recording began, or why it could not (the same text as `error`). */
export interface MicrophoneStartResult {
    started: boolean
    error?: string
}

export interface UseMicrophoneResult {
    state: "idle" | "listening"
    listening: boolean
    /** 0..1, how loud the input is right now. */
    level: number
    seconds: number
    error: string | null
    /** False where the page cannot record (no MediaRecorder or getUserMedia, e.g. a non-secure page). */
    supported: boolean
    start: () => Promise<MicrophoneStartResult>
    /** Ends the recording and delivers the clip to onRecorded. */
    stop: () => void
    /** Ends the recording and drops it. */
    cancel: () => void
}

const SPEECH_LEVEL = 0.02 // RMS above this counts as speech
const TICK_MS = 100
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]

const readAsDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
    })

const rms = (bytes: Uint8Array) => {
    let sum = 0
    for (let i = 0; i < bytes.length; i++) {
        const v = (bytes[i] - 128) / 128
        sum += v * v
    }
    return Math.sqrt(sum / bytes.length)
}

export const canRecord = () =>
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined"

interface Session {
    recorder: MediaRecorder
    stream: MediaStream
    context: AudioContext | null
    timer: ReturnType<typeof setInterval> | null
    discard: boolean
    heardSpeech: boolean
    lastLoud: number
}

export function useMicrophone(options: UseMicrophoneOptions = {}): UseMicrophoneResult {
    const { autoStop = true, silenceMs = 2000, maxSeconds = 120 } = options
    const [state, setState] = useState<"idle" | "listening">("idle")
    const [level, setLevel] = useState(0)
    const [seconds, setSeconds] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const live = useRef<Session | null>(null)
    const onRecorded = useRef(options.onRecorded)
    onRecorded.current = options.onRecorded
    const onError = useRef(options.onError)
    onError.current = options.onError
    const fail = useCallback((message: string) => {
        setError(message)
        onError.current?.(message)
    }, [])
    const mounted = useRef(true)
    // Bumped by cancel() and unmount: a start() still waiting for a permission or the microphone then knows it was abandoned.
    const startToken = useRef(0)

    const release = useCallback(() => {
        const s = live.current
        if (!s) return
        if (s.timer) clearInterval(s.timer)
        s.stream.getTracks().forEach((t) => t.stop())
        s.context?.close?.().catch(() => {})
        live.current = null
        if (mounted.current) {
            setLevel(0)
            setState("idle")
        }
    }, [])

    const stop = useCallback(() => {
        const r = live.current?.recorder
        if (r && r.state !== "inactive") r.stop()
    }, [])

    const cancel = useCallback(() => {
        startToken.current++
        if (live.current) live.current.discard = true
        stop()
        release()
    }, [stop, release])

    const start = useCallback(async (): Promise<MicrophoneStartResult> => {
        if (live.current) return { started: false, error: "Already recording." }
        setError(null)
        setSeconds(0)
        const refuse = (message: string): MicrophoneStartResult => {
            fail(message)
            return { started: false, error: message }
        }
        if (!canRecord()) {
            return refuse("This page cannot record audio here (it needs a secure page such as localhost or https, and a browser that supports recording).")
        }
        // In the apps the shell must hold the microphone before the web view lets getUserMedia through. In a plain browser
        // this resolves at once and the browser's own prompt does the asking.
        const token = ++startToken.current
        const abandoned = () => token !== startToken.current || !mounted.current
        try {
            await requestMicrophonePermission()
        } catch {
            if (abandoned()) return { started: false, error: "Cancelled." }
            return refuse("Microphone permission was denied.")
        }
        if (abandoned()) return { started: false, error: "Cancelled." }
        let stream: MediaStream
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        } catch (err: any) {
            if (abandoned()) return { started: false, error: "Cancelled." }
            return refuse(err?.name === "NotAllowedError" ? "Microphone permission was denied." : `Could not open the microphone: ${err?.message || err}`)
        }
        // Cancelled or unmounted while the browser was opening the microphone: release it straight away.
        if (abandoned()) {
            stream.getTracks().forEach((track) => track.stop())
            return { started: false, error: "Cancelled." }
        }
        const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t))
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        const chunks: Blob[] = []
        const Context = (window as any).AudioContext || (window as any).webkitAudioContext
        const context: AudioContext | null = Context ? new Context() : null
        const analyser = context?.createAnalyser() ?? null
        if (analyser && context) {
            analyser.fftSize = 1024
            context.createMediaStreamSource(stream).connect(analyser)
        }
        const buffer = analyser ? new Uint8Array(analyser.fftSize) : null
        const startedAt = Date.now()
        const session: Session = { recorder, stream, context, timer: null, discard: false, heardSpeech: false, lastLoud: startedAt }
        live.current = session

        recorder.ondataavailable = (e) => {
            if (e.data?.size) chunks.push(e.data)
        }
        recorder.onstop = async () => {
            const { discard, heardSpeech } = session
            const secs = Math.round((Date.now() - startedAt) / 100) / 10
            release()
            if (discard || !mounted.current) return
            if (!heardSpeech && analyser) {
                fail("No speech was heard. Check the microphone and try again.")
                return
            }
            try {
                const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
                onRecorded.current?.(await readAsDataUrl(blob), { seconds: secs })
            } catch (err: any) {
                fail(`Could not read the recording: ${err?.message || err}`)
            }
        }

        session.timer = setInterval(() => {
            const now = Date.now()
            const elapsed = (now - startedAt) / 1000
            setSeconds(Math.floor(elapsed))
            if (analyser && buffer) {
                analyser.getByteTimeDomainData(buffer)
                const l = rms(buffer)
                setLevel(Math.min(1, l * 6))
                if (l > SPEECH_LEVEL) {
                    session.heardSpeech = true
                    session.lastLoud = now
                }
                if (autoStop && session.heardSpeech && now - session.lastLoud > silenceMs) stop()
            }
            if (elapsed >= maxSeconds) stop()
        }, TICK_MS)

        recorder.start(250)
        setState("listening")
        return { started: true }
    }, [autoStop, silenceMs, maxSeconds, release, stop, fail])

    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            cancel()
        }
    }, [cancel])

    return { state, listening: state === "listening", level, seconds, error, supported: canRecord(), start, stop, cancel }
}

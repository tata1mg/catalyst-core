import { useCallback, useEffect, useRef, useState } from "react"

// Click-to-talk recorder for the Pipeline lab. Records with MediaRecorder, shows a live level, and stops by itself
// when you stop talking (SILENCE_MS of quiet after speech) or at MAX_SECONDS. Gemini takes the recording as it is
// (webm), so there is no conversion and no 30 s trim on this path; the cap just bounds one request. Hands the finished clip to onRecorded(dataUrl, { seconds }). Nothing leaves the browser here.

export const MAX_SECONDS = 120
const SPEECH_LEVEL = 0.02 // RMS above this counts as speech
const SILENCE_MS = 2000
const TICK_MS = 100

const readAsDataUrl = (blob) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
    })

const rms = (bytes) => {
    let sum = 0
    for (let i = 0; i < bytes.length; i++) {
        const v = (bytes[i] - 128) / 128
        sum += v * v
    }
    return Math.sqrt(sum / bytes.length)
}

export function useVoiceRecorder({ onRecorded, autoStop = true } = {}) {
    const [state, setState] = useState("idle") // idle | listening
    const [level, setLevel] = useState(0)
    const [seconds, setSeconds] = useState(0)
    const [error, setError] = useState(null)
    const live = useRef(null)
    const onRecordedRef = useRef(onRecorded)
    onRecordedRef.current = onRecorded

    const release = useCallback(() => {
        const s = live.current
        if (!s) return
        clearInterval(s.timer)
        s.stream?.getTracks().forEach((t) => t.stop())
        s.context?.close?.().catch(() => {})
        live.current = null
        setLevel(0)
        setState("idle")
    }, [])

    const stop = useCallback(() => {
        const r = live.current?.recorder
        if (r && r.state !== "inactive") r.stop()
    }, [])

    const cancel = useCallback(() => {
        if (live.current) live.current.discard = true
        stop()
        release()
    }, [stop, release])

    const start = useCallback(async () => {
        if (live.current) return
        setError(null)
        setSeconds(0)
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
            setError("This browser cannot record audio here (needs a secure page such as localhost or https).")
            return
        }
        let stream
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        } catch (err) {
            setError(err?.name === "NotAllowedError" ? "Microphone permission was denied." : `Could not open the microphone: ${err?.message || err}`)
            return
        }
        const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported?.(t))
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        const chunks = []
        const Context = window.AudioContext || window.webkitAudioContext
        const context = Context ? new Context() : null
        const analyser = context?.createAnalyser()
        if (analyser) {
            analyser.fftSize = 1024
            context.createMediaStreamSource(stream).connect(analyser)
        }
        const buffer = analyser ? new Uint8Array(analyser.fftSize) : null
        const startedAt = Date.now()
        const session = { recorder, stream, context, discard: false, heardSpeech: false, lastLoud: startedAt, timer: null }
        live.current = session

        recorder.ondataavailable = (e) => e.data?.size && chunks.push(e.data)
        recorder.onstop = async () => {
            const { discard, heardSpeech } = session
            const secs = Math.round((Date.now() - startedAt) / 100) / 10
            release()
            if (discard) return
            if (!heardSpeech && analyser) {
                setError("I did not hear any speech. Check the microphone and try again.")
                return
            }
            try {
                const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
                onRecordedRef.current?.(await readAsDataUrl(blob), { seconds: secs })
            } catch (err) {
                setError(`Could not read the recording: ${err?.message || err}`)
            }
        }

        session.timer = setInterval(() => {
            const now = Date.now()
            const elapsed = (now - startedAt) / 1000
            setSeconds(Math.floor(elapsed))
            if (analyser) {
                analyser.getByteTimeDomainData(buffer)
                const l = rms(buffer)
                setLevel(Math.min(1, l * 6))
                if (l > SPEECH_LEVEL) {
                    session.heardSpeech = true
                    session.lastLoud = now
                }
                if (autoStop && session.heardSpeech && now - session.lastLoud > SILENCE_MS) stop()
            }
            if (elapsed >= MAX_SECONDS) stop()
        }, TICK_MS)

        recorder.start(250)
        setState("listening")
    }, [autoStop, release, stop])

    useEffect(() => () => cancel(), [cancel])

    return { state, level, seconds, error, start, stop, cancel, listening: state === "listening" }
}

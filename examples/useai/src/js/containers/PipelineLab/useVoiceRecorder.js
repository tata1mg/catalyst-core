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
    const requestSeq = useRef(0) // each start() takes a number; cancel() moves it on, so a start still waiting for the microphone permission is void
    const starting = useRef(false) // a start() is waiting for the microphone
    const reading = useRef(new Set()) // every recording that was stopped and is still being turned into a data URL (a second one can start before the first finishes)
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

    // Frees what `session` holds. Only when it is still the live one does it touch the shared state: a stop event can arrive after this
    // recording was cancelled and a new one started, and release() (which works on `live.current`) would end the new one.
    const releaseSession = useCallback(
        (session) => {
            if (live.current === session) {
                release()
                return
            }
            clearInterval(session.timer)
            session.stream?.getTracks().forEach((t) => t.stop())
            session.context?.close?.().catch(() => {})
        },
        [release]
    )

    const cancel = useCallback(() => {
        requestSeq.current++
        if (live.current) live.current.discard = true
        // A recording already stopped and being read is no longer `live`, but it can still be discarded.
        reading.current.forEach((pending) => { pending.discard = true })
        stop()
        release()
    }, [stop, release])

    const start = useCallback(async () => {
        if (live.current || starting.current) return
        setError(null)
        setSeconds(0)
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
            setError("This browser cannot record audio here (needs a secure page such as localhost or https).")
            return
        }
        let stream
        const mine = ++requestSeq.current
        starting.current = true
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        } catch (err) {
            starting.current = false
            if (mine === requestSeq.current) setError(err?.name === "NotAllowedError" ? "Microphone permission was denied." : `Could not open the microphone: ${err?.message || err}`)
            return
        }
        starting.current = false
        // cancel() (or leaving the page) while the permission prompt was open: there is no session to discard, so the stream is closed here.
        if (mine !== requestSeq.current) {
            stream.getTracks().forEach((t) => t.stop())
            return
        }
        let recorder
        let context
        let analyser
        const chunks = []
        try {
            const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported?.(t))
            recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
            const Context = window.AudioContext || window.webkitAudioContext
            context = Context ? new Context() : null
            analyser = context?.createAnalyser()
            if (analyser) {
                analyser.fftSize = 1024
                context.createMediaStreamSource(stream).connect(analyser)
            }
        } catch (err) {
            // The microphone is already open: close it, or it stays on after the error.
            stream.getTracks().forEach((t) => t.stop())
            context?.close?.().catch(() => {})
            setError(`Could not set up recording: ${err?.message || err}`)
            return
        }
        const buffer = analyser ? new Uint8Array(analyser.fftSize) : null
        const startedAt = Date.now()
        const session = { recorder, stream, context, discard: false, heardSpeech: false, lastLoud: startedAt, timer: null }
        live.current = session

        recorder.ondataavailable = (e) => e.data?.size && chunks.push(e.data)
        recorder.onstop = async () => {
            const { heardSpeech } = session
            const secs = Math.round((Date.now() - startedAt) / 100) / 10
            releaseSession(session)
            if (session.discard) return
            if (!heardSpeech && analyser) {
                setError("I did not hear any speech. Check the microphone and try again.")
                return
            }
            try {
                reading.current.add(session)
                const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
                const data = await readAsDataUrl(blob).finally(() => { reading.current.delete(session) })
                // The session object outlives release(): a cancel() that came in while the blob was being read still discards it.
                if (session.discard) return
                onRecordedRef.current?.(data, { seconds: secs })
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

        try {
            recorder.start(250)
        } catch (err) {
            // A stream that went inactive before this point makes start() throw. No stop event will follow, so the normal cleanup never runs.
            session.discard = true
            releaseSession(session)
            setError(`Could not start recording: ${err?.message || err}`)
            return
        }
        setState("listening")
    }, [autoStop, releaseSession, stop])

    useEffect(() => () => cancel(), [cancel])

    return { state, level, seconds, error, start, stop, cancel, listening: state === "listening" }
}

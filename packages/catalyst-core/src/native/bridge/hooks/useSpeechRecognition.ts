import { useCallback, useEffect, useRef, useState } from "react"
import nativeBridge from "../utils/NativeBridge.js"
import { NATIVE_CALLBACKS } from "../constants/NativeInterfaces.js"
import { requestMicrophonePermission } from "./microphonePermission.js"

// Speech to text by the phone's own recognizer (Android SpeechRecognizer, iOS SFSpeechRecognizer), inside the app only.
// Recognition is on-device: when a language has no on-device model the shell refuses with ON_DEVICE_UNAVAILABLE and
// nothing is sent to a server. The result has the same shape as useLiveTranscribe, so a page can use either.

export type SpeechState = "idle" | "starting" | "listening"

/** What the shell reports for a language: can it recognise it without leaving the device. */
export interface SpeechSupport {
    available: boolean
    onDevice: boolean
    language: string
    /** Whether the language's model is on the device now. */
    installed?: boolean
    /** Why it is not available: ON_DEVICE_UNAVAILABLE, LANGUAGE_UNAVAILABLE, PERMISSION_DENIED, ANDROID_VERSION or NO_RESPONSE. */
    reason?: string
}

export interface UseSpeechRecognitionOptions {
    /** BCP 47 tag, default "en-US". */
    language?: string
    /** Called with the final text when a session ends. */
    onFinal?: (text: string) => void
}

export interface UseSpeechRecognitionResult {
    /** Starts listening. Asks for the microphone first; the recognizer ends by itself after a pause. */
    start: () => Promise<void>
    /** Ends the session; the final text for what was heard then arrives. */
    stop: () => void
    /** Ends the session and drops what was heard. */
    cancel: () => void
    state: SpeechState
    listening: boolean
    /** Text heard so far in the current session. */
    partial: string
    /** The final text of the last session. */
    text: string
    /** Not reported by the platform recognizers yet; always 0. Kept so the shape matches useLiveTranscribe. */
    level: number
    seconds: number
    error: string | null
    /** null until the shell has answered; false in a browser, in an app without the command, or when the language cannot be recognised on the device. */
    supported: boolean | null
    support: SpeechSupport | null
}

const SUPPORT_WAIT_MS = 5000

const ERROR_TEXT: Record<string, (language: string) => string> = {
    PERMISSION_DENIED: () => "Microphone or speech recognition permission was denied.",
    ON_DEVICE_UNAVAILABLE: () => "On-device speech recognition is not available on this device.",
    LANGUAGE_UNAVAILABLE: (language) => `On-device speech recognition is not available for ${language}.`,
    NO_SPEECH: () => "No speech was heard.",
    BUSY: () => "Speech recognition is already running.",
    AUDIO: () => "The microphone could not be used.",
}

const parse = (data: unknown): any => {
    if (typeof data !== "string") return data ?? {}
    try {
        return JSON.parse(data)
    } catch {
        return {}
    }
}

const inApp = () => typeof window !== "undefined" && !!(window as any).WebBridge && nativeBridge.isAvailable()

export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}): UseSpeechRecognitionResult {
    const { language = "en-US" } = options
    const [state, setState] = useState<SpeechState>("idle")
    const [partial, setPartial] = useState("")
    const [text, setText] = useState("")
    const [seconds, setSeconds] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [support, setSupport] = useState<SpeechSupport | null>(null)
    const [supported, setSupported] = useState<boolean | null>(null)
    const onFinal = useRef(options.onFinal)
    onFinal.current = options.onFinal
    const discard = useRef(false)
    const languageRef = useRef(language)
    languageRef.current = language

    useEffect(() => {
        if (!inApp()) {
            setSupported(false)
            return
        }
        const bridge = (window as any).WebBridge
        let answered = false
        const timer = setTimeout(() => {
            if (!answered) {
                // A shell built before the command existed (iOS stays silent) never answers.
                setSupport({ available: false, onDevice: false, language, reason: "NO_RESPONSE" })
                setSupported(false)
            }
        }, SUPPORT_WAIT_MS)

        bridge.register(NATIVE_CALLBACKS.SPEECH_RECOGNITION_SUPPORT, (data: unknown) => {
            answered = true
            clearTimeout(timer)
            const reply = parse(data) as SpeechSupport
            setSupport(reply)
            setSupported(!!reply.available)
        })
        bridge.register(NATIVE_CALLBACKS.SPEECH_RECOGNITION_STATE, (data: unknown) => {
            const next = parse(data).state
            if (next === "listening") setState("listening")
            if (next === "idle") setState("idle")
        })
        bridge.register(NATIVE_CALLBACKS.SPEECH_RECOGNITION_PARTIAL, (data: unknown) => {
            if (!discard.current) setPartial(String(parse(data).text ?? ""))
        })
        bridge.register(NATIVE_CALLBACKS.SPEECH_RECOGNITION_FINAL, (data: unknown) => {
            setPartial("")
            if (discard.current) {
                discard.current = false
                return
            }
            const finalText = String(parse(data).text ?? "")
            setText(finalText)
            if (finalText) onFinal.current?.(finalText)
        })
        bridge.register(NATIVE_CALLBACKS.SPEECH_RECOGNITION_ERROR, (data: unknown) => {
            const { code, message } = parse(data)
            setState("idle")
            setPartial("")
            if (code === "CANCELLED") return
            setError((ERROR_TEXT[code] ?? (() => String(message || "Speech recognition failed.")))(languageRef.current))
        })

        try {
            nativeBridge.speech.getSupport(JSON.stringify({ language }))
        } catch {
            clearTimeout(timer)
            setSupported(false)
        }
        return () => {
            clearTimeout(timer)
            for (const name of [
                NATIVE_CALLBACKS.SPEECH_RECOGNITION_SUPPORT,
                NATIVE_CALLBACKS.SPEECH_RECOGNITION_STATE,
                NATIVE_CALLBACKS.SPEECH_RECOGNITION_PARTIAL,
                NATIVE_CALLBACKS.SPEECH_RECOGNITION_FINAL,
                NATIVE_CALLBACKS.SPEECH_RECOGNITION_ERROR,
            ]) {
                bridge.unregister?.(name)
            }
        }
    }, [language])

    // Whole seconds of the session, for a "● 12s" label.
    useEffect(() => {
        if (state !== "listening") return
        setSeconds(0)
        const startedAt = Date.now()
        const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500)
        return () => clearInterval(timer)
    }, [state])

    const start = useCallback(async () => {
        if (!inApp()) {
            setError("Speech recognition by the phone is only available inside the app.")
            return
        }
        if (supported === false) {
            setError(ERROR_TEXT[support?.reason ?? ""]?.(languageRef.current) ?? "This device cannot recognise speech on the device.")
            return
        }
        setError(null)
        setText("")
        setPartial("")
        discard.current = false
        setState("starting")
        try {
            await requestMicrophonePermission()
        } catch {
            setState("idle")
            setError(ERROR_TEXT.PERMISSION_DENIED(languageRef.current))
            return
        }
        try {
            // false = the shell has no such method (an app built before the command existed).
            if (nativeBridge.speech.start(JSON.stringify({ language: languageRef.current })) === false) {
                setState("idle")
                setError("This version of the app cannot recognise speech yet.")
            }
        } catch (err) {
            setState("idle")
            setError(String((err as Error)?.message || err))
        }
    }, [supported, support])

    const stop = useCallback(() => {
        if (inApp()) nativeBridge.speech.stop()
    }, [])

    const cancel = useCallback(() => {
        discard.current = true
        setPartial("")
        if (inApp()) nativeBridge.speech.stop()
    }, [])

    useEffect(() => () => {
        if (inApp()) nativeBridge.speech.stop()
    }, [])

    return { start, stop, cancel, state, listening: state === "listening", partial, text, level: 0, seconds, error, supported, support }
}

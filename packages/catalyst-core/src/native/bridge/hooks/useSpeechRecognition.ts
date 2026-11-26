import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { requestMicrophonePermission } from "./microphonePermission.js"
import { inApp, requestSupport, startSession, stopSession, subscribe } from "./speechBus.js"
import type { SpeechListener, SpeechSupportReply } from "./speechBus.js"

// Speech to text by the phone's own recognizer (Android SpeechRecognizer, iOS SFSpeechRecognizer), inside the app only.
// Recognition is on-device: when a language has no on-device model the shell refuses with ON_DEVICE_UNAVAILABLE and
// nothing is sent to a server. The result has the same shape as useLiveTranscribe, so a page can use either.
//
// Any number of components may use this hook at once: they share one subscription to the shell (see speechBus), and the
// session's events go only to the one that started it.

export type SpeechState = "idle" | "starting" | "listening"

/** What the shell reports for a language: can it recognise it without leaving the device. */
export type SpeechSupport = SpeechSupportReply

export interface UseSpeechRecognitionOptions {
    /** BCP 47 tag, default "en-US". */
    language?: string
    /** Called with the final text when a session ends. */
    onFinal?: (text: string) => void
    /** Called with the shell's error code (NO_SPEECH, ON_DEVICE_UNAVAILABLE, PERMISSION_DENIED, ...) when a session fails. */
    onError?: (code: string) => void
    /** Called with each partial text while listening (before onFinal). */
    onPartial?: (text: string) => void
    /** Called when a session ends with its final text, which is empty when nothing was recognised (onFinal skips that). */
    onEnd?: (text: string) => void
}

/** What start() reports: the request went to the shell, or why it could not (the same codes as `errorCode`). */
export interface SpeechStartResult {
    started: boolean
    code?: string
}

export interface UseSpeechRecognitionResult {
    /** Starts listening. Asks for the microphone first; the recognizer ends by itself after a pause. */
    start: () => Promise<SpeechStartResult>
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
    /** The shell's code for `error` (e.g. NO_SPEECH), or null. */
    errorCode: string | null
    /** null until the shell has answered; false in a browser, in an app without the command, or when the language cannot be recognised on the device. */
    supported: boolean | null
    support: SpeechSupport | null
}

const SUPPORT_WAIT_MS = 5000

export const SPEECH_ERROR_TEXT: Record<string, (language: string) => string> = {
    PERMISSION_DENIED: () => "Microphone or speech recognition permission was denied.",
    ON_DEVICE_UNAVAILABLE: () => "On-device speech recognition is not available on this device.",
    LANGUAGE_UNAVAILABLE: (language) => `On-device speech recognition is not available for ${language}.`,
    NO_SPEECH: () => "No speech was heard.",
    BUSY: () => "Speech recognition is already running.",
    AUDIO: () => "The microphone could not be used.",
}

/**
 * Speech to text by the phone's own recogniser (Android `SpeechRecognizer`, iOS `SFSpeechRecognizer`). Inside the app
 * only: in a browser `supported` is false and `start()` refuses with `UNSUPPORTED`.
 *
 * - `supported` is `null` until the shell has answered whether the language can be recognised on the device.
 * - `start()` asks for the microphone first, then starts. It resolves `{ started: true }`, or `{ started: false, code }`
 *   (`BUSY`, `PERMISSION_DENIED`, `ON_DEVICE_UNAVAILABLE`, ...). If you `cancel()`, `stop()` or unmount while the
 *   permission prompt is open, the late answer starts nothing and the code is `CANCELLED`.
 * - Recognition never leaves the device; with no on-device model for the language the shell answers `ON_DEVICE_UNAVAILABLE`.
 * - `stop()` ends the session and the final text still arrives; `cancel()` ends it and drops what was heard.
 *
 * Most callers want `useTranscribe().listen()`, which routes to this engine (or a recording) by policy.
 */
export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}): UseSpeechRecognitionResult {
    const { language = "en-US" } = options
    const [state, setState] = useState<SpeechState>("idle")
    const [partial, setPartial] = useState("")
    const [text, setText] = useState("")
    const [seconds, setSeconds] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [errorCode, setErrorCode] = useState<string | null>(null)
    const [support, setSupport] = useState<SpeechSupport | null>(null)
    const [supported, setSupported] = useState<boolean | null>(null)
    const onFinal = useRef(options.onFinal)
    onFinal.current = options.onFinal
    const onError = useRef(options.onError)
    onError.current = options.onError
    const onPartial = useRef(options.onPartial)
    onPartial.current = options.onPartial
    const onEnd = useRef(options.onEnd)
    onEnd.current = options.onEnd
    const discard = useRef(false)
    const listeningRef = useRef(false) // the shell says a session of this hook is recording
    // Bumped by cancel(), stop() and unmount, so a start() still waiting for the microphone permission can tell it
    // was abandoned and must not begin recognising when the answer arrives.
    const startToken = useRef(0)
    const mounted = useRef(true)
    const languageRef = useRef(language)
    languageRef.current = language
    const supportedRef = useRef<boolean | null>(null)
    const supportRef = useRef<SpeechSupport | null>(null)
    const supportTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    // start() calls made before the shell has said whether the language can be recognised wait here for its answer (or for the
    // timeout that turns silence into "not available"), instead of posting a command that an older shell would silently ignore.
    const supportWaiters = useRef<Array<() => void>>([])
    const releaseWaiters = () => {
        const waiting = supportWaiters.current
        supportWaiters.current = []
        waiting.forEach((resolve) => resolve())
    }

    const markSupport = useCallback((reply: SpeechSupport) => {
        supportRef.current = reply
        supportedRef.current = !!reply.available
        setSupport(reply)
        setSupported(!!reply.available)
        releaseWaiters()
    }, [])

    // This hook's side of the shared subscription: only what is addressed to it arrives here.
    const listener = useMemo<SpeechListener>(
        () => ({
            language: () => languageRef.current,
            onSupport: (reply) => {
                // The shell answers by event name, not per request: after the language changed, a late answer about the old one must not
                // be taken as the answer for the new one.
                if (reply.language && reply.language.toLowerCase() !== languageRef.current.toLowerCase()) return
                // A reply (now, or cached from another subscriber) ends the wait for one.
                clearTimeout(supportTimer.current)
                markSupport(reply)
            },
            onState: (next) => {
                listeningRef.current = next === "listening"
                if (next === "listening") setState("listening")
                if (next === "idle") setState("idle")
            },
            onPartial: (partialText) => {
                if (discard.current) return
                setPartial(partialText)
                onPartial.current?.(partialText)
            },
            onFinal: (finalText) => {
                setPartial("")
                if (discard.current) {
                    discard.current = false
                    return
                }
                setText(finalText)
                if (finalText) onFinal.current?.(finalText)
                onEnd.current?.(finalText)
            },
            onError: (code, message) => {
                listeningRef.current = false
                setState("idle")
                setPartial("")
                if (code === "CANCELLED") {
                    // Stopping an empty session can end with only this error: that is an empty result, not silence, so
                    // the caller's promise still settles. An explicit cancel() stays silent.
                    if (!discard.current) onEnd.current?.("")
                    return
                }
                // The support check cannot see everything (the iOS Simulator reports en-US as available but has no model
                // files), so a failed start is the truth: stop offering it, the same as if the support check had said no.
                if (code === "ON_DEVICE_UNAVAILABLE" || code === "LANGUAGE_UNAVAILABLE") {
                    markSupport({ available: false, onDevice: false, language: languageRef.current, reason: code })
                }
                setErrorCode(code)
                setError((SPEECH_ERROR_TEXT[code] ?? (() => String(message || "Speech recognition failed.")))(languageRef.current))
                onError.current?.(code)
            },
        }),
        [markSupport]
    )

    useEffect(() => {
        if (!inApp()) {
            setSupported(false)
            return
        }
        // A new language is a new question: what was known about the old one does not carry over.
        supportedRef.current = null
        supportRef.current = null
        setSupport(null)
        setSupported(null)
        const unsubscribe = subscribe(listener)
        // A shell built before the command existed (iOS stays silent) never answers.
        supportTimer.current = setTimeout(() => {
            markSupport({ available: false, onDevice: false, language, reason: "NO_RESPONSE" })
        }, SUPPORT_WAIT_MS)
        if (!requestSupport(listener)) {
            // The shell has no such command: that is a definite answer, so anything already waiting for one is released too.
            clearTimeout(supportTimer.current)
            markSupport({ available: false, onDevice: false, language, reason: "UNSUPPORTED" })
        }
        return () => {
            clearTimeout(supportTimer.current)
            unsubscribe()
            // Unsubscribing stops a session this listener owned, and the shell's later events no longer reach it: nothing would ever clear
            // "listening" again, and start() would answer { started: true } without starting anything. A start still waiting for the permission
            // or support answer is void for the same reason.
            startToken.current++
            listeningRef.current = false
            setPartial("")
            setState((current) => (current === "idle" ? current : "idle"))
        }
    }, [language, listener, markSupport])

    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            startToken.current++
            releaseWaiters() // a start() waiting for the support answer ends instead of hanging
        }
    }, [])

    // Whole seconds of the session, for a "● 12s" label.
    useEffect(() => {
        if (state !== "listening") return
        setSeconds(0)
        const startedAt = Date.now()
        const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500)
        return () => clearInterval(timer)
    }, [state])

    const start = useCallback(async (): Promise<SpeechStartResult> => {
        const refuse = (code: string, message: string): SpeechStartResult => {
            setState("idle")
            setErrorCode(code)
            setError(message)
            return { started: false, code }
        }
        if (!inApp()) return refuse("UNSUPPORTED", "Speech recognition by the phone is only available inside the app.")
        // Already listening: a second start() must not reset the state to "idle" under a recording that is still going on.
        if (listeningRef.current) return { started: true }
        if (supportedRef.current === null) {
            // Not asked yet, or not answered yet. Starting now could post a command the shell never acknowledges and leave the session
            // "starting" for good, so wait for the answer. It is bounded: with no reply the support timer marks it unavailable.
            const waitToken = startToken.current
            setState("starting")
            await new Promise<void>((resolve) => supportWaiters.current.push(resolve))
            if (waitToken !== startToken.current || !mounted.current) return { started: false, code: "CANCELLED" }
        }
        if (supportedRef.current !== true) {
            const reason = supportRef.current?.reason ?? ""
            return refuse(
                reason || "ON_DEVICE_UNAVAILABLE",
                SPEECH_ERROR_TEXT[reason]?.(languageRef.current) ?? "This device cannot recognise speech on the device."
            )
        }
        setError(null)
        setErrorCode(null)
        setText("")
        setPartial("")
        discard.current = false
        const token = ++startToken.current
        setState("starting")
        try {
            await requestMicrophonePermission()
        } catch (err: any) {
            if (token !== startToken.current || !mounted.current) return { started: false, code: "CANCELLED" }
            if (err?.code === "BRIDGE_ERROR") return refuse("UNKNOWN", `Could not ask for the microphone permission: ${err?.message || err}`)
            return refuse("PERMISSION_DENIED", SPEECH_ERROR_TEXT.PERMISSION_DENIED(languageRef.current))
        }
        // The permission prompt can take a while. If the caller cancelled or the component went away meanwhile, there is
        // no session to own, so recognition must not start now.
        if (token !== startToken.current || !mounted.current) return { started: false, code: "CANCELLED" }
        try {
            const started = startSession(listener)
            if (started === "busy") return refuse("BUSY", SPEECH_ERROR_TEXT.BUSY(languageRef.current))
            // false = the shell has no such method (an app built before the command existed).
            if (started === false) return refuse("UNSUPPORTED", "This version of the app cannot recognise speech yet.")
            return { started: true }
        } catch (err) {
            return refuse("UNKNOWN", String((err as Error)?.message || err))
        }
    }, [listener])

    // A start() still waiting for the permission or the support answer owns no native session, so stopSession() says nothing and no event
    // would end "starting". Whoever stops it also resets it.
    const endStarting = () => setState((current) => (current === "starting" ? "idle" : current))

    const stop = useCallback(() => {
        startToken.current++
        if (inApp()) stopSession(listener)
        endStarting()
    }, [listener])

    const cancel = useCallback(() => {
        startToken.current++
        discard.current = true
        setPartial("")
        if (inApp()) stopSession(listener)
        endStarting()
    }, [listener])

    return {
        start,
        stop,
        cancel,
        state,
        listening: state === "listening",
        partial,
        text,
        level: 0,
        seconds,
        error,
        errorCode,
        supported,
        support,
    }
}

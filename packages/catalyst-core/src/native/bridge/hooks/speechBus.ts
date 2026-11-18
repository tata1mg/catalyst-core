import nativeBridge from "../utils/NativeBridge.js"
import { NATIVE_CALLBACKS } from "../constants/NativeInterfaces.js"

// One subscription to the shell's speech recognition events, shared by every hook that listens (useSpeechRecognition,
// and useTranscribe through it). WebBridge keeps ONE handler per event name, so each hook registering its own would
// overwrite the others, and unmounting one would unregister them all.
//
//  - SUPPORT replies go to every subscriber asking about that language.
//  - STATE, PARTIAL, FINAL and ERROR go only to the subscriber that started the session (there is one session at a time
//    in the shell), and that subscriber stays the owner until the session ends.
//  - The shell's callbacks are registered while anyone is subscribed and released when the last one leaves.
//  - A subscriber that leaves while it owns the session stops it; one that does not own it leaves the session alone.

export interface SpeechSupportReply {
    available: boolean
    onDevice: boolean
    language: string
    installed?: boolean
    reason?: string
}

export interface SpeechListener {
    /** The language this subscriber asks about. */
    language: () => string
    onSupport: (reply: SpeechSupportReply) => void
    onState: (state: string) => void
    onPartial: (text: string) => void
    onFinal: (text: string) => void
    onError: (code: string, message: string) => void
}

const EVENTS = [
    NATIVE_CALLBACKS.SPEECH_RECOGNITION_SUPPORT,
    NATIVE_CALLBACKS.SPEECH_RECOGNITION_STATE,
    NATIVE_CALLBACKS.SPEECH_RECOGNITION_PARTIAL,
    NATIVE_CALLBACKS.SPEECH_RECOGNITION_FINAL,
    NATIVE_CALLBACKS.SPEECH_RECOGNITION_ERROR,
]

const listeners = new Set<SpeechListener>()
const supportCache = new Map<string, SpeechSupportReply>()
const supportAsked = new Set<string>()
let owner: SpeechListener | null = null
let registered = false

const parse = (data: unknown): any => {
    if (typeof data !== "string") return data ?? {}
    try {
        return JSON.parse(data)
    } catch {
        return {}
    }
}

const sameLanguage = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export const inApp = () => typeof window !== "undefined" && !!(window as any).WebBridge && nativeBridge.isAvailable()

function dispatch(event: string, data: unknown) {
    const payload = parse(data)
    switch (event) {
        case NATIVE_CALLBACKS.SPEECH_RECOGNITION_SUPPORT: {
            const reply = payload as SpeechSupportReply
            if (typeof reply.language === "string") supportCache.set(reply.language.toLowerCase(), reply)
            for (const l of [...listeners]) if (typeof reply.language !== "string" || sameLanguage(l.language(), reply.language)) l.onSupport(reply)
            return
        }
        case NATIVE_CALLBACKS.SPEECH_RECOGNITION_STATE:
            owner?.onState(String(payload.state ?? ""))
            // The session is over once the shell says idle: the next start may belong to someone else.
            if (payload.state === "idle") owner = null
            return
        case NATIVE_CALLBACKS.SPEECH_RECOGNITION_PARTIAL:
            owner?.onPartial(String(payload.text ?? ""))
            return
        case NATIVE_CALLBACKS.SPEECH_RECOGNITION_FINAL:
            owner?.onFinal(String(payload.text ?? ""))
            return
        case NATIVE_CALLBACKS.SPEECH_RECOGNITION_ERROR: {
            const target = owner
            owner = null // an error ends the session; the shell may not send idle after a failed start
            target?.onError(String(payload.code ?? "UNKNOWN"), String(payload.message ?? ""))
        }
    }
}

function register() {
    if (registered || !inApp()) return
    const bridge = (window as any).WebBridge
    for (const name of EVENTS) bridge.register(name, (data: unknown) => dispatch(name, data))
    registered = true
}

function release() {
    if (!registered) return
    registered = false
    const bridge = (window as any).WebBridge
    for (const name of EVENTS) bridge?.unregister?.(name)
    supportCache.clear()
    supportAsked.clear()
}

/** Starts listening to the shell. Returns the function that stops (the subscriber leaving ends its own session). */
export function subscribe(listener: SpeechListener): () => void {
    listeners.add(listener)
    register()
    return () => {
        if (owner === listener) {
            owner = null
            try {
                nativeBridge.speech.stop()
            } catch {
                // the shell is gone with the page; nothing to stop
            }
        }
        listeners.delete(listener)
        if (listeners.size === 0) release()
    }
}

/**
 * Asks whether this language can be recognised on the device. A language already answered is replied to at once; one
 * already asked is not asked again (the reply reaches every subscriber). Returns false when the shell has no such command.
 */
export function requestSupport(listener: SpeechListener): boolean {
    const language = listener.language()
    const cached = supportCache.get(language.toLowerCase())
    if (cached) {
        listener.onSupport(cached)
        return true
    }
    if (supportAsked.has(language.toLowerCase())) return true
    supportAsked.add(language.toLowerCase())
    try {
        nativeBridge.speech.getSupport(JSON.stringify({ language }))
        return true
    } catch {
        supportAsked.delete(language.toLowerCase())
        return false
    }
}

/** Starts a session owned by this subscriber. false = the shell has no such command, or another subscriber has a session. */
export function startSession(listener: SpeechListener): boolean | "busy" {
    if (owner && owner !== listener) return "busy"
    owner = listener
    const started = nativeBridge.speech.start(JSON.stringify({ language: listener.language() }))
    if (started === false) {
        owner = null
        return false
    }
    return true
}

/** Ends the session if this subscriber owns it; the final text still arrives. */
export function stopSession(listener: SpeechListener) {
    if (owner === listener) nativeBridge.speech.stop()
}

/** The language replied to already, if any (a subscriber joining late). */
export function cachedSupport(language: string): SpeechSupportReply | undefined {
    return supportCache.get(language.toLowerCase())
}

/** For tests: drop every subscriber and the shell registration. */
export function resetSpeechBus() {
    listeners.clear()
    owner = null
    release()
}

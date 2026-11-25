import { useCallback, useEffect, useRef, useState } from "react"
import { useAI } from "./useAI.js"
import { PLATFORM_SPEECH } from "./aiRouter.js"
import type { Candidate, RouteDecision } from "./aiRouter.js"
import { prepareAudioChunks } from "./aiGeneration.js"
import { SPEECH_ERROR_TEXT, useSpeechRecognition } from "./useSpeechRecognition.js"
import { useMicrophone } from "./useMicrophone.js"

/**
 * idle -> running -> done | error; "listening" while listen() is taking the microphone; "needs-consent" / "denied" when
 * the router would not run the call as configured.
 */
export type TranscribeStatus = "idle" | "listening" | "running" | "needs-consent" | "denied" | "error" | "done"

/** What heard the voice in listen(): the phone's own recogniser, or a recording sent to the routed model. */
export type TranscribeEngine = "platform-speech" | "recorder"

export interface TranscribeConsent {
    /** Allow this one call to leave the device. */
    cloud?: boolean
    /** Allow the in-browser model to start its large download. */
    download?: boolean
}

/** A recording as a data URL, or a File/Blob (a voice note picked from disk, a MediaRecorder result). */
export type AudioSource = string | Blob

export interface UseTranscribeOptions {
    /** What to ask the model. Speech-to-text models ignore it; Gemma-class models follow it. */
    instructions?: string
    /**
     * Longest piece sent to the model in one call, in seconds. A longer recording is cut into pieces at quiet moments
     * and the transcripts are joined. Default 28 (the on-device encoders take 30). `null` sends the recording whole,
     * which is right for a cloud model that takes long audio. Whole-recording mode does NOT decode the clip, so it is not
     * limited by `maxSeconds`, and `durationSec` stays 0 and `truncated` false in its result (the length is not measured).
     */
    chunkSeconds?: number | null
    /** Longest recording accepted, in seconds. Longer audio is cut there and `truncated` is true. Default 120. Not applied when `chunkSeconds` is `null` (the clip is sent whole, undecoded). */
    maxSeconds?: number
    /** Skip pieces with no speech in them (a speech model tends to invent text on silence). Default true. */
    skipSilence?: boolean
    /** Free the on-device model from GPU/RAM when a transcription ends (the download stays cached). Default true. */
    unloadWhenDone?: boolean
    /** BCP 47 tag for the phone's recogniser in listen(). Default "en-US". */
    language?: string
    /** Passed to useAI. `provider` defaults to "auto" (see AI_CONFIG.routing); `routing` overrides the policy. */
    [aiOption: string]: unknown
}

export interface TranscribeProgress {
    /** The piece being transcribed, counting from 1. */
    chunk: number
    of: number
}

export interface TranscribeResult {
    text: string
    /** Length of the recording that was transcribed, in seconds. */
    durationSec: number
    /** True when the recording was longer than `maxSeconds` and the rest was not transcribed. */
    truncated: boolean
    /** Pieces transcribed / pieces skipped as silent. */
    chunks: number
    skipped: number
    /** Set by listen(): which engine heard the voice. */
    engine?: TranscribeEngine
}

export interface UseTranscribeResult {
    /** Transcribe a recording; resolves with the result, or null when it did not complete (see `status`). */
    transcribe: (source: AudioSource) => Promise<TranscribeResult | null>
    /**
     * Listen to the microphone and resolve with the transcript when the speaker pauses (or stopListening() is called).
     * With provider "auto" the router picks the engine: on iOS and Android the phone's own recogniser (on-device, streams
     * partial text, no model to load) when the shell supports it, otherwise a recording sent to the routed model. If the
     * recogniser fails to start because it is not available, the call is decided again without it, so voice only goes where
     * the routing policy allows. Stops at "needs-consent" / "denied" like transcribe(). Resolves null when it did not finish.
     */
    listen: (consent?: TranscribeConsent) => Promise<TranscribeResult | null>
    /** Ends the listening session; the final text still arrives. */
    stopListening: () => void
    /** True while listen() has the microphone. */
    listening: boolean
    /** Text heard so far in the current listen() (the phone's recogniser streams it; a recording has none until it ends). */
    partial: string
    /** 0..1 loudness while a recording is being made; 0 for the phone's recogniser, which does not report it. */
    level: number
    /** Which engine the current or last listen() uses. */
    engine: TranscribeEngine | null
    /** Whether the phone's recogniser can be used here: null until the shell answers, false in a browser. */
    platformSpeech: boolean | null
    /** After status "needs-consent": allow what the router asked for and run the same recording (or listen) again. */
    approve: (consent: TranscribeConsent) => Promise<TranscribeResult | null>
    /** The transcript so far, growing piece by piece while a long recording runs. */
    text: string
    result: TranscribeResult | null
    status: TranscribeStatus
    loading: boolean
    error: Error | null
    progress: TranscribeProgress | null
    /** Why the router picked its model, or why it would not run (auto routing only). */
    route: RouteDecision | null
    truncated: boolean
    /** State of the on-device model behind the call (downloading, loading, ready). */
    model: {
        ready: boolean
        downloadProgress: { file?: string; percent?: number; status?: string } | null
        downloadPaused: boolean
        downloadPauseReason: string | null
    }
    /** The error of the latest transcription, read right away (state is not updated until the next render). */
    lastError: () => Error | null
    /** Stop a running transcription and forget the result. */
    cancel: () => void
    clear: () => void
}

export class TranscribeError extends Error {
    constructor(
        message: string,
        readonly code: "TRANSCRIBE_SOURCE" | "TRANSCRIBE_DECODE" | "TRANSCRIBE_UNAVAILABLE" | "TRANSCRIBE_SPEECH" | "TRANSCRIBE_NO_SPEECH"
    ) {
        super(message)
        this.name = "TranscribeError"
    }
}

const DEFAULT_INSTRUCTIONS = "Transcribe this audio exactly. Reply with the transcript only."

interface State {
    text: string
    result: TranscribeResult | null
    status: TranscribeStatus
    error: Error | null
    progress: TranscribeProgress | null
    route: RouteDecision | null
    partial: string
    engine: TranscribeEngine | null
}
const initial = (): State => ({ text: "", result: null, status: "idle", error: null, progress: null, route: null, partial: "", engine: null })

// What the router is asked when listen() has no clip yet: audio in, transcribing out. The data is never read.
const LIVE_PROBE = {
    task: "speech.transcribe",
    messages: [{ role: "user", content: [{ type: "audio", data: "data:audio/wav;base64," }] }],
}
// Failures that mean "the phone's recogniser is not usable here", as opposed to something that went wrong while using it.
const RECOGNISER_UNAVAILABLE = new Set(["ON_DEVICE_UNAVAILABLE", "LANGUAGE_UNAVAILABLE", "UNSUPPORTED"])

interface LiveSession {
    id: number
    consent: TranscribeConsent
    kind: "platform" | "recorder" | null
    /** The routed candidate, pinned so the clip goes to the engine that was decided. */
    chosenId?: string
    /** Something was heard already: a later failure is reported, not answered with a fallback. */
    heard: boolean
    /** stopListening() was called: whatever is still being decided or started must not take the microphone afterwards. */
    stopRequested?: boolean
    startedAt: number
    resolve: (result: TranscribeResult | null) => void
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
    })

const message = (data: string, instructions: string) => [{ role: "user", content: [{ type: "audio", data }, { type: "text", text: instructions }] }]

/**
 * Speech to text, on the device when it can.
 *
 *   const { transcribe, text, status, progress } = useTranscribe()
 *   const mic = useMicrophone({ onRecorded: (clip) => transcribe(clip) })
 *
 * A recording longer than the on-device encoders take (30 s) is decoded once, cut into pieces at quiet moments,
 * transcribed one after another on the same engine, and joined. With provider "auto" nothing leaves the device unless
 * the routing policy says so: by default audio is never sent to a cloud model, and a call that needs consent stops at
 * status "needs-consent" until `approve()` is called, which applies to every piece of the recording.
 */
export function useTranscribe(options: UseTranscribeOptions = {}): UseTranscribeResult {
    const { instructions = DEFAULT_INSTRUCTIONS, chunkSeconds, maxSeconds = 120, skipSilence = true, unloadWhenDone = true, language = "en-US", ...aiOptions } = options
    const ai: any = useAI({ provider: "auto", ...aiOptions })
    const aiRef = useRef(ai)
    aiRef.current = ai
    const config = useRef({ instructions, chunkSeconds, maxSeconds, skipSilence, unloadWhenDone })
    config.current = { instructions, chunkSeconds, maxSeconds, skipSilence, unloadWhenDone }

    const [state, setState] = useState<State>(initial)
    const requestId = useRef(0)
    const lastAction = useRef<{ kind: "clip"; source: AudioSource } | { kind: "listen" } | null>(null)
    const lastErrorRef = useRef<Error | null>(null)
    const sessionRef = useRef<LiveSession | null>(null)
    const mounted = useRef(true)

    // The two live sources, each shared with other components through its own hook. Their callbacks route into whichever
    // listen() session is current, through `live` (refreshed every render, so they always see the latest handlers).
    const live = useRef<{
        partial: (text: string) => void
        end: (text: string) => void
        speechError: (code: string) => void
        recorded: (clip: string) => void
        micError: (message: string) => void
    }>({ partial: () => {}, end: () => {}, speechError: () => {}, recorded: () => {}, micError: () => {} })
    const speech = useSpeechRecognition({
        language,
        onPartial: (text) => live.current.partial(text),
        onEnd: (text) => live.current.end(text),
        onError: (code) => live.current.speechError(code),
    })
    const speechRef = useRef(speech)
    speechRef.current = speech
    const mic = useMicrophone({
        maxSeconds,
        onRecorded: (clip) => live.current.recorded(clip),
        onError: (message) => live.current.micError(message),
    })
    const micRef = useRef(mic)
    micRef.current = mic

    const endSession = useCallback((result: TranscribeResult | null) => {
        const session = sessionRef.current
        sessionRef.current = null
        session?.resolve(result)
    }, [])

    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            requestId.current++
            aiRef.current.cancel?.()
            endSession(null) // a pending listen() must not hang
        }
    }, [endSession])

    const update = useCallback((id: number, patch: Partial<State>) => {
        if (mounted.current && id === requestId.current) setState((s) => ({ ...s, ...patch }))
    }, [])

    const execute = useCallback(
        async (source: AudioSource, consent: TranscribeConsent, meta?: { engine: TranscribeEngine }): Promise<TranscribeResult | null> => {
            const id = ++requestId.current
            const { instructions, chunkSeconds, maxSeconds, skipSilence, unloadWhenDone } = config.current
            lastAction.current = meta ? { kind: "listen" } : { kind: "clip", source }
            lastErrorRef.current = null
            aiRef.current.cancel?.()
            if (mounted.current) setState({ ...initial(), status: "running", engine: meta?.engine ?? null })

            const fail = (error: Error): null => {
                lastErrorRef.current = error
                update(id, { status: "error", error, progress: null })
                return null
            }

            let dataUrl: string
            try {
                dataUrl = typeof source === "string" ? source : await blobToDataUrl(source)
                if (!dataUrl.startsWith("data:")) throw new Error("Audio must be a data URL, a File or a Blob")
            } catch (cause) {
                return fail(new TranscribeError((cause as Error).message, "TRANSCRIBE_SOURCE"))
            }
            // Reading a Blob takes time. If this request was cancelled, superseded or unmounted meanwhile, its audio must
            // not reach a model (this also covers the whole-recording branch below, which has no later check before generate).
            if (id !== requestId.current) return null

            // Whole recording in one call (chunkSeconds null), or decoded once and cut into pieces that fit the encoders.
            let pieces: { data: string; silent: boolean }[]
            let durationSec = 0
            let truncated = false
            if (chunkSeconds === null) {
                pieces = [{ data: dataUrl, silent: false }]
            } else {
                try {
                    const prepared = await prepareAudioChunks(dataUrl, { ...(chunkSeconds && { chunkSeconds }), maxSeconds })
                    pieces = prepared.chunks
                    durationSec = prepared.durationSec
                    truncated = prepared.truncated
                } catch (cause) {
                    const err = cause as Error
                    return fail(new TranscribeError(err.message, /catalyst-ai/.test(err.message) ? "TRANSCRIBE_UNAVAILABLE" : "TRANSCRIBE_DECODE"))
                }
                if (id !== requestId.current) return null
            }

            const todo = skipSilence ? pieces.filter((p) => !p.silent) : pieces
            const skipped = pieces.length - todo.length
            const texts: string[] = []
            let pin: string | undefined
            let ranAny = false
            try {
                for (let i = 0; i < todo.length; i++) {
                    update(id, { progress: { chunk: i + 1, of: todo.length } })
                    const result = await aiRef.current.generate({ task: "speech.transcribe", messages: message(todo[i].data, instructions) }, { ...consent, ...(pin && { pin }) })
                    if (id !== requestId.current) return null // superseded by a newer call, cancelled, or unmounted
                    if (!result) return fail(new TranscribeError("The AI engine is not available (is catalyst-ai installed?)", "TRANSCRIBE_UNAVAILABLE"))

                    const route: RouteDecision | undefined = result.route
                    if (route) update(id, { route })
                    if (route && route.action !== "run") {
                        update(id, { status: route.action === "ask" ? "needs-consent" : "denied", progress: null })
                        return null
                    }
                    // Stay on the engine the first piece chose: re-ranking between pieces could switch models mid-recording.
                    if (i === 0 && route?.candidate?.id) pin = route.candidate.id
                    ranAny = true
                    if (result.error) return fail(result.error)

                    const piece = String(result.output ?? "").trim()
                    if (piece) texts.push(piece)
                    update(id, { text: texts.join(" ") })
                }
            } finally {
                // Once, at the end: unloading per piece would reload the model for every 28 s of a long recording.
                // Not when a newer call took over: it may be using the model.
                if (unloadWhenDone && ranAny && id === requestId.current) aiRef.current.unload?.()
            }

            const finished: TranscribeResult = { text: texts.join(" "), durationSec, truncated, chunks: todo.length, skipped, ...(meta && { engine: meta.engine }) }
            update(id, { text: finished.text, result: finished, status: "done", error: null, progress: null })
            return finished
        },
        [update]
    )

    // ---- listen(): the microphone is taken by the engine the router picks ------------------------------------------------

    const finishLive = (id: number, text: string, engine: TranscribeEngine) => {
        const session = sessionRef.current
        if (!session || session.id !== id || id !== requestId.current) return
        const durationSec = Math.round((Date.now() - session.startedAt) / 100) / 10
        const finished: TranscribeResult = { text, durationSec, truncated: false, chunks: 1, skipped: 0, engine }
        update(id, { text, partial: "", result: finished, status: "done", error: null, engine })
        endSession(finished)
    }

    const failLive = (id: number, error: TranscribeError) => {
        const session = sessionRef.current
        if (!session || session.id !== id || id !== requestId.current) return
        lastErrorRef.current = error
        update(id, { status: "error", error, partial: "", progress: null })
        endSession(null)
    }

    const speechFailure = (code: string) =>
        new TranscribeError(
            SPEECH_ERROR_TEXT[code]?.(language) ?? `Speech recognition failed (${code}).`,
            code === "NO_SPEECH" ? "TRANSCRIBE_NO_SPEECH" : RECOGNISER_UNAVAILABLE.has(code) ? "TRANSCRIBE_UNAVAILABLE" : "TRANSCRIBE_SPEECH"
        )

    const startPlatform = async (id: number) => {
        const session = sessionRef.current
        if (!session || session.id !== id) return
        session.kind = "platform"
        session.heard = false
        update(id, { status: "listening", engine: "platform-speech", partial: "", text: "" })
        const started = await speechRef.current.start()
        if (id !== requestId.current || sessionRef.current?.id !== id) return
        if (started.started) return
        // Could not start. Not available here: decide again without the recogniser (the privacy policy applies to that
        // decision too). Anything else is reported.
        if (RECOGNISER_UNAVAILABLE.has(started.code ?? "")) return beginRef.current(id, false)
        failLive(id, speechFailure(started.code ?? "UNKNOWN"))
    }

    const startRecorder = async (id: number) => {
        const session = sessionRef.current
        if (!session || session.id !== id) return
        session.kind = "recorder"
        update(id, { status: "listening", engine: "recorder", partial: "" })
        const started = await micRef.current.start()
        if (id !== requestId.current || sessionRef.current?.id !== id) return
        if (!started.started) failLive(id, new TranscribeError(started.error || "The microphone could not be used.", "TRANSCRIBE_SPEECH"))
    }

    /** Decide which engine takes the microphone, then start it. `allowPlatform` is false once it has failed to start. */
    const begin = async (id: number, allowPlatform: boolean) => {
        const session = sessionRef.current
        if (!session || session.id !== id) return
        if (session.stopRequested) return endSession(null)
        let chosen: Candidate | null = null
        // With provider "auto" the router picks. With an explicit provider there is nothing to route: record, then send the
        // clip to that provider (the phone's recogniser is only ever a routed choice).
        if (typeof aiRef.current.decide === "function") {
            let decision: RouteDecision
            try {
                decision = await aiRef.current.decide(LIVE_PROBE, session.consent, { platformSpeech: allowPlatform && speechRef.current.supported === true })
            } catch (cause) {
                return failLive(id, new TranscribeError(String((cause as Error)?.message || cause), "TRANSCRIBE_UNAVAILABLE"))
            }
            if (id !== requestId.current || sessionRef.current?.id !== id) return
            // Stopped while the router was deciding (including the second decision after the phone's recogniser could not start).
            if (session.stopRequested) return endSession(null)
            update(id, { route: decision })
            if (decision.action !== "run" || !decision.candidate) {
                update(id, { status: decision.action === "ask" ? "needs-consent" : "denied", progress: null })
                return endSession(null)
            }
            chosen = decision.candidate
        }
        session.chosenId = chosen?.id
        return chosen?.engine === PLATFORM_SPEECH ? startPlatform(id) : startRecorder(id)
    }
    const beginRef = useRef(begin)
    beginRef.current = begin

    // Events from the two live sources, for whichever session is current.
    live.current = {
        partial: (text) => {
            const session = sessionRef.current
            if (!session || session.kind !== "platform") return
            session.heard = session.heard || text.length > 0
            update(session.id, { partial: text })
        },
        end: (text) => {
            const session = sessionRef.current
            if (!session || session.kind !== "platform") return
            if (text.trim()) finishLive(session.id, text.trim(), "platform-speech")
            else failLive(session.id, speechFailure("NO_SPEECH"))
        },
        speechError: (code) => {
            const session = sessionRef.current
            if (!session || session.kind !== "platform") return
            // Not available, and nothing was said yet: the recogniser never worked here, so decide again without it.
            // A failure after speech started is reported instead: the person would have to say it again either way.
            if (RECOGNISER_UNAVAILABLE.has(code) && !session.heard) void beginRef.current(session.id, false)
            else failLive(session.id, speechFailure(code))
        },
        recorded: (clip) => {
            const session = sessionRef.current
            if (!session || session.kind !== "recorder" || session.id !== requestId.current) return
            void (async () => {
                // execute() takes the next request id synchronously, so this is the id that belongs to THIS recording.
                const promise = execute(clip, { ...session.consent, ...(session.chosenId && { pin: session.chosenId }) } as TranscribeConsent, { engine: "recorder" })
                const ownId = requestId.current
                try {
                    // The clip goes to the engine the router chose, with the same consent; execute() takes it from here.
                    const result = await promise
                    if (sessionRef.current === session) endSession(result)
                } catch (cause) {
                    // A newer request (transcribe(B), a new listen()) owns the state now: an older recording's failure is not B's.
                    if (ownId !== requestId.current) {
                        if (sessionRef.current === session) endSession(null) // its listen() still has to settle, without touching the newer state
                        return
                    }
                    // execute() reports its own failures, but anything it lets escape must still end the session: otherwise listen()
                    // never settles and the rejection goes unhandled. execute() has moved the request id on, so this reports against the
                    // current one, the same as a normal finish does.
                    if (sessionRef.current !== session) return
                    const error = cause instanceof TranscribeError ? cause : new TranscribeError((cause as Error)?.message || String(cause), "TRANSCRIBE_SPEECH")
                    lastErrorRef.current = error
                    update(requestId.current, { status: "error", error, partial: "", progress: null })
                    endSession(null)
                }
            })()
        },
        micError: (message) => {
            const session = sessionRef.current
            if (!session || session.kind !== "recorder") return
            failLive(session.id, new TranscribeError(message, message.startsWith("No speech") ? "TRANSCRIBE_NO_SPEECH" : "TRANSCRIBE_SPEECH"))
        },
    }

    const stopLive = useCallback(() => {
        speechRef.current.cancel()
        micRef.current.cancel()
        endSession(null)
    }, [endSession])

    const listen = useCallback(
        (consent: TranscribeConsent = {}) => {
            stopLive() // one session at a time
            const id = ++requestId.current
            lastAction.current = { kind: "listen" }
            lastErrorRef.current = null
            aiRef.current.cancel?.()
            if (mounted.current) setState({ ...initial(), status: "running" })
            const done = new Promise<TranscribeResult | null>((resolve) => {
                sessionRef.current = { id, consent, kind: null, heard: false, startedAt: Date.now(), resolve }
            })
            void beginRef.current(id, true)
            return done
        },
        [stopLive]
    )

    const stopListening = useCallback(() => {
        const session = sessionRef.current
        if (!session) return
        session.stopRequested = true
        if (session.kind === "platform") speechRef.current.stop()
        else if (session.kind === "recorder") micRef.current.stop()
        else stopLive() // still deciding: nothing to wait for
    }, [stopLive])

    const transcribe = useCallback((source: AudioSource) => execute(source, {}), [execute])
    const approve = useCallback(
        async (consent: TranscribeConsent) => {
            const last = lastAction.current
            if (!last) return null
            return last.kind === "listen" ? listen(consent) : execute(last.source, consent)
        },
        [execute, listen]
    )
    const clear = useCallback(() => {
        requestId.current++
        aiRef.current.cancel?.()
        lastAction.current = null
        stopLive()
        if (mounted.current) setState(initial())
    }, [stopLive])

    return {
        transcribe,
        listen,
        stopListening,
        listening: state.status === "listening",
        partial: state.partial,
        level: state.engine === "recorder" ? mic.level : 0,
        engine: state.engine,
        platformSpeech: speech.supported,
        approve,
        text: state.text,
        result: state.result,
        status: state.status,
        loading: state.status === "running",
        error: state.error,
        progress: state.progress,
        route: state.route ?? ai.route ?? null,
        truncated: state.result?.truncated ?? false,
        model: {
            ready: ai.modelReady !== false,
            downloadProgress: ai.downloadProgress ?? null,
            downloadPaused: !!ai.downloadPaused,
            downloadPauseReason: ai.downloadPauseReason ?? null,
        },
        lastError: () => lastErrorRef.current,
        cancel: clear,
        clear,
    }
}

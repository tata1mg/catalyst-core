import { useCallback, useEffect, useRef, useState } from "react"
import { useAI } from "./useAI.js"
import type { RouteDecision } from "./aiRouter.js"
import { prepareAudioChunks } from "./aiGeneration.js"

/** idle -> running -> done | error; "needs-consent" / "denied" when the router would not run the call as configured. */
export type TranscribeStatus = "idle" | "running" | "needs-consent" | "denied" | "error" | "done"

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
     * which is right for a cloud model that takes long audio.
     */
    chunkSeconds?: number | null
    /** Longest recording accepted, in seconds. Longer audio is cut there and `truncated` is true. Default 120. */
    maxSeconds?: number
    /** Skip pieces with no speech in them (a speech model tends to invent text on silence). Default true. */
    skipSilence?: boolean
    /** Free the on-device model from GPU/RAM when a transcription ends (the download stays cached). Default true. */
    unloadWhenDone?: boolean
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
}

export interface UseTranscribeResult {
    /** Transcribe a recording; resolves with the result, or null when it did not complete (see `status`). */
    transcribe: (source: AudioSource) => Promise<TranscribeResult | null>
    /** After status "needs-consent": allow what the router asked for and run the same recording again. */
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
        readonly code: "TRANSCRIBE_SOURCE" | "TRANSCRIBE_DECODE" | "TRANSCRIBE_UNAVAILABLE"
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
}
const initial = (): State => ({ text: "", result: null, status: "idle", error: null, progress: null, route: null })

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
    const { instructions = DEFAULT_INSTRUCTIONS, chunkSeconds, maxSeconds = 120, skipSilence = true, unloadWhenDone = true, ...aiOptions } = options
    const ai: any = useAI({ provider: "auto", ...aiOptions })
    const aiRef = useRef(ai)
    aiRef.current = ai
    const config = useRef({ instructions, chunkSeconds, maxSeconds, skipSilence, unloadWhenDone })
    config.current = { instructions, chunkSeconds, maxSeconds, skipSilence, unloadWhenDone }

    const [state, setState] = useState<State>(initial)
    const requestId = useRef(0)
    const lastSource = useRef<AudioSource | null>(null)
    const lastErrorRef = useRef<Error | null>(null)
    const mounted = useRef(true)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            requestId.current++
            aiRef.current.cancel?.()
        }
    }, [])

    const update = useCallback((id: number, patch: Partial<State>) => {
        if (mounted.current && id === requestId.current) setState((s) => ({ ...s, ...patch }))
    }, [])

    const execute = useCallback(
        async (source: AudioSource, consent: TranscribeConsent): Promise<TranscribeResult | null> => {
            const id = ++requestId.current
            const { instructions, chunkSeconds, maxSeconds, skipSilence, unloadWhenDone } = config.current
            lastSource.current = source
            lastErrorRef.current = null
            aiRef.current.cancel?.()
            if (mounted.current) setState({ ...initial(), status: "running" })

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

            const finished: TranscribeResult = { text: texts.join(" "), durationSec, truncated, chunks: todo.length, skipped }
            update(id, { text: finished.text, result: finished, status: "done", error: null, progress: null })
            return finished
        },
        [update]
    )

    const transcribe = useCallback((source: AudioSource) => execute(source, {}), [execute])
    const approve = useCallback(
        async (consent: TranscribeConsent) => {
            if (lastSource.current === null) return null
            return execute(lastSource.current, consent)
        },
        [execute]
    )
    const clear = useCallback(() => {
        requestId.current++
        aiRef.current.cancel?.()
        lastSource.current = null
        if (mounted.current) setState(initial())
    }, [])

    return {
        transcribe,
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

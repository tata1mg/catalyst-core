import { useCallback, useEffect, useRef, useState } from "react"
import { useAI } from "./useAI.js"
import type { RouteDecision } from "./aiRouter.js"
import { buildPrompt, correctionPrompt, extractJson, validate } from "./vision/schema.js"
import type { Schema } from "./vision/schema.js"
import { toImageDataUrl } from "./vision/source.js"
import type { ImageSource } from "./vision/source.js"

export type { Schema } from "./vision/schema.js"
export type { ImageSource } from "./vision/source.js"

/** idle -> running -> done | error; "needs-consent" / "denied" when the router would not run the call as configured. */
export type VisionStatus = "idle" | "running" | "needs-consent" | "denied" | "error" | "done"

export interface VisionConsent {
    /** Allow this one call to leave the device. */
    cloud?: boolean
    /** Allow the in-browser model to start its large download. */
    download?: boolean
}

export interface UseVisionOptions {
    /** The shape of the answer, as a JSON-Schema subset (type, properties, required, items, enum, nullable). */
    schema: Schema
    /** What to read from the image. A default instruction is used when omitted. */
    instructions?: string
    /** Tries per scan: after an unusable reply the model is told what was wrong and asked once more. Default 2. */
    maxAttempts?: number
    /** Passed to useAI. `provider` defaults to "auto" (see AI_CONFIG.routing); `routing` overrides the policy. */
    [aiOption: string]: unknown
}

export interface UseVisionResult<T> {
    /** Read the image and resolve with the typed result, or null when it did not complete (see `status`). */
    scan: (source: ImageSource) => Promise<T | null>
    /** After status "needs-consent": allow what the router asked for and run the same scan again. */
    approve: (consent: VisionConsent) => Promise<T | null>
    /** The validated result of the last scan. */
    data: T | null
    /** The model's last raw reply (useful when `status` is "error"). */
    raw: string
    status: VisionStatus
    /** True while a scan is running. */
    loading: boolean
    error: Error | null
    /** Why the router picked its model, or why it would not run (auto routing only). */
    route: RouteDecision | null
    /** Replies tried for the last scan. */
    attempts: number
    /** Text arriving from the model while a scan runs. */
    partial: string
    clear: () => void
}

export class VisionError extends Error {
    constructor(
        message: string,
        readonly code: "VISION_INVALID_OUTPUT" | "VISION_UNAVAILABLE" | "VISION_SOURCE",
        readonly problems: string[] = []
    ) {
        super(message)
        this.name = "VisionError"
    }
}

interface State<T> {
    data: T | null
    raw: string
    status: VisionStatus
    error: Error | null
    route: RouteDecision | null
    attempts: number
}
const initial = <T,>(): State<T> => ({ data: null, raw: "", status: "idle", error: null, route: null, attempts: 0 })

/**
 * Read an image into typed data, on the device when it can.
 *
 *   const { scan, data, status } = useVision<LabReport>({ schema, instructions: "Read this lab report." })
 *   await scan(photo)            // a captured photo, a File/Blob, or a data:/blob:/https URL
 *
 * The photo goes to the model as an image part with a prompt built from `schema`; the reply is parsed and checked
 * against it, with one corrective retry. With provider "auto" nothing leaves the device unless the routing policy
 * says so: by default images are never sent to a cloud model, and a call that needs consent stops at
 * status "needs-consent" until `approve()` is called.
 */
export function useVision<T = unknown>(options: UseVisionOptions): UseVisionResult<T> {
    const { schema, instructions, maxAttempts = 2, ...aiOptions } = options
    const ai: any = useAI({ provider: "auto", ...aiOptions })
    const aiRef = useRef(ai)
    aiRef.current = ai
    const config = useRef({ schema, instructions, maxAttempts })
    config.current = { schema, instructions, maxAttempts }

    const [state, setState] = useState<State<T>>(initial)
    const requestId = useRef(0)
    const lastSource = useRef<ImageSource | null>(null)
    const mounted = useRef(true)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])

    const update = useCallback((id: number, patch: Partial<State<T>>) => {
        if (mounted.current && id === requestId.current) setState((s) => ({ ...s, ...patch }))
    }, [])

    const execute = useCallback(
        async (source: ImageSource, consent: VisionConsent): Promise<T | null> => {
            const id = ++requestId.current
            const { schema, instructions, maxAttempts } = config.current
            lastSource.current = source
            aiRef.current.cancel?.()
            if (mounted.current) setState({ ...initial<T>(), status: "running" })

            const fail = (error: Error, raw = "", attempts = 0): null => {
                update(id, { status: "error", error, raw, attempts })
                return null
            }

            let imageUrl: string
            try {
                imageUrl = await toImageDataUrl(source)
            } catch (cause) {
                return fail(new VisionError((cause as Error).message, "VISION_SOURCE"))
            }

            const base = [
                {
                    role: "user",
                    content: [
                        { type: "image", data: imageUrl },
                        { type: "text", text: buildPrompt(schema, instructions) },
                    ],
                },
            ]
            let messages: any[] = base
            let raw = ""
            let problems: string[] = []

            for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
                const result = await aiRef.current.generate({ messages }, consent)
                if (id !== requestId.current) return null // superseded by a newer scan, or unmounted
                if (!result) return fail(new VisionError("The AI engine is not available (is catalyst-ai installed?)", "VISION_UNAVAILABLE"), raw, attempt)

                const route: RouteDecision | undefined = result.route
                if (route) update(id, { route })
                if (route && route.action !== "run") {
                    update(id, { status: route.action === "ask" ? "needs-consent" : "denied", attempts: attempt - 1 })
                    return null
                }
                if (result.error) return fail(result.error, raw, attempt)

                raw = result.output ?? ""
                const parsed = extractJson(raw)
                problems = parsed.ok ? validate(schema, parsed.value) : [parsed.error as string]
                if (parsed.ok && problems.length === 0) {
                    update(id, { data: parsed.value as T, raw, status: "done", error: null, attempts: attempt })
                    return parsed.value as T
                }
                update(id, { raw, attempts: attempt })
                messages = [...base, { role: "assistant", content: raw || "(empty)" }, { role: "user", content: correctionPrompt(problems) }]
            }
            return fail(new VisionError(`The model's answer did not match the schema: ${problems.slice(0, 3).join("; ")}`, "VISION_INVALID_OUTPUT", problems), raw, maxAttempts)
        },
        [update]
    )

    const scan = useCallback((source: ImageSource) => execute(source, {}), [execute])
    const approve = useCallback(
        async (consent: VisionConsent) => {
            if (lastSource.current === null) return null
            return execute(lastSource.current, consent)
        },
        [execute]
    )
    const clear = useCallback(() => {
        requestId.current++
        aiRef.current.cancel?.()
        lastSource.current = null
        if (mounted.current) setState(initial<T>())
    }, [])

    return {
        scan,
        approve,
        data: state.data,
        raw: state.raw,
        status: state.status,
        loading: state.status === "running",
        error: state.error,
        route: state.route ?? ai.route ?? null,
        attempts: state.attempts,
        partial: ai.output ?? "",
        clear,
    }
}

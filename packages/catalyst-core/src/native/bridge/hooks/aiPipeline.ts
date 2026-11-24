// The engine behind usePipeline: typed multi-stage pipelines (audio -> text -> json(schema) -> image, with plain code
// steps in between). Pure (no React, no catalyst-ai) so every rule is unit-tested, like aiAgent.ts.
//
// Rules enforced here, not left to a stage:
//   - the pipeline is a chain: a stage's output type must equal the next stage's input type, checked at construction;
//   - every value is checked against its declared type at run time (a model that returns the wrong shape stops the run
//     at the stage that produced it, not three stages later);
//   - a spend cap stops the run BEFORE the next stage (stages report cost with ctx.addCost);
//   - a stage marked `cloud: true` never runs silently on audio-derived data: cloudPolicy decides, and "deny" (the
//     default there) / "ask" stop the run with status "denied" / "needs-consent", same words as useAgent;
//   - cancellation (AbortSignal) is checked between stages and handed to every stage.

import { buildPrompt, correctionPrompt, extractJson, validate } from "./vision/schema.js"
import type { Schema } from "./vision/schema.js"

export type PipelineType = "audio" | "text" | "json" | "image" | "audio-out"
export const PIPELINE_TYPES: readonly PipelineType[] = ["audio", "text", "json", "image", "audio-out"]

export interface StageContext {
    signal: AbortSignal
    /** Report what this stage cost (USD) so the shared spend cap can see it. Adds up across calls. */
    addCost: (usd: number) => void
    index: number
    name: string
}

export interface Stage<I = any, O = any> {
    name: string
    input: PipelineType
    output: PipelineType
    /** The stage calls something that leaves the device. See RunPipelineOptions.cloudPolicy. */
    cloud?: boolean
    run: (input: I, ctx: StageContext) => Promise<O> | O
}

export type CloudPolicy = "allow" | "ask" | "deny"
export type PipelineStatus = "done" | "cancelled" | "error" | "max-spend" | "needs-consent" | "denied"

export type PipelineStep =
    | { type: "start"; index: number; stage: string; inputType: PipelineType; cloud: boolean; at: number; preview: string }
    | { type: "end"; index: number; stage: string; outputType: PipelineType; durationMs: number; costUsd: number; preview: string }
    | { type: "error"; index: number; stage: string; durationMs: number; error: string }
    | { type: "blocked"; index: number; stage: string; reason: "needs-consent" | "denied" | "max-spend" }

export interface RunPipelineOptions {
    signal?: AbortSignal
    onStep?: (step: PipelineStep) => void
    /** Stop before the next stage once the cost reported so far reaches this (USD). Off by default. */
    maxCostUsd?: number
    /**
     * What to do before a `cloud: true` stage that would see audio-derived data. Default "deny" there; for data that
     * did not come from audio the default is "allow". An explicit value applies to every cloud stage.
     */
    cloudPolicy?: CloudPolicy
}

export interface PipelineResult {
    status: PipelineStatus
    /** The last stage's output when status is "done", else undefined. */
    output?: unknown
    steps: PipelineStep[]
    spentUsd: number
    error?: Error
    /** The stage that failed or was blocked. */
    stage?: string
}

const PREVIEW = 200
const clip = (text: string, max = PREVIEW) => (text.length > max ? `${text.slice(0, max)}... (${text.length} chars)` : text)

const isBinary = (v: any) => v instanceof ArrayBuffer || ArrayBuffer.isView(v) || (typeof Blob !== "undefined" && v instanceof Blob)
const isPlainObject = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v)
const hasRef = (v: any) => isPlainObject(v) && (typeof v.uri === "string" || typeof v.url === "string" || typeof v.data === "string" || isBinary(v.data))

function describe(v: unknown): string {
    if (v === null) return "null"
    if (Array.isArray(v)) return "an array"
    if (typeof v === "object") return "an object"
    return typeof v
}

/** Problem with `value` as `type`, or null when it fits. Deliberately about shape, not content. */
export function checkType(type: PipelineType, value: unknown): string | null {
    switch (type) {
        case "text":
            return typeof value === "string" ? null : `expected text (a string), got ${describe(value)}`
        case "json":
            if (value === undefined || typeof value === "function" || typeof value === "symbol") return `expected json, got ${describe(value)}`
            try {
                JSON.stringify(value)
                return null
            } catch (_) {
                return "expected json, got a value that cannot be serialised"
            }
        case "image":
            // A URL / data: URL, or an object carrying one ({ url, data, mimeType } as returned by requestImage).
            return (typeof value === "string" && value.length > 0) || hasRef(value) ? null : `expected an image (URL string or { url | data }), got ${describe(value)}`
        case "audio":
        case "audio-out":
            return (typeof value === "string" && value.length > 0) || isBinary(value) || hasRef(value)
                ? null
                : `expected audio (Blob, bytes, URI string or { uri | url | data }), got ${describe(value)}`
    }
}

/** Short, safe-to-log description of a value (never dumps image/audio payloads). */
export function preview(type: PipelineType, value: unknown): string {
    if (type === "text") return clip(String(value))
    if (type === "json") {
        try {
            return clip(JSON.stringify(value) ?? "undefined")
        } catch (_) {
            return "(unserialisable)"
        }
    }
    const v: any = value
    const kind = type === "image" ? "image" : "audio"
    // Metadata only. A non-data string may be a signed URL, a local path or a token in a query string, and previews go to every event consumer.
    if (typeof v === "string") return `${kind} (${v.startsWith("data:") ? "data URL" : "reference"}, ${v.length} chars)`
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return `${kind} (${v.byteLength} bytes)`
    if (typeof Blob !== "undefined" && v instanceof Blob) return `${kind} (${v.size} bytes${v.type ? `, ${v.type}` : ""})`
    if (isPlainObject(v)) return `${kind} (${v.mimeType ?? "object"})`
    return kind
}

/** Throws a clear error for a malformed pipeline; returns the stages. Called by runPipeline and usePipeline. */
export function validatePipeline<T extends Stage[]>(stages: T): T {
    if (!Array.isArray(stages) || stages.length === 0) throw new Error("A pipeline needs at least one stage")
    const seen = new Set<string>()
    stages.forEach((s, i) => {
        if (!s || typeof s.name !== "string" || !s.name) throw new Error(`Stage ${i + 1} needs a name`)
        if (seen.has(s.name)) throw new Error(`Duplicate stage name "${s.name}"`)
        seen.add(s.name)
        if (!PIPELINE_TYPES.includes(s.input)) throw new Error(`Stage "${s.name}" has an unknown input type "${s.input}" (use ${PIPELINE_TYPES.join(", ")})`)
        if (!PIPELINE_TYPES.includes(s.output)) throw new Error(`Stage "${s.name}" has an unknown output type "${s.output}" (use ${PIPELINE_TYPES.join(", ")})`)
        if (typeof s.run !== "function") throw new Error(`Stage "${s.name}" needs a run function`)
    })
    for (let i = 0; i < stages.length - 1; i++) {
        const a = stages[i]
        const b = stages[i + 1]
        if (a.output !== b.input) {
            throw new Error(`Stage "${a.name}" outputs "${a.output}" but stage "${b.name}" expects "${b.input}"`)
        }
    }
    return stages
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(new Error("cancelled"))
        if (signal.aborted) return onAbort()
        signal.addEventListener("abort", onAbort, { once: true })
        promise.then(
            (v) => {
                signal.removeEventListener("abort", onAbort)
                resolve(v)
            },
            (e) => {
                signal.removeEventListener("abort", onAbort)
                reject(e)
            }
        )
    })
}

export async function runPipeline(stages: Stage[], input: unknown, options: RunPipelineOptions = {}): Promise<PipelineResult> {
    validatePipeline(stages)
    const { signal, onStep, maxCostUsd, cloudPolicy } = options
    const steps: PipelineStep[] = []
    let spentUsd = 0
    const record = (step: PipelineStep) => {
        steps.push(step)
        try {
            onStep?.(step)
        } catch (_) {
            // a listener's bug must not break the run
        }
    }
    const finish = (status: PipelineStatus, extra: Partial<PipelineResult> = {}): PipelineResult => ({ status, steps, spentUsd, ...extra })
    const cancelled = () => !!signal?.aborted
    const fail = (index: number, stage: string, started: number, error: Error) => {
        record({ type: "error", index, stage, durationMs: Date.now() - started, error: error.message })
        return finish("error", { error, stage })
    }

    // Anything derived from audio is treated as sensitive: the transcript is as private as the recording.
    let audioDerived = false
    let value = input
    const firstProblem = checkType(stages[0].input, value)
    if (firstProblem) return finish("error", { error: new Error(`Pipeline input for stage "${stages[0].name}": ${firstProblem}`), stage: stages[0].name })

    for (let index = 0; index < stages.length; index++) {
        const stage = stages[index]
        if (cancelled()) return finish("cancelled", { stage: stage.name })
        if (maxCostUsd !== undefined && spentUsd >= maxCostUsd) {
            record({ type: "blocked", index, stage: stage.name, reason: "max-spend" })
            return finish("max-spend", { stage: stage.name })
        }
        if (stage.input === "audio") audioDerived = true

        if (stage.cloud) {
            const policy: CloudPolicy = cloudPolicy ?? (audioDerived ? "deny" : "allow")
            if (policy !== "allow") {
                const status = policy === "ask" ? "needs-consent" : "denied"
                record({ type: "blocked", index, stage: stage.name, reason: status })
                return finish(status, { stage: stage.name })
            }
        }

        const started = Date.now()
        let stageCost = 0
        record({ type: "start", index, stage: stage.name, inputType: stage.input, cloud: !!stage.cloud, at: started, preview: preview(stage.input, value) })
        const ctx: StageContext = {
            signal: signal ?? new AbortController().signal,
            index,
            name: stage.name,
            addCost: (usd) => {
                if (typeof usd === "number" && Number.isFinite(usd) && usd > 0) {
                    stageCost += usd
                    spentUsd += usd
                }
            },
        }

        let out: unknown
        try {
            out = await raceAbort(Promise.resolve().then(() => stage.run(value, ctx)), signal)
        } catch (cause) {
            if (cancelled()) {
                record({ type: "error", index, stage: stage.name, durationMs: Date.now() - started, error: "cancelled" })
                return finish("cancelled", { stage: stage.name })
            }
            return fail(index, stage.name, started, cause instanceof Error ? cause : new Error(String(cause)))
        }
        if (cancelled()) {
            record({ type: "error", index, stage: stage.name, durationMs: Date.now() - started, error: "cancelled" })
            return finish("cancelled", { stage: stage.name })
        }
        const problem = checkType(stage.output, out)
        if (problem) return fail(index, stage.name, started, new Error(`Stage "${stage.name}" returned the wrong type: ${problem}`))
        record({ type: "end", index, stage: stage.name, outputType: stage.output, durationMs: Date.now() - started, costUsd: stageCost, preview: preview(stage.output, out) })
        value = out
    }
    return finish("done", { output: value })
}

// ---- Stage factories -------------------------------------------------------------------------------------------

/** A deterministic code step (a pure function between model stages). */
export function codeStage<I = any, O = any>(name: string, input: PipelineType, output: PipelineType, fn: (input: I, ctx: StageContext) => Promise<O> | O): Stage<I, O> {
    return { name, input, output, run: fn }
}

type TranscribeResult = string | { text: string; costUsd?: number }

/** audio -> text. `fn(audio, ctx)` is any async function (Whisper, Gemini, a native recogniser); it may return a string or { text, costUsd }. */
export function transcribeStage(
    fn: (audio: any, ctx: StageContext) => Promise<TranscribeResult> | TranscribeResult,
    options: { name?: string; cloud?: boolean } = {}
): Stage<any, string> {
    return {
        name: options.name ?? "transcribe",
        input: "audio",
        output: "text",
        cloud: options.cloud,
        run: async (audio, ctx) => {
            const result = await fn(audio, ctx)
            if (typeof result === "string") return result
            if (result && typeof result.costUsd === "number") ctx.addCost(result.costUsd)
            return result?.text as string
        },
    }
}

type JsonGenerateResult = string | { output?: string; text?: string; costUsd?: number; error?: Error | string | null }

/**
 * text -> json. Calls `generate(prompt, ctx)` (any text generator), extracts the JSON from the reply and validates it
 * against `schema` (the same extractJson / validate / correctionPrompt useVision and useAgent use). One corrective
 * retry; a second failure ends the stage with an error naming the problems.
 */
export function jsonStage(options: {
    schema: Schema
    generate: (prompt: string, ctx: StageContext) => Promise<JsonGenerateResult> | JsonGenerateResult
    name?: string
    instructions?: string
    cloud?: boolean
}): Stage<string, unknown> {
    const { schema, generate } = options
    return {
        name: options.name ?? "json",
        input: "text",
        output: "json",
        cloud: options.cloud,
        run: async (text, ctx) => {
            const base = `${buildPrompt(schema, options.instructions ?? "Extract the requested information from the text below.")}\n\nText:\n<<<\n${text}\n>>>`
            let prompt = base
            let problems: string[] = []
            for (let attempt = 0; attempt < 2; attempt++) {
                if (ctx.signal.aborted) throw new Error("cancelled")
                const result = await generate(prompt, ctx)
                const raw = typeof result === "string" ? result : (result?.output ?? result?.text ?? "")
                if (result && typeof result === "object") {
                    if (typeof result.costUsd === "number") ctx.addCost(result.costUsd)
                    if (result.error) throw result.error instanceof Error ? result.error : new Error(String(result.error))
                }
                const parsed = extractJson(raw)
                problems = parsed.ok ? validate(schema, parsed.value) : [parsed.error as string]
                if (!problems.length) return parsed.value
                prompt = `${base}\n\nYour previous reply:\n${raw || "(empty)"}\n\n${correctionPrompt(problems)}`
            }
            throw new Error(`The model did not produce valid JSON after one retry: ${problems.slice(0, 3).join("; ")}`)
        },
    }
}

/**
 * json -> image via requestImage ({ images: [{ url, ... }], usage }). Marked cloud (requestImage uses the cloud route).
 * `cost(result)` maps the response to USD for the spend cap; without it the stage reports no cost.
 */
export function imageStage(options: {
    requestImage: (args: { prompt: string; signal?: AbortSignal } & Record<string, unknown>) => Promise<{ images?: any[]; usage?: unknown }>
    prompt: (json: any) => string | Promise<string>
    name?: string
    cloud?: boolean
    cost?: (result: { images?: any[]; usage?: unknown }) => number | undefined
    /** Extra arguments for requestImage (provider, size, model, ...). */
    requestOptions?: Record<string, unknown>
    /** Input images (data URLs or { mimeType, data }) derived from the stage input; makes the request an edit/transform. Omitted when empty. */
    images?: (json: any) => any[] | undefined | Promise<any[] | undefined>
}): Stage<any, any> {
    return {
        name: options.name ?? "image",
        input: "json",
        output: "image",
        cloud: options.cloud ?? true,
        run: async (json, ctx) => {
            const prompt = await options.prompt(json)
            const images = options.images ? await options.images(json) : undefined
            const result = await options.requestImage({ ...options.requestOptions, prompt, ...(images?.length ? { images } : {}), signal: ctx.signal })
            const cost = options.cost?.(result)
            if (cost) ctx.addCost(cost)
            const first = result?.images?.[0]
            if (!first) throw new Error("The image request returned no images")
            return first
        },
    }
}

/** text -> audio-out. `fn(text, ctx)` is any text-to-speech function. */
export function speechStage(fn: (text: string, ctx: StageContext) => Promise<any> | any, options: { name?: string; cloud?: boolean } = {}): Stage<string, any> {
    return { name: options.name ?? "speech", input: "text", output: "audio-out", cloud: options.cloud, run: fn }
}

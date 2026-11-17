import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { runPipeline, validatePipeline } from "./aiPipeline.js"
import type { CloudPolicy, PipelineResult, PipelineStatus, PipelineStep, Stage } from "./aiPipeline.js"

export type { CloudPolicy, PipelineResult, PipelineStatus, PipelineStep, Stage, StageContext, PipelineType } from "./aiPipeline.js"
export { transcribeStage, jsonStage, imageStage, speechStage, codeStage, runPipeline } from "./aiPipeline.js"

export type UsePipelineStatus = "idle" | "running" | PipelineStatus

export interface UsePipelineOptions {
    /** Default spend cap (USD) for every run. */
    maxCostUsd?: number
    /** Default cloud policy; see runPipeline. */
    cloudPolicy?: CloudPolicy
}

export interface UsePipelineResult {
    /** Runs the pipeline. Pass { cloudPolicy: "allow" } to retry after the user agreed to a "needs-consent" stop. */
    run: (input: unknown, overrides?: UsePipelineOptions) => Promise<PipelineResult>
    cancel: () => void
    /** Start / end / error events, growing while the run progresses. */
    steps: PipelineStep[]
    output: unknown
    status: UsePipelineStatus
    error: Error | null
    spentUsd: number
}

/**
 * Typed multi-stage pipeline, e.g. audio -> text -> json(schema) -> image. The chain is checked when `stages` first
 * has a given identity (a mismatch throws, naming both stages); values are checked as they flow. Keep `stages` stable
 * (module level or useMemo); the latest array is used for each run.
 *
 *   const p = usePipeline([transcribeStage(whisper), jsonStage({ schema, generate }), imageStage({ requestImage, prompt: (j) => j.scene })])
 *   await p.run(audioBlob)  // status "needs-consent" if a cloud stage would see audio-derived data; re-run with { cloudPolicy: "allow" }
 */
export function usePipeline(stages: Stage[], options: UsePipelineOptions = {}): UsePipelineResult {
    useMemo(() => validatePipeline(stages), [stages])
    const config = useRef({ stages, options })
    config.current = { stages, options }

    const [status, setStatus] = useState<UsePipelineStatus>("idle")
    const [steps, setSteps] = useState<PipelineStep[]>([])
    const [output, setOutput] = useState<unknown>(undefined)
    const [error, setError] = useState<Error | null>(null)
    const [spentUsd, setSpentUsd] = useState(0)

    const runId = useRef(0)
    const abort = useRef<AbortController | null>(null)
    const mounted = useRef(true)

    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            abort.current?.abort()
        }
    }, [])

    const run = useCallback(async (input: unknown, overrides: UsePipelineOptions = {}): Promise<PipelineResult> => {
        const id = ++runId.current
        abort.current?.abort()
        const controller = new AbortController()
        abort.current = controller
        const live = () => mounted.current && id === runId.current
        if (live()) {
            setStatus("running")
            setSteps([])
            setOutput(undefined)
            setError(null)
            setSpentUsd(0)
        }
        const { stages: current, options: defaults } = config.current
        const result = await runPipeline(current, input, {
            signal: controller.signal,
            maxCostUsd: overrides.maxCostUsd ?? defaults.maxCostUsd,
            cloudPolicy: overrides.cloudPolicy ?? defaults.cloudPolicy,
            onStep: (step) => {
                if (live()) setSteps((all) => [...all, step])
            },
        })
        if (live()) {
            setStatus(result.status)
            setOutput(result.output)
            setError(result.error ?? null)
            setSpentUsd(result.spentUsd)
        }
        return result
    }, [])

    const cancel = useCallback(() => abort.current?.abort(), [])

    return { run, cancel, steps, output, status, error, spentUsd }
}

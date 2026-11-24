import { useCallback, useEffect, useRef, useState } from "react"
import { useAI } from "./useAI.js"
import { runAgent } from "./aiAgent.js"
import type { AgentConfirmRequest, AgentLimits, AgentResult, AgentStatus, AgentStep, AgentTool } from "./aiAgent.js"

export type { AgentConfirmRequest, AgentLimits, AgentResult, AgentStatus, AgentStep, AgentTool } from "./aiAgent.js"

export type UseAgentStatus = "idle" | "running" | "awaiting-confirmation" | AgentStatus

export interface AgentConsent {
    cloud?: boolean
    download?: boolean
}

export interface UseAgentOptions {
    tools: AgentTool[]
    /** Who the agent is and what it may do; the tool protocol is added after it. */
    instructions?: string
    limits?: AgentLimits
    /** Everything else goes to useAI (provider, model, routing, ...). Routing is "auto" unless set. */
    [aiOption: string]: unknown
}

export interface UseAgentResult {
    /** Runs the agent on a goal. Resolves when it stops, whatever the reason. */
    run: (goal: string, consent?: AgentConsent) => Promise<AgentResult>
    /**
     * Answer to `pendingConfirmation`: let the side-effecting tool run, or refuse it. Pass `pendingConfirmation.id` to
     * answer that prompt only: an answer carrying an id that is no longer the pending one (a late click on an older
     * prompt) is ignored. Without an id it answers whatever is pending.
     */
    approve: (id?: number) => void
    deny: (id?: number) => void
    cancel: () => void
    status: UseAgentStatus
    /** Every step so far, growing while the agent runs. */
    steps: AgentStep[]
    output: string
    error: Error | null
    /** A side-effecting tool the agent wants to run, waiting for approve() / deny(). */
    pendingConfirmation: AgentConfirmRequest | null
    /** Estimated cost of the calls so far (USD). */
    spentUsd: number
    route: unknown
}

/**
 * A runtime agent: the model picks a tool from `tools`, the app runs it, the result goes back, until it answers or a
 * limit stops it. Steps stream into `steps` as they happen. Limits (turns, spend), confirmation for tools marked
 * `sideEffect`, and the treatment of tool results as untrusted data are enforced in code (see aiAgent.ts), not left
 * to the prompt. With provider "auto" nothing leaves the device unless the routing policy allows it; when it does not,
 * `status` becomes "needs-consent" and run() can be called again with consent.
 *
 *   const agent = useAgent({ tools: [scanTool, fillFormTool, submitTool /* sideEffect: true *\/], limits: { maxSteps: 6 } })
 *   await agent.run("Scan this lab report and fill in the form")
 *   // agent.pendingConfirmation → agent.approve() / agent.deny()
 */
export function useAgent(options: UseAgentOptions): UseAgentResult {
    const { tools, instructions, limits, ...aiOptions } = options
    const ai: any = useAI({ provider: "auto", ...aiOptions })
    const aiRef = useRef(ai)
    aiRef.current = ai
    const config = useRef({ tools, instructions, limits })
    config.current = { tools, instructions, limits }

    const [status, setStatus] = useState<UseAgentStatus>("idle")
    const [steps, setSteps] = useState<AgentStep[]>([])
    const [output, setOutput] = useState("")
    const [error, setError] = useState<Error | null>(null)
    const [pending, setPending] = useState<AgentConfirmRequest | null>(null)
    const [spentUsd, setSpentUsd] = useState(0)
    const [route, setRoute] = useState<unknown>(null)

    const runId = useRef(0)
    const abort = useRef<AbortController | null>(null)
    const resolver = useRef<((allowed: boolean) => void) | null>(null)
    const pendingId = useRef<number | null>(null)
    const confirmSeq = useRef(0)
    const mounted = useRef(true)

    const settle = useCallback((allowed: boolean, id?: number) => {
        // An answer aimed at a particular prompt settles only that prompt.
        if (id !== undefined && id !== pendingId.current) return
        const resolve = resolver.current
        resolver.current = null
        pendingId.current = null
        if (mounted.current) setPending(null)
        if (resolve) resolve(allowed)
    }, [])

    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            abort.current?.abort()
            settle(false)
        }
    }, [settle])

    const run = useCallback(
        async (goal: string, consent: AgentConsent = {}): Promise<AgentResult> => {
            const id = ++runId.current
            abort.current?.abort()
            settle(false)
            const controller = new AbortController()
            abort.current = controller
            const live = () => mounted.current && id === runId.current
            if (live()) {
                setStatus("running")
                setSteps([])
                setOutput("")
                setError(null)
                setSpentUsd(0)
                setRoute(null)
            }
            const result = await runAgent({
                goal,
                tools: config.current.tools,
                instructions: config.current.instructions,
                limits: config.current.limits,
                signal: controller.signal,
                generate: async (messages) => aiRef.current.generate({ messages }, consent),
                confirm: (request) =>
                    new Promise<boolean>((resolve) => {
                        if (!live()) return resolve(false)
                        const id = ++confirmSeq.current
                        pendingId.current = id
                        resolver.current = resolve
                        setPending({ ...request, id })
                        setStatus("awaiting-confirmation")
                    }),
                onStep: (step) => {
                    if (!live()) return
                    setSteps((all) => [...all, step])
                    setStatus("running")
                },
            })
            if (live()) {
                setStatus(result.status)
                setOutput(result.output)
                setError(result.error ?? null)
                setSpentUsd(result.spentUsd)
                setRoute(result.route ?? null)
                setPending(null)
            }
            return result
        },
        [settle]
    )

    const cancel = useCallback(() => {
        abort.current?.abort()
        aiRef.current.cancel?.()
        settle(false)
    }, [settle])

    return {
        run,
        approve: useCallback((id?: number) => settle(true, id), [settle]),
        deny: useCallback((id?: number) => settle(false, id), [settle]),
        cancel,
        status,
        steps,
        output,
        error,
        pendingConfirmation: pending,
        spentUsd,
        route,
    }
}

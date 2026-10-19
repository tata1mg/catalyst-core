import { useContext, useEffect, useRef, useState } from "react"
import { RouteContext } from "./routeContext.js"
import { registerTool, unregisterTool, updateToolRoute, updateToolSpec, newOwnerKey } from "./registry.js"

/**
 * useTool — register an imperative WebMCP action tool for the lifetime of the
 * calling component, or for the lifetime of a `deps` window within it.
 *
 * What the hook adds on top of a raw `document.modelContext.registerTool`:
 *
 *   - Lifetime: registers after mount, unregisters (and aborts any in-flight
 *     execute) on unmount.
 *   - Route scoping: the tool is tagged with the route path it was mounted
 *     under, so WebMcpProvider can reap it the moment the agent navigates away
 *     — even if this component's own unmount hasn't flushed yet.
 *   - Deferred until the client: never registers during SSR (no document) or
 *     before hydration. React effects already run post-hydration, so simply
 *     living in `useEffect` is the deferral — no `hydrationReady` needed.
 *   - Stable identity: the tool spec is read through a ref, so re-renders with
 *     a new inline `execute` closure don't churn the registration.
 *   - `deps` (optional, useEffect-style array): when a value in `deps`
 *     changes, the tool's description/inputSchema/annotations/execute are
 *     swapped IN PLACE on the still-live registration via updateToolSpec() —
 *     never torn down and re-registered. A real unmount (or the route no
 *     longer matching) is still the only thing that unregisters. This matters
 *     because a naive effect-array re-registration would reopen the
 *     WEBMCP_ABORTED bug fixed earlier: an agent call in flight against the
 *     old AbortController would be orphaned the instant a dep (e.g. cart
 *     quantity) changed mid-call. Swapping in place keeps the same
 *     AbortController and receipt across a deps change, so an in-flight call
 *     always completes against a live entry.
 *
 * @param {{
 *   name: string,
 *   description: string,
 *   inputSchema: object,
 *   annotations?: object,
 *   execute: (args: any, ctx: { signal: AbortSignal }) => Promise<any>,
 * }} spec
 * @param {any[]} [deps] omit to behave exactly as before (register once on
 *   mount, keyed only by tool name); pass an array to also refresh the spec
 *   in place whenever an entry changes.
 *
 * @returns {{
 *   status: "idle" | "registered" | "error",
 *   receipt: object | null,   // registration receipt — NOT an execution result
 *   error: import("./errors.js").WebMcpError | null,
 * }}
 */
export function useTool(spec, deps) {
    const specRef = useRef(spec)
    specRef.current = spec

    const ownerKeyRef = useRef(null)
    if (ownerKeyRef.current === null) ownerKeyRef.current = newOwnerKey()

    // The nearest matched route path, provided by WebMcpProvider.
    const routePath = useContext(RouteContext)
    const routePathRef = useRef(routePath)
    routePathRef.current = routePath

    const [state, setState] = useState({ status: "idle", receipt: null, error: null })

    // Register ONCE per mounted component (keyed only by tool name). The tool's
    // route scope can change while mounted — e.g. a transient re-match during a
    // navigation — without tearing the registration down and back up, which
    // would orphan the AbortController the agent is mid-call against. Route
    // changes are pushed to the registry in place via updateToolRoute().
    useEffect(() => {
        if (typeof document === "undefined") return undefined

        const ownerKey = ownerKeyRef.current
        const s = specRef.current
        const liveSpec = {
            name: s.name,
            description: s.description,
            inputSchema: s.inputSchema,
            annotations: s.annotations,
            // Always dispatch to the latest execute + latest route.
            execute: (args, ctx) => specRef.current.execute(args, ctx),
        }

        const res = registerTool(ownerKey, routePathRef.current || "", liveSpec)
        if (res.ok) {
            setState({ status: "registered", receipt: res.receipt, error: null })
        } else {
            setState({ status: "error", receipt: null, error: res.error })
            // eslint-disable-next-line no-console
            console.warn(`[webmcp] useTool("${s.name}") failed to register:`, res.error)
        }

        return () => {
            unregisterTool(ownerKey)
        }
    }, [spec.name])

    // Keep the registry's notion of this tool's route current, in place.
    useEffect(() => {
        if (typeof document === "undefined") return
        updateToolRoute(ownerKeyRef.current, routePath || "")
    }, [routePath])

    // Optional deps array: refresh description/inputSchema/annotations/execute
    // on the existing registration in place whenever a dep changes. Skipped
    // entirely when the caller doesn't pass `deps` — that's the "register
    // once, execute always reads specRef.current" behaviour from above, which
    // already reflects the latest closure on every call.
    useEffect(() => {
        if (deps === undefined) return
        if (typeof document === "undefined") return
        const s = specRef.current
        updateToolSpec(ownerKeyRef.current, {
            description: s.description,
            inputSchema: s.inputSchema,
            annotations: s.annotations,
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps || [])

    return state
}

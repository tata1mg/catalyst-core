import React, { createContext, useContext, use, Suspense } from "react"

/**
 * Partial prerendering (PPR) render context.
 *
 * Set by the server handler only on a PPR route:
 *   - phase "prerender": building the cached shell. Anything inside a PPR hole
 *     (PPRRouteBoundary / PPRDynamic) suspends forever and is postponed, so no
 *     request data can end up in the shell that is replayed to other users.
 *   - phase "resume": a real request. Holes render with this request's data.
 * On the classic streaming path and on the client the context is null.
 */
export const PPRRenderContext = createContext(null)

export function PPRRenderProvider({ value, children }) {
    return <PPRRenderContext.Provider value={value}>{children}</PPRRenderContext.Provider>
}

// A thenable that never settles. use() on it suspends; the prerender's abort
// signal then turns the suspended boundary into a postponed hole. Nothing is
// fetched while building the shell.
const NEVER = { then() {} }

/** "prerender" | "resume" | null (classic path or client) */
export const usePPRPhase = () => useContext(PPRRenderContext)?.phase ?? null

/** True only while the server builds the shared PPR shell. */
export const useIsPPRShell = () => usePPRPhase() === "prerender"

function DynamicGate({ children }) {
    const ctx = useContext(PPRRenderContext)
    if (ctx?.phase === "prerender") use(NEVER)
    return children
}

/**
 * Marks per-request content (CSRF tokens, user cookies, personalised scripts) so it is
 * never written into the shared shell. On a PPR request it is rendered per request
 * when the shell resumes; anywhere else it renders inline with no extra markup.
 * Use it outside the hydrated root (e.g. in the custom Document), or make sure the
 * client renders a Suspense boundary at the same position.
 */
export function PPRDynamic({ fallback = null, children }) {
    const ctx = useContext(PPRRenderContext)
    if (!ctx) return children
    return (
        <Suspense fallback={fallback}>
            <DynamicGate>{children}</DynamicGate>
        </Suspense>
    )
}

function RouteGate({ children }) {
    const ctx = useContext(PPRRenderContext)
    const routeData = use(ctx.phase === "prerender" ? NEVER : ctx.routeData)
    return children(routeData)
}

/**
 * Server-only: the hole that holds the whole app on a PPR route. The fallback is the
 * route's static skeleton (Component.pprFallback) and is what the shell shows; the app
 * renders when this request's App.serverSideFunction + serverFetcher data is ready.
 */
export function PPRRouteBoundary({ fallback = null, children }) {
    return (
        <Suspense fallback={fallback}>
            <RouteGate>{children}</RouteGate>
        </Suspense>
    )
}

/**
 * Client: wrap the hydrated root with this. A PPR response puts the app inside a Suspense
 * boundary (see PPRRouteBoundary), so the client tree needs one at the same position or
 * hydration mismatches. On a classic response it renders children as they are.
 */
export function PPRHydrationBoundary({ children }) {
    if (typeof window !== "undefined" && window.__CATALYST_PPR__ === true) {
        return <Suspense fallback={null}>{children}</Suspense>
    }
    return children
}

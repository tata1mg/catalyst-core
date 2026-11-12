import React, { Suspense, use, useContext, useEffect, useState } from "react"
import { SsrRequestContext } from "./SsrRequestContext.jsx"
import { PPRRenderContext } from "./PPR.jsx"

// A thenable that never settles: while a PPR shell is prerendered nothing is fetched, so the
// section is postponed with the rest of the app.
const NEVER = { then() {} }

function DeferredServer({ name, children }) {
    const { deferred, nonce } = useContext(SsrRequestContext) || {}
    const pprPhase = useContext(PPRRenderContext)?.phase
    if (pprPhase === "prerender") use(NEVER)

    const entry = deferred?.get(name)
    // Nothing was deferred under this name, or the request is blocking (the work was awaited
    // before rendering and its state is in window.__INITIAL_STATE__): plain content, no script.
    if (!entry || deferred.blocking) return children

    const { html } = use(entry.result)
    return (
        <>
            <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />
            {children}
        </>
    )
}

function DeferredClient({ name, children }) {
    // The server wrote a script before this section's content and it set this marker. The client
    // renders the same (empty) element at the same position so hydration matches; React never
    // runs it again. The marker is consumed once hydrated, so a later client-side visit renders
    // the content only.
    const [hasServerScript] = useState(() => Boolean(window.__CATALYST_DEFERRED__?.[name]))
    useEffect(() => {
        if (hasServerScript && window.__CATALYST_DEFERRED__) delete window.__CATALYST_DEFERRED__[name]
    }, [hasServerScript, name])

    return (
        <>
            {hasServerScript && <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: "" }} />}
            {children}
        </>
    )
}

/**
 * A section of the page that waits for work its route's serverFetcher handed to `defer(name, …)`.
 * The shell is sent with `fallback` in its place; the section streams into the same response
 * when the work settles. Without a matching defer() call (a client-side navigation, a blocking
 * request such as a bot) it renders its children as they are.
 *
 * @param {{ name: string, fallback?: React.ReactNode, children: React.ReactNode }} props
 */
export function Deferred({ name, fallback = null, children }) {
    const Section = typeof window === "undefined" ? DeferredServer : DeferredClient
    return (
        <Suspense fallback={fallback}>
            <Section name={name}>{children}</Section>
        </Suspense>
    )
}

export default Deferred

import React, { Suspense, use, useContext } from "react"
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

    // Built now, from the same store state this section's HTML is rendered from.
    const html = deferred.scriptFor(name, use(entry.result))
    return (
        <>
            <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />
            {children}
        </>
    )
}

const hasServerScript = (name) => {
    const markers = window.__CATALYST_DEFERRED__
    return Boolean(markers) && Object.prototype.hasOwnProperty.call(markers, name)
}

function DeferredClient({ name, children }) {
    // The server wrote a script before this section's content and it set this marker. The client
    // renders the same (empty) element at the same position so hydration matches; React never
    // runs it. The marker is kept: every section with this name (e.g. at different Suspense
    // depths) hydrates against it, and on a later client-side visit the empty script is inert.
    const withScript = hasServerScript(name)
    return (
        <>
            {withScript && <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: "" }} />}
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

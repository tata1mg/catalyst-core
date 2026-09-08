import React, { Suspense, lazy, useContext, useEffect, useId, useRef, useState } from "react"
import { SsrRequestContext } from "./SsrRequestContext.jsx"
import SplitInview from "./SplitInview.jsx"

// Collects one promise per SSR-rendered split() call on the client.
const prefetchPromises = []

/**
 * Resolves once every SSR-rendered split component has been prefetched into
 * its own module cache. No longer required before hydrateRoot: a boundary
 * that suspends before its chunk is ready falls back to its own captured SSR
 * markup (see htmlSnapshots below) instead of a spinner, so hydration can
 * start immediately. Kept for callers that want an explicit "fully loaded"
 * signal.
 */
export const hydrationReady = () => Promise.all(prefetchPromises)

// display:contents keeps this instrumentation span out of layout — its
// children are boxed exactly as if the span weren't there. It does still add
// a real DOM node, so any `.parent > .child` CSS selector spanning a split()
// boundary needs to become `.parent .child`.
const SPLIT_MARKER_STYLE = { display: "contents" }

// innerHTML of every SSR-rendered split() boundary, captured once up front,
// keyed by identityKey (see resolveIdentityKey below). Read synchronously
// before hydrateRoot runs, while the DOM still holds exactly what the server
// sent. Used so a boundary not yet worth hydrating shows its own real
// server-rendered markup as the Suspense fallback instead of a generic
// skeleton — no visual flash.
const htmlSnapshots = new Map()
if (typeof document !== "undefined") {
    document.querySelectorAll("[data-catalyst-split]").forEach((el) => {
        const key = el.getAttribute("data-catalyst-split")
        if (key) htmlSnapshots.set(key, el.innerHTML)
    })
}

// Identity used to match a boundary's server snapshot to this hydration
// attempt. cacheKey (auto-injected per import path by inject-cache-key-plugin
// — see that file) is preferred: it's fixed by *which module this call site
// imports*, so it survives any of this boundary's siblings changing shape
// or count between the server render and the client's first render. useId()
// is a positional fallback for the rare split() call without a cacheKey
// (e.g. a dynamic, non-statically-analyzable import) — it's the same
// mechanism split() always used, kept only where nothing better is
// available. Note this doesn't disambiguate multiple instances of the *same*
// split() call site (e.g. one rendered per item in a list): they'd share an
// identityKey and one snapshot would overwrite the other in the Map. That's
// a pre-existing limitation (useId() alone had the same issue for that
// pattern) — fixing it would need callers to pass a per-item key, which is
// a larger API change than today's scope. A shared mutable counter was
// considered and rejected: it would need to reset per SSR request, and
// nothing in this module can safely detect "new request" without leaking
// across concurrent requests on the same server process.
const resolveIdentityKey = (cacheKey, positionalId) => cacheKey || positionalId

const wrapWithMarker = (identityKey, node) => (
    <span data-catalyst-split={identityKey} style={SPLIT_MARKER_STYLE}>
        {node}
    </span>
)

// dangerouslySetInnerHTML is safe here: the markup is a byte-for-byte copy of
// what this same app already rendered and sent to this same browser —
// nothing new is introduced, it's only replayed until real hydration lands.
const resolveFallback = (identityKey, fallback) => {
    const html = htmlSnapshots.get(identityKey)
    if (html === undefined) return fallback
    return <span style={SPLIT_MARKER_STYLE} dangerouslySetInnerHTML={{ __html: html }} />
}

// One shared IntersectionObserver for every split() boundary's "worth
// hydrating yet?" check. A tight (0px) margin keeps eager hydration to the
// first fold; everything else stays inert, real, static markup until the
// user actually scrolls near it.
const foldVisibilityCallbacks = new Map()
let sharedObserver = null
// True once we've seen a real (non-hidden-tab) rootBounds reading. Its only
// job is telling the retry path (below) apart from the well-supported
// "background tab" case, so it's fine that it's shared across all targets.
let sawRealRootBounds = false
const getSharedObserver = () => {
    if (sharedObserver) return sharedObserver
    sharedObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                // rootBounds reads as zero while the document is hidden (a
                // background tab has no laid-out viewport) — confirmed
                // directly: document.hidden was true with
                // window.innerWidth/innerHeight both 0 in exactly this
                // situation. That's a normal, common state (any background
                // tab), not a bug, so retrying on a tight timer here would
                // burn CPU for as long as the tab stays backgrounded — often
                // the whole session. Instead, wait once for the tab to
                // become visible, then re-observe. A zero reading that's
                // *not* explained by document.hidden is the one genuinely
                // transient case (the browser hasn't finished establishing
                // the viewport yet, e.g. moments after navigation) — retry
                // that on the next frame, but only a few times, so a
                // persistent zero for some other reason can't spin forever.
                const bounds = entry.rootBounds
                const boundsInvalid = !bounds || (bounds.width === 0 && bounds.height === 0)
                if (boundsInvalid) {
                    const target = entry.target
                    if (document.hidden) {
                        const onVisible = () => {
                            if (document.hidden) return
                            document.removeEventListener("visibilitychange", onVisible)
                            if (foldVisibilityCallbacks.has(target)) {
                                sharedObserver.unobserve(target)
                                sharedObserver.observe(target)
                            }
                        }
                        document.addEventListener("visibilitychange", onVisible)
                    } else if (!sawRealRootBounds) {
                        const attempts = (target.__catalystVisibilityRetries || 0) + 1
                        target.__catalystVisibilityRetries = attempts
                        if (attempts <= 5) {
                            requestAnimationFrame(() => {
                                if (foldVisibilityCallbacks.has(target)) {
                                    sharedObserver.unobserve(target)
                                    sharedObserver.observe(target)
                                }
                            })
                        }
                    }
                    return
                }
                sawRealRootBounds = true
                if (entry.isIntersecting || entry.intersectionRatio > 0) {
                    const cb = foldVisibilityCallbacks.get(entry.target)
                    if (cb) {
                        cb()
                        foldVisibilityCallbacks.delete(entry.target)
                        sharedObserver.unobserve(entry.target)
                    }
                }
            })
        },
        { rootMargin: "0px" }
    )
    return sharedObserver
}

// display:contents elements generate no CSS box, so IntersectionObserver can
// never report one as intersecting (isIntersecting stays false forever, even
// though the callback does fire) — confirmed against a real browser, not
// just jsdom. The marker span is display:contents, and so is
// resolveFallback's own snapshot wrapper, so walk down through any chain of
// display:contents wrappers to find the first descendant that actually has
// layout geometry to observe.
const findObservableNode = (node) => {
    while (node) {
        if (typeof window === "undefined" || !window.getComputedStyle) return node
        if (window.getComputedStyle(node).display !== "contents") return node
        node = node.firstElementChild
    }
    return null
}

// Reports whether `ref`'s node has ever intersected the viewport. `skip`
// forces an immediate true — used for bots (no real viewport to wait on)
// and for boundaries with no snapshot to safely freeze on while waiting
// (see split()'s `hasSnapshot` below). `onFire` runs once, synchronously
// inside the effect that flips the state, so callers can resolve a
// companion Suspense gate (see SuspendUntilVisible below) from the same
// commit-phase callback rather than during render.
const useVisible = (ref, skip, onFire) => {
    const [isVisible, setIsVisible] = useState(() => {
        if (typeof window === "undefined") return true
        if (skip || !window.IntersectionObserver) return true
        return false
    })

    useEffect(() => {
        if (isVisible) return
        const node = findObservableNode(ref.current)
        if (!node) {
            // No boxed descendant found (e.g. empty content) — fail open
            // rather than suspend forever.
            setIsVisible(true)
            onFire?.()
            return
        }
        const fire = () => {
            setIsVisible(true)
            onFire?.()
        }
        foldVisibilityCallbacks.set(node, fire)
        getSharedObserver().observe(node)
        return () => {
            foldVisibilityCallbacks.delete(node)
            if (sharedObserver) sharedObserver.unobserve(node)
        }
    }, [isVisible])

    return isVisible
}

// Suspends by throwing its gate's promise — the same generic protocol
// React.lazy() itself uses. Rendered in place of the real component while a
// boundary waits for its visibility check, so the client tree's *shape*
// (span > Suspense > one child) always matches the server's, and a
// not-yet-visible boundary is hydrated via React's well-supported "suspended
// during hydration" recovery (scoped to this one boundary) rather than a
// structural mismatch that can bail out hydration for the whole root.
//
// Confirmed necessary, not just cautious: swapping this out for a plain,
// non-suspending "render the frozen span as Suspense's direct child" (no
// throw at all) was tried and produces a WORSE failure — React logs "the
// server rendered HTML didn't match the client... this tree will be
// regenerated on the client" and discards the whole boundary's subtree,
// wheras the suspended-during-hydration path recovers scoped to just this
// boundary. React treats "child suspended" as a well-supported hydration
// case; "child is a structurally different element" is not.
const SuspendUntilVisible = ({ promise }) => {
    throw promise
}

/**
 * Split component that wraps React's lazy and Suspense for SSR compatibility.
 * Used directly by split()'s server branch; also exported standalone for any
 * caller that wants ssr:false's original client-only-with-prefetch behavior
 * without going through split()'s always-SSR contract.
 * @param {Object} props
 * @param {boolean} props.ssr - Whether to render the component on the server
 * @param {React.ComponentType|React.ReactElement} props.fallback - Fallback component for loading state
 * @param {Function} props.children - Function that returns the lazy component import
 * @param {string} props.cacheKey - Resolved path for better asset tracking
 */
const Split = ({ ssr = true, fallback = null, cacheKey, instanceId, rootOptions, onVisible, children }) => {
    const isServer = typeof window === "undefined"
    if (isServer) {
        if (ssr) {
            if (global.__CHUNK_EXTRACTOR__) {
                global.__CHUNK_EXTRACTOR__.addComponent(cacheKey)
            }
            return wrapWithMarker(instanceId, <Suspense fallback={fallback}>{children}</Suspense>)
        }
        // Match SplitInview's client-side wrapper so hydration doesn't mismatch.
        // SplitInview renders <div ref>{fallback}</div> until visible; without this
        // wrap, server outputs `fallback` and client outputs `<div>{fallback}</div>`.
        return <div>{fallback}</div>
    }

    const boundary = (
        <SplitInview fallback={fallback} rootOptions={rootOptions} onVisible={onVisible}>
            <Suspense fallback={fallback}>{children}</Suspense>
        </SplitInview>
    )
    return ssr ? wrapWithMarker(instanceId, boundary) : boundary
}

/**
 * Every component created by split() renders for real on the server,
 * regardless of any `ssr` option in `options` — that option is accepted for
 * backward compatibility but no longer changes anything here. On the client,
 * the first-fold instance of each boundary hydrates immediately; everything
 * else keeps showing its own real, server-rendered markup (inert but
 * correct-looking, no generic skeleton) until it scrolls into view.
 */
export const split = (importFn, options = {}, thirdArg, fourthArg) => {
    const { fallback = null } = options || {}
    const hasThirdArg = typeof thirdArg !== "undefined"
    const hasFourthArg = typeof fourthArg !== "undefined"
    const cacheKey =
        typeof fourthArg === "string" ? fourthArg : typeof thirdArg === "string" ? thirdArg : undefined
    const rootOptions = hasFourthArg
        ? thirdArg
        : hasThirdArg && typeof thirdArg !== "string"
          ? thirdArg
          : undefined

    const LazyComponent = lazy(importFn)

    let loadInFlight = null
    let loadedModule = null

    // Tell client which components were SSR'd so split() can eagerly import
    // them (prevents Suspense fallback flash while the chunk downloads).
    if (typeof window !== "undefined" && window.__SSR_RENDERED_COMPONENTS__?.has(cacheKey)) {
        prefetchPromises.push(
            importFn().then((mod) => {
                loadedModule = mod
            })
        )
    }

    const wrapper = ({ fallback: fallbackProp, ...props }) => {
        const { isBot: isBotFromContext } = useContext(SsrRequestContext)
        const isBotFromWindow = typeof window !== "undefined" && window.__CATALYST_IS_BOT__ === true
        const isBot = Boolean(isBotFromContext || isBotFromWindow)
        const effectiveFallback = fallbackProp !== undefined ? fallbackProp : fallback

        const positionalId = useId()
        const identityKey = resolveIdentityKey(cacheKey, positionalId)
        const markerRef = useRef(null)

        const gateRef = useRef(null)
        if (!gateRef.current) {
            const gate = { resolved: false, promise: null, resolve: null }
            gate.promise = new Promise((res) => {
                gate.resolve = () => {
                    gate.resolved = true
                    res()
                }
            })
            gateRef.current = gate
        }

        // A missing snapshot means there's nothing safe to freeze this
        // boundary on while it waits — render it immediately instead of
        // risking getting stuck showing a bare fallback forever.
        const hasSnapshot = typeof window !== "undefined" && htmlSnapshots.has(identityKey)
        const isVisible = useVisible(markerRef, isBot || !hasSnapshot, gateRef.current.resolve)

        if (typeof window === "undefined") {
            if (global.__CHUNK_EXTRACTOR__) {
                global.__CHUNK_EXTRACTOR__.addComponent(cacheKey)
            }
            return wrapWithMarker(
                identityKey,
                <Suspense fallback={effectiveFallback}>
                    <LazyComponent {...props} />
                </Suspense>
            )
        }

        const boundaryFallback = resolveFallback(identityKey, effectiveFallback)
        return (
            <span ref={markerRef} data-catalyst-split={identityKey} style={SPLIT_MARKER_STYLE}>
                <Suspense fallback={boundaryFallback}>
                    {isVisible ? (
                        <LazyComponent {...props} />
                    ) : (
                        <SuspendUntilVisible promise={gateRef.current.promise} />
                    )}
                </Suspense>
            </span>
        )
    }

    wrapper.__cacheKey = cacheKey

    /** Same contract as loadable components: RouterDataProvider awaits this before reading serverFetcher/clientFetcher. */
    wrapper.load = () => {
        if (loadedModule) return Promise.resolve(loadedModule)
        if (!loadInFlight) {
            loadInFlight = importFn()
                .then((mod) => {
                    loadedModule = mod
                    loadInFlight = null
                    return mod
                })
                .catch((err) => {
                    loadInFlight = null
                    throw err
                })
        }
        return loadInFlight
    }

    return wrapper
}

export default Split

import React, { Suspense, lazy, useContext, useEffect, useId, useReducer, useRef, useState } from "react"
import { SsrRequestContext } from "./SsrRequestContext.jsx"
import SplitInview from "./SplitInview.jsx"

// Synchronous module cache: importFn → resolved module.
// Populated by the eager importFn().then() calls at split() invocation time.
const moduleCache = new Map()

// Collects one promise per SSR-rendered split() call on the client.
const prefetchPromises = []

/**
 * Resolves once every SSR-rendered split component has been prefetched into
 * moduleCache. No longer required before hydrateRoot: a boundary that
 * suspends before its chunk is ready falls back to its own captured SSR
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
// keyed by the boundary's useId()-derived instanceId (guaranteed to match
// between the server render and this hydration attempt, even when the same
// split() call site renders many times, e.g. inside a list). Read
// synchronously before hydrateRoot runs, while the DOM still holds exactly
// what the server sent. Used so a boundary that suspends during hydration
// (its chunk isn't loaded yet) shows its own real server-rendered markup as
// the Suspense fallback instead of a spinner — no visual flash.
const htmlSnapshots = new Map()
if (typeof document !== "undefined") {
    document.querySelectorAll("[data-catalyst-split]").forEach((el) => {
        const key = el.getAttribute("data-catalyst-split")
        if (key) htmlSnapshots.set(key, el.innerHTML)
    })
}

const wrapWithMarker = (instanceId, node) =>
    instanceId ? (
        <span data-catalyst-split={instanceId} style={SPLIT_MARKER_STYLE}>
            {node}
        </span>
    ) : (
        node
    )

// dangerouslySetInnerHTML is safe here: the markup is a byte-for-byte copy of
// what this same app already rendered and sent to this same browser —
// nothing new is introduced, it's only replayed until real hydration lands.
const resolveFallback = (instanceId, fallback) => {
    const html = instanceId && htmlSnapshots.get(instanceId)
    if (html === undefined) return fallback
    return <span style={SPLIT_MARKER_STYLE} dangerouslySetInnerHTML={{ __html: html }} />
}

// Shared IntersectionObserver gating which ssr:true boundaries actually mount
// their real, interactive tree on first render. Deliberately a *separate*
// observer from SplitInview's: SplitInview's 75%-below-viewport margin exists
// to prefetch ssr:false code ahead of scroll, which is unrelated to (and too
// generous for) this — every ssr:true boundary already has its real content
// on screen via SSR, so the only question here is how much of it we spend
// main-thread time making interactive on load. A tight (0px) margin keeps
// that to the first fold; everything else stays inert, real, static markup
// until the user actually scrolls near it.
const foldVisibilityCallbacks = new Map()
let sharedFoldVisibilityObserver = null
const getSharedFoldVisibilityObserver = () => {
    if (sharedFoldVisibilityObserver) return sharedFoldVisibilityObserver
    sharedFoldVisibilityObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting || entry.intersectionRatio > 0) {
                    const cb = foldVisibilityCallbacks.get(entry.target)
                    if (cb) {
                        cb()
                        foldVisibilityCallbacks.delete(entry.target)
                        sharedFoldVisibilityObserver.unobserve(entry.target)
                    }
                }
            })
        },
        { rootMargin: "0px" }
    )
    return sharedFoldVisibilityObserver
}

// Reports whether `ref`'s node has ever intersected the viewport. `skip`
// (bots — no real viewport to wait on) forces an immediate true. `onFire`
// runs once, synchronously inside the effect that flips the state, so callers
// can resolve a companion Suspense gate (see SuspendUntilVisible below) from
// the same commit-phase callback rather than during render.
const useFirstFoldVisible = (ref, skip, onFire) => {
    const [isVisible, setIsVisible] = useState(() => {
        if (typeof window === "undefined") return true
        if (skip || !window.IntersectionObserver) return true
        return false
    })

    useEffect(() => {
        if (isVisible) return
        const node = ref.current
        if (!node) return
        const fire = () => {
            setIsVisible(true)
            onFire?.()
        }
        foldVisibilityCallbacks.set(node, fire)
        getSharedFoldVisibilityObserver().observe(node)
        return () => {
            foldVisibilityCallbacks.delete(node)
            if (sharedFoldVisibilityObserver) sharedFoldVisibilityObserver.unobserve(node)
        }
    }, [isVisible])

    return isVisible
}

// Suspends by throwing its gate's promise — the same generic protocol
// React.lazy() itself uses. Rendered in place of the real component while a
// boundary waits for its first-fold visibility check, so the client tree's
// *shape* (span > Suspense > one child) always matches the server's, and a
// not-yet-visible boundary is hydrated via React's well-supported "suspended
// during hydration" recovery (scoped to this one boundary) rather than a
// structural mismatch that can bail out hydration for the whole root.
const SuspendUntilVisible = ({ promise }) => {
    throw promise
}

/**
 * Split component that wraps React's lazy and Suspense for SSR compatibility
 * @param {Object} props
 * @param {boolean} props.ssr - Whether to render the component on the server
 * @param {React.ComponentType|React.ReactElement} props.fallback - Fallback component for loading state
 * @param {Function} props.children - Function that returns the lazy component import
 * @param {string} props.cacheKey - Resolved path for better asset tracking
 */
const Split = ({
    ssr = true,
    fallback = null,
    cacheKey,
    instanceId,
    rootOptions,
    onVisible,
    skipVisibility,
    children,
    ...props
}) => {
    // Check if we're on the server
    const isServer = typeof window === "undefined"
    if (isServer) {
        if (ssr) {
            // On server with SSR enabled: actually load and render the component
            try {
                // Track this component for asset extraction
                if (global.__CHUNK_EXTRACTOR__) {
                    global.__CHUNK_EXTRACTOR__.addComponent(cacheKey)
                }

                return wrapWithMarker(instanceId, <Suspense fallback={fallback}>{children}</Suspense>)
            } catch (error) {
                console.warn("Error loading component for SSR:", error)
                return fallback
            }
        } else {
            // Match SplitInview's client-side wrapper so hydration doesn't mismatch.
            // SplitInview renders <div ref>{fallback}</div> until visible; without this
            // wrap, server outputs `fallback` and client outputs `<div>{fallback}</div>`.
            return <div>{fallback}</div>
        }
    } else {
        const boundaryFallback = resolveFallback(instanceId, fallback)
        const boundary = skipVisibility ? (
            <Suspense fallback={boundaryFallback}>{children}</Suspense>
        ) : (
            <SplitInview fallback={fallback} rootOptions={rootOptions} onVisible={onVisible}>
                <Suspense fallback={boundaryFallback}>{children}</Suspense>
            </SplitInview>
        )
        return ssr ? wrapWithMarker(instanceId, boundary) : boundary
    }
}

/**
 * Like {@link split}, but forces SSR when the request is a known Google crawler (same UA rules as Head).
 * Use for widgets that are `ssr: false` for humans but must be fully rendered for bots.
 *
 * Prefetch follows `window.__SSR_RENDERED_COMPONENTS__` only (not the `ssr` option) so bot-forced SSR
 * still hydrates without a Suspense flash.
 */
export const split = (importFn, options = {}, thirdArg, fourthArg) => {
    const { ssr = true, fallback = null, key } = options || {}
    const hasThirdArg = typeof thirdArg !== "undefined"
    const hasFourthArg = typeof fourthArg !== "undefined"
    const cacheKey =
        typeof fourthArg === "string" ? fourthArg : typeof thirdArg === "string" ? thirdArg : undefined
    const rootOptions = hasFourthArg
        ? thirdArg
        : hasThirdArg && typeof thirdArg !== "string"
          ? thirdArg
          : undefined

    if (typeof window !== "undefined" && window.__SSR_RENDERED_COMPONENTS__?.has(cacheKey)) {
        const prefetch = importFn().then((mod) => {
            moduleCache.set(importFn, mod)
        })
        prefetchPromises.push(prefetch)
    }

    const LazyComponent = lazy(importFn)
    let loadInFlight = null

    // Per-split instance subscribers. Pending wrapper instances register their
    // forceUpdate here; notifyAll() wakes them when load() resolves or any
    // sibling becomes visible, so they can re-render against the now-hot cache
    // or skip their own observer setup.
    const subscribers = new Set()
    let anyVisible = false
    const notifyAll = () => {
        anyVisible = true
        subscribers.forEach((fn) => fn())
    }

    const wrapper = ({ fallback: fallbackProp, ...props }) => {
        const { isBot: isBotFromContext } = useContext(SsrRequestContext)
        const isBotFromWindow = typeof window !== "undefined" && window.__CATALYST_IS_BOT__ === true
        const isBot = Boolean(isBotFromContext || isBotFromWindow)
        const effectiveSsr = ssr || isBot
        const effectiveFallback = fallbackProp !== undefined ? fallbackProp : fallback
        // Called in wrapper (not Split) so the id matches whichever branch below
        // actually renders — all of them must resolve to the same instanceId the
        // server used for this slot.
        const instanceId = useId()
        const markerRef = useRef(null)
        // Lazily-created Suspense gate for the ssr:true branch below: resolved
        // once this instance's first-fold visibility check fires. Created via
        // the ref-lazy-init pattern so it's stable across re-renders without
        // needing its own effect.
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
        // Only meaningful for the ssr:true branch below, but called unconditionally
        // (Rules of Hooks) — a no-op for ssr:false, since markerRef never attaches
        // to anything there.
        const isFirstFoldVisible = useFirstFoldVisible(markerRef, isBot, gateRef.current.resolve)

        const [, forceUpdate] = useReducer((x) => x + 1, 0)
        useEffect(() => {
            subscribers.add(forceUpdate)
            return () => {
                subscribers.delete(forceUpdate)
            }
        }, [])

        if (effectiveSsr) {
            if (typeof window === "undefined") {
                // Server: go through <Split> so ChunkExtractor tracking and the
                // SSR wrapWithMarker path run exactly as they always have.
                return (
                    <Split
                        ssr={true}
                        fallback={effectiveFallback}
                        cacheKey={cacheKey}
                        instanceId={instanceId}
                        rootOptions={rootOptions}
                        {...props}
                        isBot={isBot}
                    >
                        <LazyComponent {...props} />
                    </Split>
                )
            }

            // Client: the real, server-rendered content already sits in the DOM
            // (that's what SSR is for) — the only question is whether *this*
            // instance is worth spending main-thread time on to make interactive
            // right now. Only the first fold is: everything else keeps showing
            // its own captured snapshot, real and correct-looking but inert,
            // until the user actually scrolls near it (see useFirstFoldVisible).
            const boundaryFallback = resolveFallback(instanceId, effectiveFallback)
            return (
                <span ref={markerRef} data-catalyst-split={instanceId} style={SPLIT_MARKER_STYLE}>
                    <Suspense fallback={boundaryFallback}>
                        {isFirstFoldVisible ? (
                            <LazyComponent {...props} />
                        ) : (
                            <SuspendUntilVisible promise={gateRef.current.promise} />
                        )}
                    </Suspense>
                </span>
            )
        }

        const mod = moduleCache.get(importFn)
        if (mod) {
            const Component = mod.default || mod
            return (
                <Suspense fallback={effectiveFallback}>
                    <Component {...props} />
                </Suspense>
            )
        }

        return (
            <Split
                ssr={false}
                fallback={effectiveFallback}
                cacheKey={cacheKey}
                instanceId={instanceId}
                rootOptions={rootOptions}
                onVisible={() => {
                    notifyAll()
                    props.onVisible?.()
                }}
                skipVisibility={anyVisible}
                {...props}
                isBot={isBot}
            >
                <LazyComponent {...props} />
            </Split>
        )
    }

    wrapper.__cacheKey = cacheKey

    /** Same contract as loadable components: RouterDataProvider awaits this before reading serverFetcher/clientFetcher. */
    wrapper.load = () => {
        const cached = moduleCache.get(importFn)
        if (cached) return Promise.resolve(cached)
        if (!loadInFlight) {
            loadInFlight = importFn()
                .then((mod) => {
                    if (typeof window !== "undefined") {
                        moduleCache.set(importFn, mod)
                    }
                    loadInFlight = null
                    notifyAll()
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
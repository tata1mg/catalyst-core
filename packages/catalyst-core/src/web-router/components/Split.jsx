import React, { Suspense, lazy, useContext, useEffect, useId, useReducer } from "react"
import { SsrRequestContext } from "./SsrRequestContext.jsx"
import SplitInview from "./SplitInview.jsx"

// Synchronous module cache: importFn → resolved module.
// Populated by the eager importFn().then() calls at split() invocation time,
// and by wrapper.load(). Whenever an entry lands here, notifyAll() wakes any
// mounted instances so they re-render against the resolved module.
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
    const { ssr = true, fallback = null } = options || {}
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
    const copyRouteStatics = (mod) => {
        const Component = mod?.default || mod
        for (const key of ["clientFetcher", "serverFetcher", "setMetaData"]) {
            if (Component?.[key]) wrapper[key] = Component[key]
        }
        return mod
    }

    if (typeof window !== "undefined" && window.__SSR_RENDERED_COMPONENTS__?.has(cacheKey)) {
        const prefetch = importFn().then((mod) => {
            moduleCache.set(importFn, mod)
            copyRouteStatics(mod)
        })
        prefetchPromises.push(prefetch)
    }

    const wrapper = ({ fallback: fallbackProp, ...props }) => {
        const { isBot: isBotFromContext } = useContext(SsrRequestContext)
        const isBotFromWindow = typeof window !== "undefined" && window.__CATALYST_IS_BOT__ === true
        const isBot = Boolean(isBotFromContext || isBotFromWindow)
        const effectiveSsr = ssr || isBot
        const effectiveFallback = fallbackProp !== undefined ? fallbackProp : fallback
        // Called in wrapper (not Split) so the id matches whether this instance takes
        // the fast path below (module already cached) or renders <Split> instead —
        // both must resolve to the same instanceId as the server used for this slot.
        const instanceId = useId()

        const [, forceUpdate] = useReducer((x) => x + 1, 0)
        useEffect(() => {
            subscribers.add(forceUpdate)
            return () => {
                subscribers.delete(forceUpdate)
            }
        }, [])

        const mod = moduleCache.get(importFn)
        if (mod) {
            const Component = mod.default || mod
            const suspenseNode = (
                <Suspense fallback={resolveFallback(instanceId, effectiveFallback)}>
                    <Component {...props} />
                </Suspense>
            )
            return effectiveSsr ? wrapWithMarker(instanceId, suspenseNode) : suspenseNode
        }

        return (
            <Split
                ssr={effectiveSsr}
                fallback={effectiveFallback}
                cacheKey={cacheKey}
                instanceId={instanceId}
                rootOptions={rootOptions}
                onVisible={() => {
                    notifyAll()
                    props.onVisible?.()
                }}
                skipVisibility={effectiveSsr || anyVisible}
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
                    copyRouteStatics(mod)
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

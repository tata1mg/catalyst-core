import React, { Suspense, lazy, useContext, useEffect, useId, useMemo, useRef } from "react"
import { hydrateRoot } from "react-dom/client"
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
//
// A key seen on more than one element (e.g. the same split() call site
// rendered once per item in a .map() list — cacheKey is per *import path*,
// not per instance, see resolveIdentityKey below) is quarantined: deleted
// from the map entirely rather than left pointing at whichever instance's
// HTML happened to be captured last. Without this, every colliding instance
// would freeze on — and only ever show — that one instance's content until
// it individually hydrated: not a missing snapshot, visibly wrong content.
// Deleting the key makes hasSnapshot() false for all of them, which routes
// them through the existing "no snapshot → render for real immediately"
// path instead.
const htmlSnapshots = new Map()
if (typeof document !== "undefined") {
    const collidingKeys = new Set()
    document.querySelectorAll("[data-catalyst-split]").forEach((el) => {
        const key = el.getAttribute("data-catalyst-split")
        if (!key) return
        if (htmlSnapshots.has(key)) {
            collidingKeys.add(key)
            return
        }
        htmlSnapshots.set(key, el.innerHTML)
    })
    collidingKeys.forEach((key) => htmlSnapshots.delete(key))
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
// identityKey. That's a pre-existing limitation (useId() alone had the same
// issue for that pattern) — fixing it would need callers to pass a per-item
// key, which is a larger API change than today's scope. The snapshot capture
// above at least makes that collision fail safe (real immediate render)
// rather than silently wrong. A shared mutable counter was considered and
// rejected: it would need to reset per SSR request, and nothing in this
// module can safely detect "new request" without leaking across concurrent
// requests on the same server process.
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
// Bounded retries (via requestAnimationFrame) before giving up on getting a
// real rootBounds reading and just mounting for real. This used to branch on
// document.hidden — wait indefinitely for a visibilitychange event before
// retrying, on the assumption that zero rootBounds only ever happens on a
// genuinely backgrounded tab (confirmed once: document.hidden was true with
// window.innerWidth/innerHeight both 0 in that case). That assumption turned
// out to be false: confirmed directly (both in automated browser tooling and
// reported independently from a real, foregrounded browser) that
// document.hidden can read true while window.innerWidth/innerHeight are
// perfectly normal, non-zero values, and visibilitychange never fires
// because the tab never actually becomes hidden by any definition a user
// would recognize. Waiting on that event left every deferred boundary frozen
// permanently — worse than the CPU cost this was trying to avoid. A bounded
// retry (rAF is throttled/paused automatically on a truly backgrounded tab,
// so this doesn't burn CPU there either) that eventually fails open — mounts
// for real rather than waiting forever — is simpler and can't get stuck.
const MAX_VISIBILITY_RETRIES = 8
const getSharedObserver = () => {
    if (sharedObserver) return sharedObserver
    sharedObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                const fire = () => {
                    const cb = foldVisibilityCallbacks.get(entry.target)
                    if (cb) {
                        cb()
                        foldVisibilityCallbacks.delete(entry.target)
                        sharedObserver.unobserve(entry.target)
                    }
                }

                const bounds = entry.rootBounds
                const boundsInvalid = !bounds || (bounds.width === 0 && bounds.height === 0)
                if (boundsInvalid) {
                    const target = entry.target
                    const attempts = (target.__catalystVisibilityRetries || 0) + 1
                    target.__catalystVisibilityRetries = attempts
                    if (attempts <= MAX_VISIBILITY_RETRIES) {
                        requestAnimationFrame(() => {
                            if (foldVisibilityCallbacks.has(target)) {
                                sharedObserver.unobserve(target)
                                sharedObserver.observe(target)
                            }
                        })
                    } else {
                        // Retries exhausted without ever seeing real bounds —
                        // fail open rather than stay frozen forever.
                        fire()
                    }
                    return
                }

                if (entry.isIntersecting || entry.intersectionRatio > 0) {
                    fire()
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

// Thrown by PermanentlySuspended below. Never resolves, on purpose: a
// Suspense boundary whose child suspends on this promise is permanently
// "still hydrating" from React's point of view, and React never revisits it
// again (a suspended boundary only re-renders when its promise settles).
// That's exactly what we want for a not-yet-visible split() boundary — see
// PermanentlySuspended's own comment for why.
const NEVER_SETTLES = new Promise(() => {})

// Placeholder child for a not-yet-visible boundary. Rendered instead of the
// real LazyComponent so the boundary suspends immediately on its first
// client render, before it ever gets a chance to hydrate for real.
//
// This is deliberate, and depends on a specific, confirmed React behavior:
// when a Suspense boundary suspends *while attempting its first hydration
// pass* against real server-rendered DOM, React does not discard that DOM or
// swap in `fallback` — it leaves the server markup untouched and treats the
// boundary as "dehydrated", to be retried later if it's ever pinged. Since
// NEVER_SETTLES is never pinged, that boundary simply stays dehydrated
// forever: the real server HTML for this widget keeps showing, and this
// component/boundary is never re-rendered by React again.
//
// Confirmed by isolated testing NOT to use a per-visibility state flip
// instead (e.g. throwing a promise that resolves once IntersectionObserver
// fires, then having this same boundary swap to the real LazyComponent):
// that update — any update to a boundary that hasn't "finished hydrating" —
// makes React log "This Suspense boundary received an update before it
// finished hydrating" and forces an expensive hydration-abort-and-retry,
// measured at 900–1000+ wasted re-renders per boundary in isolated testing.
// On a real page with many split() boundaries, that's exactly what produced
// the "client is not hydrating" / "page is not interactive" symptoms this
// design went through several iterations to chase down.
//
// The actual transition to real, interactive content on visibility is done
// imperatively instead — see mountIsland in split() below — via a completely
// separate hydrateRoot() call directly on the marker DOM node, bypassing
// this (permanently suspended) outer boundary entirely rather than asking it
// to update.
const PermanentlySuspended = () => {
    throw NEVER_SETTLES
}

// An island's hydrateRoot() call creates a completely independent React fiber
// root. Nesting it inside the main app's DOM does NOT give it the main tree's
// React context — Redux's <Provider>, router context, theme, etc. all live
// on the main tree's fiber, not the DOM, so a bare island crashes the moment
// its component reads any of that (e.g. "Cannot destructure property 'store'
// of ... as it is null" from a connected/useSelector component). The app
// registers, once at bootstrap, how to wrap an island's real content with
// whatever context providers its component tree actually needs — same
// providers, same instances (e.g. the same Redux store) as the main tree.
let islandProviders = (children) => children
export const registerIslandProviders = (wrapChildren) => {
    islandProviders = wrapChildren
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
        const islandRootRef = useRef(null)

        // useLatest-style refs so the island (mounted imperatively, possibly
        // long after this render) picks up whatever props/fallback this
        // widget's parent most recently passed, not just the ones present
        // the first time this effect below ran.
        const latestPropsRef = useRef(props)
        latestPropsRef.current = props
        const latestFallbackRef = useRef(effectiveFallback)
        latestFallbackRef.current = effectiveFallback

        // A missing snapshot means there's nothing safe to freeze this
        // boundary on while it waits — render it for real immediately
        // instead of risking getting stuck showing a bare fallback forever.
        const hasSnapshot = typeof window !== "undefined" && htmlSnapshots.has(identityKey)
        const shouldDefer = typeof window !== "undefined" && !isBot && hasSnapshot && Boolean(window.IntersectionObserver)

        // Mounts the real, interactive widget once it's worth hydrating —
        // imperatively, via its own independent React root directly on the
        // marker DOM node, rather than by updating the outer (permanently
        // suspended) boundary. See PermanentlySuspended's comment for why
        // this has to be a separate root instead of a state update here.
        useEffect(() => {
            if (!shouldDefer) return
            if (islandRootRef.current) return

            const mountIsland = () => {
                if (islandRootRef.current) return
                islandRootRef.current = hydrateRoot(
                    markerRef.current,
                    islandProviders(
                        <Suspense fallback={latestFallbackRef.current}>
                            <LazyComponent {...latestPropsRef.current} />
                        </Suspense>
                    )
                )
            }

            const node = findObservableNode(markerRef.current)
            if (!node) {
                // No boxed descendant found (e.g. empty content) — fail open
                // rather than wait forever.
                mountIsland()
                return
            }
            foldVisibilityCallbacks.set(node, mountIsland)
            getSharedObserver().observe(node)
            return () => {
                foldVisibilityCallbacks.delete(node)
                if (sharedObserver) sharedObserver.unobserve(node)
            }
        }, [shouldDefer])

        // Dispose the island's own root on unmount so it doesn't leak (it's
        // a separate React root the outer tree doesn't know about and won't
        // clean up on its own).
        useEffect(() => {
            return () => {
                islandRootRef.current?.unmount()
            }
        }, [])

        // Memoized so this exact element is referentially stable across any
        // re-render of wrapper that isn't a change to shouldDefer/identityKey
        // (e.g. an unrelated ancestor re-rendering, a new `fallback` object
        // from the parent). That referential stability matters: without it,
        // a fresh element handed React's reconciler on every render reaches
        // this fiber as "an update" — and this boundary, by design, never
        // finishes hydrating (PermanentlySuspended's promise never
        // resolves), so it's the exact same "update reached a still-
        // dehydrated boundary" case that forces the hydration-abort-and-
        // retry storm described above. Deliberately excludes fallback from
        // its deps: when shouldDefer is true, hasSnapshot was true, so
        // resolveFallback always returns the frozen snapshot HTML and never
        // reads the fallback prop anyway.
        const deferredElement = useMemo(
            () => (
                <span ref={markerRef} data-catalyst-split={identityKey} style={SPLIT_MARKER_STYLE}>
                    <Suspense fallback={resolveFallback(identityKey, effectiveFallback)}>
                        <PermanentlySuspended />
                    </Suspense>
                </span>
            ),
            // eslint-disable-next-line react-hooks/exhaustive-deps
            [shouldDefer, identityKey]
        )

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

        if (!shouldDefer) {
            return wrapWithMarker(
                identityKey,
                <Suspense fallback={effectiveFallback}>
                    <LazyComponent {...props} />
                </Suspense>
            )
        }

        return deferredElement
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

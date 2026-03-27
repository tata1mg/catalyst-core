import React, { Suspense, lazy } from "react"

// Synchronous module cache: importFn → resolved module.
// Populated by the eager importFn().then() calls at split() invocation time.
// By the time window.load fires (when hydrateRoot runs), all chunk <script>
// tags in the HTML have already executed, so every .then() has already
// resolved and the module is available here synchronously.
const moduleCache = new Map()

// Collects one promise per SSR-rendered split() call on the client.
// loadableReady() waits for all of them before hydration begins.
const prefetchPromises = []

/**
 * Returns a promise that resolves once every SSR-rendered split component
 * has been prefetched and stored in moduleCache.  Call this before
 * hydrateRoot so the first render has all modules available synchronously
 * and no Suspense fallback is shown.
 *
 * @example
 * hydrationReady().then(() => {
 *   hydrateRoot(document.getElementById("root"), <App />)
 * })
 */
export const hydrationReady = () => Promise.all(prefetchPromises)

/**
 * Split component that wraps React's lazy and Suspense for SSR compatibility
 * @param {Object} props
 * @param {boolean} props.ssr - Whether to render the component on the server
 * @param {React.ComponentType|React.ReactElement} props.fallback - Fallback component for loading state
 * @param {Function} props.children - Function that returns the lazy component import
 * @param {string} props.cacheKey - Resolved path for better asset tracking
 */
const Split = ({ ssr = true, fallback = null, cacheKey, children, ...props }) => {
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

                return <Suspense fallback={fallback}>{children}</Suspense>
            } catch (error) {
                console.warn("Error loading component for SSR:", error)
                return fallback
            }
        } else {
            // On server with SSR disabled: return fallback, don't track
            return fallback
        }
    } else {
        return <Suspense fallback={fallback}>{children}</Suspense>
    }
}

/**
 * Higher-order function to create a split component
 * @param {Function} importFn - Function that returns a dynamic import
 * @param {Object} options - Configuration options
 * @param {boolean} options.ssr - Whether to enable SSR for this component
 * @param {React.ComponentType|React.ReactElement} options.fallback - Fallback component
 * @param {string} cacheKey - Resolved path for better asset tracking (injected by plugin)
 */
export const split = (importFn, { ssr = true, fallback = null, key } = {}, cacheKey) => {
    if (ssr && typeof window !== "undefined" && window.__SSR_RENDERED_COMPONENTS__?.has(cacheKey)) {
        // Only eagerly re-import modules that were actually rendered on the server.
        // The server injects window.__SSR_RENDERED_COMPONENTS__ (a Set of cacheKeys)
        // as a plain inline <script> so it is available before any deferred module
        // scripts run.  Limiting eager loading to this set avoids fetching chunks
        // for ssr:true components that were not part of the current server response.
        const prefetch = importFn().then((mod) => {
            moduleCache.set(importFn, mod)
        })
        prefetchPromises.push(prefetch)
    }

    const LazyComponent = lazy(importFn)

    const wrapper = (props) => {
        // On the client, for SSR-enabled components, check if the module has
        // already resolved into moduleCache.  If it has, render the real
        // component directly — bypassing React.lazy entirely.
        //
        // React.lazy ALWAYS suspends on the very first render because
        // import() returns a new Promise and its .then() is only fired as a
        // microtask (never in the same synchronous render tick).  If we don't
        // bypass it here, the Suspense fallback (e.g. HomeSkeleton) is briefly
        // shown even though the server already rendered the full component,
        // causing a visible flash and a hydration mismatch.
        const mod = moduleCache.get(importFn)
        if (mod) {
            const Component = mod.default || mod
            return <Component {...props} />
        }

        return (
            <Split ssr={ssr} fallback={fallback} cacheKey={cacheKey} {...props}>
                <LazyComponent {...props} />
            </Split>
        )
    }

    // Expose cacheKey so preloadRouteCss() can read it directly from the route's
    // component reference — no manual cacheKey config needed on route objects.
    wrapper.__cacheKey = cacheKey

    return wrapper
}

export default Split

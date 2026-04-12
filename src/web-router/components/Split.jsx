import React, { Suspense, lazy, useContext } from "react"
import { SsrRequestContext } from "./SsrRequestContext.jsx"
import SplitInview from "./SplitInview.jsx"

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
        return (
            <SplitInview fallback={fallback}>
                <Suspense fallback={fallback}>{children}</Suspense>
            </SplitInview>
        )
    }
}

/**
 * Like {@link split}, but forces SSR when the request is a known Google crawler (same UA rules as Head).
 * Use for widgets that are `ssr: false` for humans but must be fully rendered for bots.
 *
 * Prefetch follows `window.__SSR_RENDERED_COMPONENTS__` only (not the `ssr` option) so bot-forced SSR
 * still hydrates without a Suspense flash.
 */
export const split = (importFn, { ssr = true, fallback = null, key } = {}, cacheKey) => {
    if (typeof window !== "undefined" && window.__SSR_RENDERED_COMPONENTS__?.has(cacheKey)) {
        const prefetch = importFn().then((mod) => {
            moduleCache.set(importFn, mod)
        })
        prefetchPromises.push(prefetch)
    }

    const LazyComponent = lazy(importFn)
    let loadInFlight = null

    const wrapper = (props) => {
        const { isBot: isBotFromContext } = useContext(SsrRequestContext)
        const isBotFromWindow = typeof window !== "undefined" && window.__CATALYST_IS_BOT__ === true
        const isBot = Boolean(isBotFromContext || isBotFromWindow)
        const effectiveSsr = ssr || isBot

        const mod = moduleCache.get(importFn)
        if (mod) {
            const Component = mod.default || mod
            return <Component {...props} />
        }

        return (
            <Split ssr={effectiveSsr} fallback={fallback} cacheKey={cacheKey} {...props} isBot={isBot}>
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

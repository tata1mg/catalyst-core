import React, { Suspense, lazy, useContext, useEffect, useReducer } from "react"
import { SsrRequestContext } from "./SsrRequestContext.jsx"
import SplitInview from "./SplitInview.jsx"

/**
 * A dynamic import of a module whose default export is the component to split.
 * Matches the argument React's `lazy` accepts.
 */
export type SplitImportFn = () => Promise<any>

/**
 * Options accepted by {@link split}.
 */
export interface SplitOptions {
    /** Render the component on the server. Defaults to true. Forced on for known crawlers. */
    ssr?: boolean
    /** Element shown while the chunk loads. Defaults to null. */
    fallback?: any
    /** IntersectionObserver options for in-view loading (documented; consumed positionally). */
    rootOptions?: any
    /** Callback fired when the component becomes visible (documented; consumed via props). */
    onVisible?: any
}

/**
 * The component returned by {@link split}. It renders the lazily imported
 * component and additionally carries the route statics copied off the loaded
 * module, plus `load()` for the fetcher contract RouterDataProvider relies on.
 */
export interface SplitComponent {
    (props: any): any
    /** Resolves the underlying module, reusing the in-flight or cached import. */
    load: () => Promise<any>
    /** Resolved path recorded for SSR asset tracking. */
    __cacheKey?: string
    clientFetcher?: any
    serverFetcher?: any
    setMetaData?: any
}

// Synchronous module cache: importFn → resolved module.
// Populated by the eager importFn().then() calls at split() invocation time.
// By the time window.load fires (when hydrateRoot runs), all chunk <script>
// tags in the HTML have already executed, so every .then() has already
// resolved and the module is available here synchronously.
const moduleCache = new Map<SplitImportFn, any>()

// Collects one promise per SSR-rendered split() call on the client.
// loadableReady() waits for all of them before hydration begins.
const prefetchPromises: Promise<any>[] = []

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
export const hydrationReady = (): Promise<any[]> => Promise.all(prefetchPromises)

/**
 * Props for the internal Split wrapper. `split()` is the public entry point;
 * this component is an implementation detail of it.
 */
interface SplitProps {
    /** Whether to render the component on the server */
    ssr?: boolean
    /** Fallback component for loading state */
    fallback?: any
    /** Resolved path for better asset tracking */
    cacheKey?: string
    rootOptions?: any
    onVisible?: () => void
    skipVisibility?: boolean
    children?: any
}

/**
 * Split component that wraps React's lazy and Suspense for SSR compatibility
 */
const Split = ({
    ssr = true,
    fallback = null,
    cacheKey,
    rootOptions,
    onVisible,
    skipVisibility,
    children,
}: SplitProps) => {
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
            // Match SplitInview's client-side wrapper so hydration doesn't mismatch.
            // SplitInview renders <div ref>{fallback}</div> until visible; without this
            // wrap, server outputs `fallback` and client outputs `<div>{fallback}</div>`.
            return <div>{fallback}</div>
        }
    } else {
        if (skipVisibility) {
            return <Suspense fallback={fallback}>{children}</Suspense>
        }
        return (
            <SplitInview fallback={fallback} rootOptions={rootOptions} onVisible={onVisible}>
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
export const split = (
    importFn: SplitImportFn,
    options: SplitOptions = {},
    thirdArg?: any,
    fourthArg?: any
): SplitComponent => {
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
    let loadInFlight: Promise<any> | null = null

    // Per-split instance subscribers. Pending wrapper instances register their
    // forceUpdate here; notifyAll() wakes them when load() resolves or any
    // sibling becomes visible, so they can re-render against the now-hot cache
    // or skip their own observer setup.
    const subscribers = new Set<() => void>()
    let anyVisible = false
    const notifyAll = () => {
        anyVisible = true
        subscribers.forEach((fn) => fn())
    }
    const copyRouteStatics = (mod: any) => {
        const Component = mod?.default || mod
        for (const key of ["clientFetcher", "serverFetcher", "setMetaData"]) {
            if (Component?.[key]) wrapper[key] = Component[key]
        }
        return mod
    }

    if (typeof window !== "undefined" && window.__SSR_RENDERED_COMPONENTS__?.has(cacheKey)) {
        const prefetch = importFn().then((mod: any) => {
            moduleCache.set(importFn, mod)
            copyRouteStatics(mod)
        })
        prefetchPromises.push(prefetch)
    }

    const wrapper: SplitComponent = ({ fallback: fallbackProp, ...props }: any) => {
        const { isBot: isBotFromContext } = useContext(SsrRequestContext)
        const isBotFromWindow = typeof window !== "undefined" && window.__CATALYST_IS_BOT__ === true
        const isBot = Boolean(isBotFromContext || isBotFromWindow)
        const effectiveSsr = ssr || isBot
        const effectiveFallback = fallbackProp !== undefined ? fallbackProp : fallback

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
            return (
                <Suspense fallback={effectiveFallback}>
                    <Component {...props} />
                </Suspense>
            )
        }

        return (
            <Split
                ssr={effectiveSsr}
                fallback={effectiveFallback}
                cacheKey={cacheKey}
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
                .then((mod: any) => {
                    copyRouteStatics(mod)
                    if (typeof window !== "undefined") {
                        moduleCache.set(importFn, mod)
                    }
                    loadInFlight = null
                    notifyAll()
                    return mod
                })
                .catch((err: any) => {
                    loadInFlight = null
                    throw err
                })
        }
        return loadInFlight
    }

    return wrapper
}

export default Split

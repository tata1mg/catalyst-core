import React, { createContext, useContext, use, useMemo } from "react"
import { PPRRenderContext } from "./PPR.jsx"

interface RequestCache {
    promises: Map<string, any>
    data: Map<string, any>
}

interface PPRDataContextValue {
    phase?: "prerender" | "resume"
    cacheKey?: string
    cache?: RequestCache
}

/**
 * usePPRRouteData(fetcher): read route data inside a PPR hole with React's use().
 *
 * Server: the promise and its result are stored per request (in the PPRDataProvider value
 * the handler creates for each render), never in module state, so concurrent requests to
 * the same route cannot read each other's data. While the shell is prerendered the hook
 * suspends without calling the fetcher, so no request data reaches the cached shell.
 *
 * Client: results the server sent in window.cachedData seed a module cache keyed by
 * pathname, so hydration reads the same data the server rendered without refetching.
 */
export const PPRDataContext = createContext<PPRDataContextValue | null>(null)

const NEVER: any = { then() {} }

const createRequestCache = (): RequestCache => ({ promises: new Map(), data: new Map() })

// Client-side cache only (one user per page). Bounded so long sessions don't grow it.
const CLIENT_CACHE_MAX = 100
const clientCache = createRequestCache()
const remember = (map: Map<string, any>, key: string, value: any) => {
    map.delete(key)
    map.set(key, value)
    if (map.size > CLIENT_CACHE_MAX) map.delete(map.keys().next().value)
}

function getSuspensePromise(cache: RequestCache, fetcher: () => any, cacheKey: string) {
    const existing = cache.promises.get(cacheKey)
    if (existing) return existing

    const w: any = typeof window !== "undefined" ? window : null
    if (w && w.cachedData && w.cachedData[cacheKey] !== undefined) {
        const value = w.cachedData[cacheKey]
        delete w.cachedData[cacheKey]
        const resolved: any = Promise.resolve(value)
        // React reads these to return synchronously during hydration.
        resolved.status = "fulfilled"
        resolved.value = value
        remember(cache.promises, cacheKey, resolved)
        remember(cache.data, cacheKey, value)
        return resolved
    }

    const promise = Promise.resolve()
        .then(fetcher)
        .then((value) => {
            remember(cache.data, cacheKey, value)
            return value
        })
    remember(cache.promises, cacheKey, promise)
    return promise
}

/** Server: one cache per request. The handler creates it so it can read the results afterwards. */
export const createPPRRequestCache = createRequestCache

export function PPRDataProvider({
    phase,
    cacheKey,
    cache,
    children,
}: {
    phase?: "prerender" | "resume"
    cacheKey?: string
    cache?: RequestCache
    children?: any
}) {
    const ownCache = useMemo(createRequestCache, [])
    const value = useMemo(
        () => ({ phase, cacheKey, cache: cache || ownCache }),
        [phase, cacheKey, cache, ownCache]
    )
    return <PPRDataContext.Provider value={value}>{children}</PPRDataContext.Provider>
}

export function usePPRRouteData<T = any>(fetcher: () => T | Promise<T>): T {
    const ctx = useContext(PPRDataContext)
    const renderPhase = useContext(PPRRenderContext)?.phase ?? ctx?.phase
    const isServer = typeof window === "undefined"
    const cacheKey = ctx?.cacheKey ?? (isServer ? "/" : window.location.pathname)
    const cache = isServer ? ctx?.cache : clientCache

    const promise = useMemo((): Promise<T> => {
        if (renderPhase === "prerender") return NEVER
        if (!cache) {
            // Server render without a provider: no shared cache, fetch for this render only.
            return Promise.resolve().then(fetcher)
        }
        return getSuspensePromise(cache, fetcher, cacheKey)
    }, [fetcher, cacheKey, cache, renderPhase])

    return use(promise)
}

/** Server: data this request's usePPRRouteData calls resolved, for window.cachedData. */
export function getRequestCachedData(requestCache: RequestCache | undefined, cacheKey: string) {
    return requestCache?.data.get(cacheKey)
}

/** Client: drop cached route data (e.g. after a mutation). */
export function clearPPRCache() {
    clientCache.promises.clear()
    clientCache.data.clear()
}

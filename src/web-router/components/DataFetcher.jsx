import React, { createContext, useContext, use, useMemo } from "react"
import { PPRRenderContext } from "./PPR.jsx"

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
export const PPRDataContext = createContext(null)

const NEVER = { then() {} }

const createRequestCache = () => ({ promises: new Map(), data: new Map() })

// Client-side cache only (one user per page). Bounded so long sessions don't grow it.
const CLIENT_CACHE_MAX = 100
const clientCache = createRequestCache()
const remember = (map, key, value) => {
    map.delete(key)
    map.set(key, value)
    if (map.size > CLIENT_CACHE_MAX) map.delete(map.keys().next().value)
}

function getSuspensePromise(cache, fetcher, cacheKey) {
    const existing = cache.promises.get(cacheKey)
    if (existing) return existing

    if (typeof window !== "undefined" && window.cachedData && window.cachedData[cacheKey] !== undefined) {
        const value = window.cachedData[cacheKey]
        delete window.cachedData[cacheKey]
        const resolved = Promise.resolve(value)
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

export function PPRDataProvider({ phase, cacheKey, cache, children }) {
    const ownCache = useMemo(createRequestCache, [])
    const value = useMemo(
        () => ({ phase, cacheKey, cache: cache || ownCache }),
        [phase, cacheKey, cache, ownCache]
    )
    return <PPRDataContext.Provider value={value}>{children}</PPRDataContext.Provider>
}

export function usePPRRouteData(fetcher) {
    const ctx = useContext(PPRDataContext)
    const renderPhase = useContext(PPRRenderContext)?.phase ?? ctx?.phase
    const isServer = typeof window === "undefined"
    const cacheKey = ctx?.cacheKey ?? (isServer ? "/" : window.location.pathname)
    const cache = isServer ? ctx?.cache : clientCache

    const promise = useMemo(() => {
        if (renderPhase === "prerender") return NEVER
        if (!cache) {
            // Server render without a provider: no shared cache, fetch for this render only.
            return Promise.resolve().then(fetcher)
        }
        return getSuspensePromise(cache, fetcher, cacheKey)
    }, [fetcher, cacheKey, cache, renderPhase])

    return use(promise)
}

/**
 * Kept for compatibility with the first PPR API. The handler now cuts the shell itself
 * (it aborts the prerender once the static parts are done), so this is a pass-through.
 */
export function DynamicDataProvider({ children }) {
    return children
}

/** Server: data this request's usePPRRouteData calls resolved, for window.cachedData. */
export function getRequestCachedData(requestCache, cacheKey) {
    return requestCache?.data.get(cacheKey)
}

/** Client: drop cached route data (e.g. after a mutation). */
export function clearPPRCache() {
    clientCache.promises.clear()
    clientCache.data.clear()
}

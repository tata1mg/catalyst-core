import React, { createContext, useContext, use, Suspense, useMemo } from "react"
import { useLocation, UNSAFE_RouteContext, matchRoutes } from "react-router-dom"

/**
 * Context for PPR data promises
 * Stores promises (not resolved data) for lazy consumption via use()
 */
export const PPRDataContext = createContext(null)

/**
 * LRU Cache for data promises
 * Prevents unbounded memory growth by evicting oldest entries
 */
class LRUCache {
    constructor(maxSize = 100) {
        this.cache = new Map()
        this.maxSize = maxSize
    }

    has(key) {
        return this.cache.has(key)
    }

    get(key) {
        const value = this.cache.get(key)
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key)
            this.cache.set(key, value)
        }
        return value
    }

    set(key, value) {
        // If key exists, delete it first (to update position)
        if (this.cache.has(key)) {
            this.cache.delete(key)
        }
        // Evict oldest if at capacity
        else if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value
            this.cache.delete(oldestKey)
        }
        this.cache.set(key, value)
    }

    getData() {
        return this.cache
    }

    clear() {
        this.cache.clear()
    }

    get size() {
        return this.cache.size
    }
}

// Global LRU cache with max 100 entries
const promiseCache = new LRUCache(100)
const dataCache = new LRUCache(100)

/**
 * Creates a suspense-compatible promise wrapper
 * React's use() hook requires a specific promise structure
 */
function createSuspensePromise(promiseFn, cacheKey) {
    // Check cache first
    if (promiseCache.has(cacheKey)) {
        const promise = promiseCache.get(cacheKey)
        return promise
    }

    // Check window.cachedData for server-sent data (client-side only)
    if (typeof window !== "undefined" && window.cachedData) {
        const cachedData = window.cachedData[cacheKey]
        if (cachedData !== undefined) {
            // Create a resolved promise with the cached data
            const resolvedPromise = Promise.resolve(cachedData)

            // Cache it in dataCache for future use
            dataCache.set(cacheKey, cachedData)

            // Attach status for synchronous checking
            resolvedPromise._status = () => "fulfilled"
            resolvedPromise._result = () => cachedData

            // Cache the promise
            promiseCache.set(cacheKey, resolvedPromise)

            // Clean up: remove from window.cachedData to prevent memory leaks
            // delete window.cachedData[cacheKey]

            return resolvedPromise
        }
    }

    let status = "pending"
    let result

    const promise = promiseFn().then(
        (data) => {
            dataCache.set(cacheKey, data)

            status = "fulfilled"
            result = data
            return data
        },
        (error) => {
            dataCache.set(cacheKey, error)

            status = "rejected"
            result = error
            throw error
        }
    )

    // Attach status for synchronous checking
    promise._status = () => status
    promise._result = () => result

    promiseCache.set(cacheKey, promise)

    return promise
}

export function PPRDataProvider({ phase, controller, cacheKey, children }) {
    return (
        <PPRDataContext.Provider value={{ phase, controller, cacheKey }}>{children}</PPRDataContext.Provider>
    )
}

export function usePPRRouteData(promise) {
    const context = useContext(PPRDataContext)
    const phase = context?.phase
    const cacheKey = context?.cacheKey ?? (typeof window !== "undefined" ? window.location.pathname : "/")

    const dataPromise = useMemo(() => createSuspensePromise(promise, cacheKey), [promise, cacheKey])

    // use() reads the promise - suspends if pending, returns data if resolved
    const result = use(dataPromise)
    return result
}

export function DynamicDataProvider({ children }) {
    const context = useContext(PPRDataContext)
    const controller = context?.controller
    const phase = context?.phase
    if (phase === "prerender" && controller) {
        setTimeout(() => controller.abort())
    }
    return children
}

export function getCachedData(cacheKey) {
    return dataCache.get(cacheKey)
}
/**
 * Clear the promise cache (useful for testing or manual invalidation)
 */
export function clearPPRCache() {
    promiseCache.clear()
}

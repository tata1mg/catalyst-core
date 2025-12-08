import React, { createContext, useContext, use, Suspense } from "react"
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
class LRUPromiseCache {
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

    clear() {
        this.cache.clear()
    }

    get size() {
        return this.cache.size
    }
}

// Global LRU cache with max 100 entries
const promiseCache = new LRUPromiseCache(100)

/**
 * Creates a suspense-compatible promise wrapper
 * React's use() hook requires a specific promise structure
 */
function createSuspensePromise(promiseFn, cacheKey) {
    // Check cache first
    if (promiseCache.has(cacheKey)) {
        const promise = promiseCache.get(cacheKey)
        console.log(`[PPR]   ⚡ Cache Hit - Sent cached promise`, cacheKey)
        return promise
    }

    let status = "pending"
    let result

    const promise = promiseFn().then(
        (data) => {
            status = "fulfilled"
            result = data
            return data
        },
        (error) => {
            status = "rejected"
            result = error
            throw error
        }
    )

    // Attach status for synchronous checking
    promise._status = () => status
    promise._result = () => result

    promiseCache.set(cacheKey, promise)
    console.log(`[PPR]   ⚡ Cache MISS - Created new promise`, cacheKey)
    return promise
}

export function PPRDataProvider({ phase, children }) {
    return <PPRDataContext.Provider value={phase}>{children}</PPRDataContext.Provider>
}

export function usePPRRouteData(promise, cacheKey) {
    const phase = useContext(PPRDataContext)
    console.log(`[PPR]   ⚡ Phase: ${phase}`)

    const dataPromise = createSuspensePromise(promise, cacheKey)

    // use() reads the promise - suspends if pending, returns data if resolved
    const result = use(dataPromise)
    return result
}

/**
 * Clear the promise cache (useful for testing or manual invalidation)
 */
export function clearPPRCache() {
    promiseCache.clear()
}

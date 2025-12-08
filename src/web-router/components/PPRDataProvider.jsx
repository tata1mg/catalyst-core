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
        return promiseCache.get(cacheKey)
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
    return promise
}

/**
 * Generates route key for caching
 */
const generateRouteKey = (match, searchParamsString = "") => {
    const { pathname, route } = match
    if (route.children) {
        return `index${pathname}${searchParamsString}`
    }
    return `${pathname}${searchParamsString}`
}

/**
 * Creates data fetching promises for matched routes WITHOUT awaiting them
 * This is the key difference from serverDataFetcher - we return promises, not resolved data
 *
 * @param {object} serverFetchDataProps - Server fetch configuration
 * @param {object} fetcherArgs - Arguments passed to fetchers
 * @returns {object} Map of route keys to promises
 */
export const createPPRDataPromises = (serverFetchDataProps, fetcherArgs) => {
    const dataPromises = {}
    const { routes, url, req, res: responseInstance } = serverFetchDataProps
    const matchedRoutes = matchRoutes(routes, url)

    if (matchedRoutes) {
        const searchParams = req.query || {}
        const params = matchedRoutes[matchedRoutes.length - 1]?.params || {}

        let searchParamsString = ""
        if (searchParams) {
            for (const key in searchParams) {
                searchParamsString += `${key}=${searchParams[key]}&`
            }
            searchParamsString = searchParamsString.slice(0, -1)
            searchParamsString = searchParamsString ? `?${searchParamsString}` : searchParamsString
        }

        matchedRoutes.forEach((match) => {
            const route = match.route
            const routeKey = generateRouteKey(match, searchParamsString)
            const component = route.component || route.Component || route.element

            // Get the server fetcher
            const fetcher = component?.serverFetcher

            if (fetcher && typeof fetcher === "function") {
                // Create promise but DON'T await it
                const promiseFn = async () => {
                    try {
                        const data = await fetcher(
                            { req, res: responseInstance, route, params, searchParams },
                            fetcherArgs
                        )
                        return {
                            data,
                            error: null,
                            isFetching: false,
                            isFetched: true,
                        }
                    } catch (error) {
                        return {
                            data: null,
                            error,
                            isFetching: false,
                            isFetched: true,
                        }
                    }
                }

                // Create suspense-compatible promise
                dataPromises[routeKey] = createSuspensePromise(promiseFn, `${url}-${routeKey}`)
            }
        })
    }

    return dataPromises
}

/**
 * PPR Data Provider Component
 * Provides data promises to child components for lazy consumption via use()
 *
 * @param {object} props
 * @param {object} props.dataPromises - Map of route keys to data promises
 * @param {React.ReactNode} props.children - Child components
 */
export function PPRDataProvider({ dataPromises, children }) {
    return <PPRDataContext.Provider value={dataPromises}>{children}</PPRDataContext.Provider>
}

/**
 * Hook to get current route's data using React 19's use() hook
 *
 * Uses React's use() to read the data promise.
 * If promise is pending, the component suspends (handled by Suspense boundary).
 * If promise is resolved, returns the data immediately.
 *
 * @returns {object} Route data { data, error, isFetching, isFetched }
 */
export function usePPRRouteData() {
    const dataPromises = useContext(PPRDataContext)
    const routeContext = useContext(UNSAFE_RouteContext)
    const location = useLocation()

    if (!dataPromises) {
        // Fallback for non-PPR mode
        return {
            data: null,
            error: null,
            isFetching: false,
            isFetched: false,
        }
    }

    // Get current route match
    const currentMatch = routeContext.matches[routeContext.matches.length - 1]
    const routeKey = generateRouteKey(currentMatch, location.search)

    const promise = dataPromises[routeKey]

    if (!promise) {
        // No fetcher for this route
        return {
            data: null,
            error: null,
            isFetching: false,
            isFetched: false,
            fetcherNotAvailable: true,
        }
    }

    // use() reads the promise - suspends if pending, returns data if resolved
    const result = use(promise)
    return result
}

/**
 * Hook to get all route data promises
 * Useful for debugging or advanced use cases
 */
export function usePPRDataPromises() {
    return useContext(PPRDataContext)
}

/**
 * Clear the promise cache (useful for testing or manual invalidation)
 */
export function clearPPRCache() {
    promiseCache.clear()
}

/**
 * Unified hook that works for both PPR and non-PPR modes
 * - In PPR mode: Uses use() hook with promises, suspends if data not ready
 * - In non-PPR mode: Falls back to RouterContext for pre-fetched data
 *
 * @returns {object} Route data { data, error, isFetching, isFetched }
 */
export function useUnifiedRouteData() {
    const pprDataPromises = useContext(PPRDataContext)

    // If PPR data context is available, use PPR mode
    if (pprDataPromises) {
        return usePPRRouteData()
    }

    // Otherwise, return empty state (RouterDataProvider handles non-PPR)
    return {
        data: null,
        error: null,
        isFetching: false,
        isFetched: false,
        mode: "ssr",
    }
}

/**
 * PPR Boundary Component
 * Wraps dynamic content in a Suspense boundary for PPR streaming.
 * During prerender, content inside will be "postponed" and streamed later.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Dynamic content that may suspend
 * @param {React.ReactNode} props.fallback - Loading fallback shown during suspension
 * @param {string} props.id - Optional identifier for debugging
 */
export function PPRBoundary({ children, fallback = null, id }) {
    return <Suspense fallback={fallback}>{children}</Suspense>
}

export default PPRDataProvider

import React, { useEffect, useState, createContext, useContext, useMemo, useRef } from "react"
import {
    useLocation,
    useMatch,
    useNavigate,
    useParams,
    useSearchParams,
    UNSAFE_RouteContext,
    matchRoutes,
} from "react-router-dom"
import { OneMgRouterContext } from "../context.jsx"
// import sanitizeHtml from "sanitize-html"

/**
 * @description Router Data
 * @typedef {{data: any, error: any, isFetching: boolean, isFetched: boolean, refetch?:(args:any)=>Promise<void>}, clear?:(wait?:number)=>void}} RouteData
 */

/**
 * @type {import("react").Context<Object.<string, RouteData>>}
 */
export const RouterContext = createContext({})

/**
 * @typedef {'always' | 'stale-while-revalidate' | 'no-cache'} CacheMode
 *
 * always                   — fetch once, cache for the lifetime of the provider (default)
 * stale-while-revalidate   — serve cached data immediately and refetch in background; update on arrival
 * no-cache                 — delete entry on unmount; next visit always starts from INITIAL_DATA_STATE
 */

/**
 * @typedef RouterDataProviderConfig
 @property {CacheMode} [cacheMode='always'] global cache mode, overridden per route
 */

/**
 * Initial State of context
 */
const INITIAL_DATA_STATE = {
    data: null,
    error: null,
    isFetching: false,
    isFetched: false,
    refetch: () => {},
    clear: () => {},
}

/**
 * @typedef RouterFetcherProps
 * @property {any} route route object
 * @property {import("react-router-dom").Location} location the current location object
 * @property {import("react-router-dom").Params} params dynamic params from the current URL
 * @property {URLSearchParams} searchParams search parameters
 * @property {import("react-router-dom").NavigateFunction} navigate navigate function
 */

/**
 * @typedef ServerFetchDataProps
 * @property {import("react-router-dom").RouteObject[]} routes routes array
 * @property {string} url current url
 * @property {import("express").Request} req Express request object
 */

/**
 * Resolves the effective cache mode for a route, route-level takes priority over global config
 * @param {import('react-router-dom').RouteObject} route
 * @param {RouterDataProviderConfig} [config]
 * @returns {CacheMode}
 */
const getCacheMode = (route, config) => route?.cacheMode ?? config?.cacheMode ?? "always"

/**
 * @description call this function to fetch data using fetchers defined in routes on the server
 * @param {ServerFetchDataProps} serverFetchDataProps
 * @param {Object.<string, any>} fetcherArgs
 * @returns RoutesData
 */
export const serverDataFetcher = async (serverFetchDataProps, fetcherArgs) => {
    /**
     * @type {Object.<string, RouteData>}
     */
    const routesData = {}
    const { routes, url, req, res: responseInstance } = serverFetchDataProps
    const matchedRoutes = matchRoutes(routes, url)
    if (matchedRoutes) {
        const searchParams = req.query
        const params = matchedRoutes[matchedRoutes.length - 1].params
        let searchParamsString = ""
        if (searchParams) {
            for (const key in searchParams) {
                searchParamsString += `${key}=${searchParams[key]}&`
            }
            searchParamsString = searchParamsString.slice(0, -1)
            searchParamsString = searchParamsString ? `?${searchParamsString}` : searchParamsString
        }
        await Promise.allSettled(
            matchedRoutes.map(async (match) => {
                const res = await fetchRouteData(
                    { req, res: responseInstance, route: match.route, params, searchParams },
                    fetcherArgs
                )
                routesData[generateRouteKey(match, searchParamsString)] = res
            })
        )
    }
    return routesData
}

/**
 * @description call this function to fetch data using fetchers defined in the route config or on the component
 * @param {RouterFetcherProps} routerProps
 * @param {Object.<string, any>} fetcherArgs
 * @param {Object.<string, any>=} refetchArgs
 * @returns {Promise<RouteData>}
 */
const fetchRouteData = async (routerProps, fetcherArgs, refetchArgs) => {
    const routeData = { ...INITIAL_DATA_STATE }
    const { route } = routerProps
    const routeComponent = route.component || route.Component || route.element

    // ─── CLIENT-SIDE ─────────────────────────────────────────────────────────

    /**
     * route.clientFetcher fires immediately without waiting for the component bundle to load,
     * running in parallel with lazy loading to eliminate the data fetch waterfall
     * load — because the fetcher reference is already available without waiting
     * for component.load() to resolve.
     *   navigate ──────────────── bundle loading ────────── render
     *            │
     *            └─▶ route.clientFetcher() starts immediately
     *                        │
     *                  data arrives (may already be ready by render time)
     */
    if (typeof window !== "undefined" && typeof route.clientFetcher === "function") {
        routeData.fetcherNotAvailable = false
        try {
            const res = await route.clientFetcher(routerProps, fetcherArgs, refetchArgs)
            routeData.data = res
        } catch (error) {
            // @ts-ignore
            routeData.error = error
        } finally {
            routeData.isFetching = false
            routeData.isFetched = true
        }
        return routeData
    }

    let component = null
    if (typeof routeComponent?.load === "function") {
        try {
            component = await routeComponent.load()
        } catch (err) {
            console.error("Error loading component", err)
        }
    }

    const fetcher =
        typeof window === "undefined" ? component?.default?.serverFetcher : component?.default?.clientFetcher

    if (typeof fetcher === "function") {
        routeData.fetcherNotAvailable = false
        try {
            const res = await fetcher(routerProps, fetcherArgs, refetchArgs)
            routeData.data = res
        } catch (error) {
            // @ts-ignore
            routeData.error = error
        } finally {
            routeData.isFetching = false
            routeData.isFetched = true
        }
    } else {
        routeData.fetcherNotAvailable = true
    }
    return routeData
}

/**
 * @param {RouteContextObject} routeContext
 * @returns {import('react-router-dom').RouteMatch[]}
 */
const getMatchedRoutes = ({ matches, outlet }) => {
    if (outlet) {
        return getMatchedRoutes(outlet.props.routeContext)
    }
    return matches
}

/**
 * @param {import('react-router-dom').RouteMatch} match
 * @param {string} searchParamsString
 * @returns {string}
 */
const generateRouteKey = (match, searchParamsString = "") => {
    const { pathname, route } = match
    const sanitizedPathname = pathname
    const sanitizedParams = searchParamsString
    if (route.children) {
        return `index${sanitizedPathname}${sanitizedParams}`
    }
    return `${sanitizedPathname}${sanitizedParams}`
}

/**
 * @typedef RouterDataProviderProps
 * @property {any} initialState initial state - used to hydrate the client with SSR data
 * @property {any} children
 * @property {Object.<string, any>} fetcherArgs passed through to all functions
 * @property {RouterDataProviderConfig} config global config
 */

/**
 * @description Renders children with router context and executes data fetchers on path change
 * @param {RouterDataProviderProps} props
 * @returns React.JSX.Element
 */
export const RouterDataProvider = ({ children, initialState, fetcherArgs = {}, config }) => {
    const match = useMatch("*")
    const location = useLocation()
    const params = useParams()
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()

    const isHydrated = useRef(false)
    const routeContext = useContext(UNSAFE_RouteContext)
    const matchedRoutes = useMemo(() => getMatchedRoutes(routeContext), [routeContext])

    /**
     * @type {[Object.<string, RouteData>, React.Dispatch<React.SetStateAction<Object.<string, RouteData>>>]}
     */
    const [routeData, setRouteData] = useState(initialState)

    const refetchData = (route, routeKey) => {
        return async (/** @type {{ [x: string]: any; } | undefined} */ args) => {
            setRouteData((prevData) => ({
                ...prevData,
                [routeKey]: { ...INITIAL_DATA_STATE, isFetching: true },
            }))
            const routerDataRes = await fetchRouteData(
                { route, location, params, searchParams, navigate },
                fetcherArgs,
                args
            )
            setRouteData((prevData) => ({
                ...prevData,
                [routeKey]: { ...routerDataRes, fetcherNotAvailable: false },
            }))
        }
    }

    const clear =
        (routeKey) =>
        (wait = 0) => {
            setTimeout(() => {
                setRouteData((prevData) => ({ ...prevData, [routeKey]: { ...INITIAL_DATA_STATE } }))
            }, wait)
        }

    useEffect(() => {
        matchedRoutes.forEach(async (match) => {
            const route = match.route
            const routeKey = generateRouteKey(match, location.search)
            const mode = getCacheMode(route, config)
            // On hydration (first client render), skip routes already fetched on the server
            if (!isHydrated.current && initialState && routeData[routeKey]?.isFetched) return

            // always: skip if already fetched
            if (mode === "always" && routeData[routeKey]?.isFetched) return

            // stale-while-revalidate: serve cached data immediately and refetch in background
            if (mode === "stale-while-revalidate" && routeData[routeKey]?.isFetched) {
                setRouteData((prevData) => ({
                    ...prevData,
                    [routeKey]: { ...prevData[routeKey], isFetching: true },
                }))
            } else {
                // no-cache or first visit: start fresh
                setRouteData((prevData) => ({
                    ...(prevData || {}),
                    [routeKey]: { ...INITIAL_DATA_STATE, isFetching: true },
                }))
            }

            const routerDataRes = await fetchRouteData(
                { route, location, params, searchParams, navigate },
                fetcherArgs
            )
            setRouteData((prevData) => ({ ...prevData, [routeKey]: { ...routerDataRes } }))
        })
        isHydrated.current = true

        return () => {
            // For no-cache routes, delete the entry on unmount so the next visit
            // always starts from INITIAL_DATA_STATE with no stale data
            matchedRoutes.forEach((match) => {
                const routeKey = generateRouteKey(match, location.search)
                if (getCacheMode(match.route, config) === "no-cache") {
                    setRouteData((prev) => {
                        const next = { ...prev }
                        delete next[routeKey]
                        return next
                    })
                }
            })
        }
    }, [match.pathname, match.params])

    return (
        <OneMgRouterContext.Provider value={{ matchedRoutes, refetchData, clear }}>
            <RouterContext.Provider value={{ ...routeData }}>{children}</RouterContext.Provider>
        </OneMgRouterContext.Provider>
    )
}

/**
 * @description returns current route data: {data, error, isFetching, isFetched, refetch, clear }
 * @returns {RouteData}
 * @throws if used outside RouterDataProvider Context
 */
export const useCurrentRouteData = () => {
    const routeContext = useContext(UNSAFE_RouteContext)
    const currentPageMatch = routeContext.matches[routeContext.matches.length - 1]
    const context = useContext(RouterContext)
    const { refetchData, clear } = useContext(OneMgRouterContext)
    const location = useLocation()
    if (context === undefined) {
        throw new Error("useCurrentRouteData must be used within a RouterDataProvider")
    }

    const routeKey = generateRouteKey(currentPageMatch, location.search)
    let currentPageData = context[routeKey]

    useEffect(() => {
        if (currentPageData?.fetcherNotAvailable) {
            refetchData(currentPageMatch.route, routeKey)()
        }
    }, [])

    if (!currentPageData) return { ...INITIAL_DATA_STATE }

    delete currentPageData.fetcherNotAvailable
    return {
        ...currentPageData,
        refetch: refetchData(currentPageMatch.route, routeKey),
        clear: clear(routeKey),
    }
}

/**
 * @description returns the full route data map for all fetchers in the current route tree
 * @returns {Object.<string, RouteData>}
 * @throws if used outside RouterDataProvider Context
 */
export const useRouterData = () => {
    const context = useContext(RouterContext)
    if (context === undefined) {
        throw new Error("useRouterData must be used within a RouterDataProvider")
    }

    return context
}

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
 * @description  Router Data
 * @typedef {{data: any, error: any, isFetching: boolean, isFetched:boolean, refetch?:(args:any)=>Promise<void>}} RouteData
 */

/**
 * @type {import("react").Context<Object.<string, RouteData>>}
 */
export const RouterContext = createContext({})

/**
 * @typedef RouterDataProviderConfig
 * @property {boolean} [disableCaching=false] disableCaching disable caching of fetched data - default is false
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
 * @property {import("react-router-dom").Location} location the current location object, which represents the current URL in web browsers.
 * @property {import("react-router-dom").Params} params object of key/value pairs of the dynamic params from the current URL that were matched by the route path.
 * @property {URLSearchParams} searchParams search parameters via URLSearchParams interface.
 * @property {import("react-router-dom").NavigateFunction} navigate function to navigate to other pages based on response.
 */

/**
 * @typedef ServerFetchDataProps
 * @property {import("react-router-dom").RouteObject[]} routes routes Array
 * @property {string} url current url
 * @property {import("express").Request} req Express request object
 */

/**
 * @description call this function to fetch data using fetchers defined in routes
 * @param {ServerFetchDataProps} serverFetchDataProps
 * @param {Object.<string, any>} fetcherArgs anything passed in fetcherArgs prop of RouterProvider
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
 * @description call this function to fetch data using fetchers defined in [page].fetcher.js
 * @param {RouterFetcherProps} routerProps
 * @param {Object.<string, any>} fetcherArgs anything passed in fetcherArgs prop of RouterProvider
 * @param {Object.<string, any>=} refetchArgs anything passed in argument of refetch function
 * @returns {Promise<RouteData>}
 */
const fetchRouteData = async (routerProps, fetcherArgs, refetchArgs) => {
    const routeData = { ...INITIAL_DATA_STATE }
    const { route } = routerProps
    const component = route.component || route.Component || route.element

    // If component is imported through loadable
    if (typeof component?.load === "function") {
        try {
            await component.load()
        } catch (err) {
            console.error("Error loading component", err)
        }
    }

    let fetcher = component?.clientFetcher

    if (typeof window === "undefined") {
        fetcher = component?.serverFetcher
    }

    if (fetcher && typeof fetcher === "function") {
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
 *
 * @param {RouteContextObject} routeContext route context object
 * @returns {import('react-router-dom').RouteMatch[]} Array of matched routes
 */
const getMatchedRoutes = ({ matches, outlet }) => {
    if (outlet) {
        return getMatchedRoutes(outlet.props.routeContext)
    }
    return matches
}

/**
 * Generates route key for given route using pathname and query params
 * @param {import('react-router-dom').RouteMatch} match Router Match Object
 * @param {string} searchParamsString Query params string
 * @returns {string} routerKey
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
 * @property {any} initialState Initial State of Data Provider - Mostly used to hydrate client with data from server
 * @property {any} children
 * @property {Object.<string, any>} fetcherArgs anything passed in fetcherArgs is passed to all the fetcher functions
 * @property  {RouterDataProviderConfig} config Global router data provider config
 */

/**
 * @description Render the child components with router context and execute data fetchers on path change
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
     * @description HOF which returns a function to refetch the route data
     * @param {import("react-router-dom").RouteObject} route
     * @param {string} routeKey
     * @returns
     */
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

    /**
     * @description HOF which returns a function to clear the route data immediately or after given time in ms
     * @param {import("react-router-dom").RouteObject} route
     * @param {string} routeKey
     * @returns
     */
    const clear =
        (routeKey) =>
        (wait = 0) => {
            // TODO :: Need to think this use case
            // eslint-disable-next-line no-unused-vars
            const timeout = setTimeout(() => {
                setRouteData((prevData) => ({ ...prevData, [routeKey]: { ...INITIAL_DATA_STATE } }))
            }, [wait])
        }

    /**
     * @type {[Object.<string, RouteData>,React.Dispatch<React.SetStateAction<Object.<string, RouteData>>>]}
     */
    const [routeData, setRouteData] = useState(initialState)

    /**
     * @description Check the config for refetching the data
     * @param {import('react-router-dom').RouteObject} route
     * @returns {boolean}
     */
    const shouldFetch = (route) => {
        // do not refetch on first render if we get something in initialState
        if (!isHydrated.current && initialState) return false

        // config at route level over rides config at global level
        if (typeof route.disableCaching === "boolean") {
            return route.disableCaching
        } else if (typeof config.disableCaching === "boolean") {
            // refetch if caching is disabled at global level
            return config.disableCaching
        }
        return false
    }

    useEffect(() => {
        matchedRoutes.forEach(async (match) => {
            const route = match.route
            const routeKey = generateRouteKey(match, location.search)
            if (routeData[routeKey]?.isFetched && !shouldFetch(route)) return
            setRouteData((prevData) => ({
                ...(prevData || {}),
                [routeKey]: { ...INITIAL_DATA_STATE, isFetching: true },
            }))
            const routerDataRes = await fetchRouteData(
                { route, location, params, searchParams, navigate },
                fetcherArgs
            )
            setRouteData((prevData) => ({ ...prevData, [routeKey]: { ...routerDataRes } }))
        })
    }, [match.pathname, match.params])

    return (
        <OneMgRouterContext.Provider value={{ matchedRoutes, refetchData, clear }}>
            <RouterContext.Provider value={{ ...routeData, refetch: refetchData }}>
                {children}
            </RouterContext.Provider>
        </OneMgRouterContext.Provider>
    )
}

/**
 * @description returns current router context object with three values: data, error, isFetching, isFetched
 * @returns {RouteData}
 * @throws If used outside RouterDataProvider Context
 */
export const useCurrentRouteData = () => {
    const routeContext = useContext(UNSAFE_RouteContext)
    const currentPageMatch = routeContext.matches[routeContext.matches.length - 1]
    const context = useContext(RouterContext)
    const { refetchData, clear } = useContext(OneMgRouterContext)
    const location = useLocation()
    // Throw error if the hook is not used within a RouterProvider
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

    if (currentPageData) {
        delete currentPageData.fetcherNotAvailable
        currentPageData = {
            ...currentPageData,
            refetch: refetchData(currentPageMatch.route, routeKey),
            clear: clear(routeKey),
        }
    }
    return currentPageData
}

/**
 * @description returns a router context object with data of all the fetchers in current route tree
 * @returns {Object.<string, RouteData>}
 * @throws If used outside RouterDataProvider Context
 */
export const useRouterData = () => {
    const context = useContext(RouterContext)
    // Throw error if the hook is not used within a RouterProvider
    if (context === undefined) {
        throw new Error("useRouterData must be used within a RouterDataProvider")
    }

    return context
}

import React, { useEffect, useState, createContext, useContext, useMemo, useRef } from "react"
import {
    useLocation,
    useMatch,
    useNavigate,
    useParams,
    useSearchParams,
    UNSAFE_RouteContext,
    matchRoutes,
} from "react-router"
import type { Location, NavigateFunction, Params, RouteMatch, RouteObject } from "react-router"
import { OneMgRouterContext } from "../context.jsx"
// import sanitizeHtml from "sanitize-html"

/**
 * Data a route fetcher produced, as exposed by useCurrentRouteData / useRouterData.
 */
export interface RouteData {
    data: any
    error: any
    isFetching: boolean
    isFetched: boolean
    /**
     * Refetches this route's data. Returns a promise when supplied by the
     * provider; the initial-state placeholder is a synchronous no-op.
     */
    refetch?: (args?: any) => void | Promise<void>
    clear?: (wait?: number) => void
    /** Internal marker: set when the route defines no fetcher. Stripped before return. */
    fetcherNotAvailable?: boolean
}

/**
 * Route data keyed by route key (pathname plus query string).
 */
export type RoutesData = Record<string, RouteData>

export const RouterContext = createContext<RoutesData>({})

/**
 * Global RouterDataProvider configuration.
 */
export interface RouterDataProviderConfig {
    /** disableCaching disable caching of fetched data - default is false */
    disableCaching?: boolean
}

/**
 * Initial State of context
 */
const INITIAL_DATA_STATE: RouteData = {
    data: null,
    error: null,
    isFetching: false,
    isFetched: false,
    refetch: () => {},
    clear: () => {},
}

/**
 * Arguments handed to a route's clientFetcher / serverFetcher.
 */
export interface RouterFetcherProps {
    /** route object */
    route: any
    /** the current location object, which represents the current URL in web browsers. */
    location?: Location
    /** object of key/value pairs of the dynamic params from the current URL that were matched by the route path. */
    params?: Params
    /** search parameters via URLSearchParams interface. */
    searchParams?: URLSearchParams | any
    /** function to navigate to other pages based on response. */
    navigate?: NavigateFunction
    /** Express request object, present on the server only. */
    req?: any
    /** Express response object, present on the server only. */
    res?: any
}

/**
 * Arguments for the server-side fetch pass.
 */
export interface ServerFetchDataProps {
    /** routes Array */
    routes: RouteObject[]
    /** current url */
    url: string
    /** Express request object */
    req: any
    /** Express response object */
    res?: any
}

/**
 * @description call this function to fetch data using fetchers defined in routes
 * @param serverFetchDataProps
 * @param fetcherArgs anything passed in fetcherArgs prop of RouterProvider
 * @returns RoutesData
 */
export const serverDataFetcher = async (
    serverFetchDataProps: ServerFetchDataProps,
    fetcherArgs?: Record<string, any>
): Promise<RoutesData> => {
    const routesData: RoutesData = {}
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
 * @param routerProps
 * @param fetcherArgs anything passed in fetcherArgs prop of RouterProvider
 * @param refetchArgs anything passed in argument of refetch function
 */
const fetchRouteData = async (
    routerProps: RouterFetcherProps,
    fetcherArgs?: Record<string, any>,
    refetchArgs?: Record<string, any>
): Promise<RouteData> => {
    const routeData: RouteData = { ...INITIAL_DATA_STATE }
    const { route } = routerProps
    const routeComponent = route.component || route.Component || route.element
    let component: any = null
    // If component is imported through loadable
    if (typeof routeComponent?.load === "function") {
        try {
            component = await routeComponent.load()
        } catch (err) {
            console.error("Error loading component", err)
        }
    }

    let fetcher = component?.default?.clientFetcher

    if (typeof window === "undefined") {
        fetcher = component?.default?.serverFetcher
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

const routeComponent = (route: any) => route.component || route.Component || route.element

const fetcherVersion = (route: any): number => routeComponent(route)?.__fetcherVersion || 0

/**
 *
 * @param routeContext route context object
 * @returns Array of matched routes
 */
const getMatchedRoutes = ({ matches, outlet }: any): any[] => {
    if (outlet) {
        return getMatchedRoutes(outlet.props.routeContext)
    }
    return matches
}

/**
 * Generates route key for given route using pathname and query params
 * @param match Router Match Object
 * @param searchParamsString Query params string
 * @returns routerKey
 */
const generateRouteKey = (match: RouteMatch, searchParamsString = ""): string => {
    const { pathname, route } = match
    const sanitizedPathname = pathname
    const sanitizedParams = searchParamsString
    if (route.children) {
        return `index${sanitizedPathname}${sanitizedParams}`
    }
    return `${sanitizedPathname}${sanitizedParams}`
}

/**
 * Props accepted by {@link RouterDataProvider}.
 */
export interface RouterDataProviderProps {
    /** Initial State of Data Provider - Mostly used to hydrate client with data from server */
    initialState?: any
    children?: any
    /** anything passed in fetcherArgs is passed to all the fetcher functions */
    fetcherArgs?: Record<string, any>
    /** Global router data provider config */
    config?: RouterDataProviderConfig
}

/**
 * @description Render the child components with router context and execute data fetchers on path change
 */
export const RouterDataProvider = ({
    children,
    initialState,
    fetcherArgs = {},
    config = {},
}: RouterDataProviderProps): any => {
    const match = useMatch("*")
    const location = useLocation()
    const params = useParams()
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()

    const isHydrated = useRef(false)
    // Latest request per route key, so an older in-flight fetch can't overwrite a newer one.
    const requestIds = useRef<Record<string, number>>({})
    // Dev HMR: the page's __fetcherVersion each route key was last fetched with.
    const fetchedVersions = useRef<Record<string, number>>({})
    const startRequest = (route: any, routeKey: string) => {
        const id = (requestIds.current[routeKey] || 0) + 1
        requestIds.current[routeKey] = id
        fetchedVersions.current[routeKey] = fetcherVersion(route)
        return () => requestIds.current[routeKey] === id
    }
    const routeContext = useContext(UNSAFE_RouteContext)
    const matchedRoutes = useMemo(() => getMatchedRoutes(routeContext), [routeContext])
    // Dev HMR: route keys whose data came from SSR, with their page component.
    const ssrRoutes = useRef<Record<string, any> | null>(null)
    if (ssrRoutes.current === null) {
        ssrRoutes.current = {}
        matchedRoutes.forEach((match: RouteMatch) => {
            const routeKey = generateRouteKey(match, location.search)
            if (initialState?.[routeKey]) ssrRoutes.current![routeKey] = routeComponent(match.route)
        })
    }

    /**
     * @description HOF which returns a function to refetch the route data
     */
    const refetchData = (route: RouteObject, routeKey: string) => {
        return async (args?: { [x: string]: any }) => {
            const isLatest = startRequest(route, routeKey)
            setRouteData((prevData) => ({
                ...prevData,
                [routeKey]: { ...INITIAL_DATA_STATE, isFetching: true },
            }))
            const routerDataRes = await fetchRouteData(
                { route, location, params, searchParams, navigate },
                fetcherArgs,
                args
            )
            if (!isLatest()) return
            setRouteData((prevData) => ({
                ...prevData,
                [routeKey]: { ...routerDataRes, fetcherNotAvailable: false },
            }))
        }
    }

    /**
     * @description HOF which returns a function to clear the route data immediately or after given time in ms
     */
    const clear =
        (routeKey: string) =>
        (wait: any = 0) => {
            // TODO :: Need to think this use case
            // eslint-disable-next-line no-unused-vars
            const timeout = setTimeout(() => {
                setRouteData((prevData) => ({ ...prevData, [routeKey]: { ...INITIAL_DATA_STATE } }))
            }, [wait] as any)
        }

    const [routeData, setRouteData] = useState<RoutesData>(initialState)

    /**
     * @description Check the config for refetching the data
     */
    const shouldFetch = (route: any): boolean => {
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
        matchedRoutes.forEach(async (match: RouteMatch) => {
            const route = match.route
            const routeKey = generateRouteKey(match, location.search)
            const fetcherEdited = (fetchedVersions.current[routeKey] ?? 0) !== fetcherVersion(route)
            if (routeData[routeKey]?.isFetched && !shouldFetch(route) && !fetcherEdited) return
            const isLatest = startRequest(route, routeKey)
            setRouteData((prevData) => ({
                ...(prevData || {}),
                [routeKey]: { ...INITIAL_DATA_STATE, isFetching: true },
            }))
            const routerDataRes = await fetchRouteData(
                { route, location, params, searchParams, navigate },
                fetcherArgs
            )
            if (!isLatest()) return
            setRouteData((prevData) => ({ ...prevData, [routeKey]: { ...routerDataRes } }))
        })
    }, [match.pathname, match.params])

    // Dev HMR: a page module was hot-updated (see routeFetcherHmrPlugin).
    // Component-only edits are left to Fast Refresh. The handler is refreshed
    // after every render so it sees current routes; the listener is added once.
    // The event only fires in development.
    const onModuleUpdated = useRef<((detail: any) => void) | null>(null)
    useEffect(() => {
        onModuleUpdated.current = (detail: any) => {
            const onScreen = matchedRoutes.filter((match: RouteMatch) =>
                detail.splits.includes(routeComponent(match.route))
            )
            if (detail.serverFetcherChanged) {
                // Only the server can rerun a serverFetcher. Data it produced that's still
                // shown needs a reload; if it's only cached, drop it so the next visit
                // fetches on the client, like any client-side navigation.
                const onScreenKeys = onScreen.map((match: RouteMatch) => generateRouteKey(match, location.search))
                for (const [routeKey, component] of Object.entries(ssrRoutes.current!)) {
                    if (!detail.splits.includes(component) || routeKey in fetchedVersions.current) continue
                    if (onScreenKeys.includes(routeKey)) {
                        detail.reload = true
                        return
                    }
                    delete ssrRoutes.current![routeKey]
                    setRouteData((prevData) => {
                        const { [routeKey]: _dropped, ...rest } = prevData || {}
                        return rest
                    })
                }
            }
            // Routes not on screen refetch on their next visit (see fetchedVersions).
            if (!detail.fetcherChanged) return
            onScreen.forEach((match: RouteMatch) => {
                refetchData(match.route, generateRouteKey(match, location.search))()
            })
        }
    })
    useEffect(() => {
        const listener = (event: any) => onModuleUpdated.current?.(event.detail)
        window.addEventListener("catalyst:route-module-updated", listener)
        return () => window.removeEventListener("catalyst:route-module-updated", listener)
    }, [])

    return (
        <OneMgRouterContext.Provider value={{ matchedRoutes, refetchData, clear, location, params, navigate }}>
            <RouterContext.Provider value={{ ...routeData, refetch: refetchData } as any}>
                {children}
            </RouterContext.Provider>
        </OneMgRouterContext.Provider>
    )
}

/**
 * @description returns current router context object with three values: data, error, isFetching, isFetched
 * @throws If used outside RouterDataProvider Context
 */
export const useCurrentRouteData = (): RouteData => {
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
 * @throws If used outside RouterDataProvider Context
 */
export const useRouterData = (): RoutesData => {
    const context = useContext(RouterContext)
    // Throw error if the hook is not used within a RouterProvider
    if (context === undefined) {
        throw new Error("useRouterData must be used within a RouterDataProvider")
    }

    return context
}

/**
 * Router state (location, params, navigate, the matched-route chain) read
 * through OneMgRouterContext rather than react-router's own hooks directly.
 *
 * Exists so a `catalyst-core/*` SUBPATH package (e.g. `catalyst-core/webmcp`)
 * can read router state without importing react-router itself. A subpath is
 * a separate module resolution root from the app's own react-router import
 * under Vite's dev SSR (react-router is deliberately excluded from
 * vite.config.js's `dedupe`), so two `useLocation()` calls made from two
 * different entry points can land on two different react-router module
 * instances with two different, mutually invisible RouterContexts — the
 * hook throws "may be used only in the context of a <Router> component"
 * even though a <Router> genuinely is an ancestor. Going through this
 * context instead relies only on `react`'s context identity, and `react`
 * (unlike react-router) IS deduped.
 *
 * @throws If used outside RouterDataProvider Context
 */
export const useRouterState = () => {
    const context = useContext(OneMgRouterContext)
    if (context.location === undefined) {
        throw new Error("useRouterState must be used within a RouterDataProvider")
    }
    return {
        location: context.location as Location,
        params: (context.params || {}) as Params,
        navigate: context.navigate as NavigateFunction,
        matchedRoutes: context.matchedRoutes || [],
    }
}

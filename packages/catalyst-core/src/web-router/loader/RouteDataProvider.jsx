import React, { createContext, useContext, useRef, use } from "react"
import { useLocation, UNSAFE_RouteContext } from "react-router-dom"
import { getOrRunLoaderPromise, abortLoaderPromise } from "./loaderCache.js"

/**
 * @type {import("react").Context<Object.<string, Promise<any>>>}
 */
export const RouteDataContext = createContext({})

// UNSAFE_RouteContext is react-router-dom's own low-level "which route matched
// here" context, populated by useRoutes() on both server (via <StaticRouter>) and
// client — a routing/matching primitive, not part of RR's data-router loader API.
// RouterDataProvider.jsx already reads it the same way for the same reason. Safe
// to read directly here (no createBrowserRouter on either side, per RFC 0001's
// ClientRouter.js change — see that file), so unlike an RR data-router setup,
// route.loader is the real field; nothing needs to be renamed to dodge RR's own
// interpretation of it.
const unwrapMatches = ({ matches, outlet }) => (outlet ? unwrapMatches(outlet.props.routeContext) : matches)

const deriveRouteId = (route) => route.id || route.path

const buildLoaderKey = (id, params, search) => `${id}:${JSON.stringify(params)}:${search}`

/**
 * Provides every matched route's loader-promise map to the tree below, so
 * useRouteData() can read/suspend on it.
 *
 * Server: the map is built once per request (buildLoaderPromiseMap.js, called
 * from handler.jsx) and handed down as `initialData` — this component does no
 * computation itself server-side.
 *
 * Client: the first render (hydration) adopts that same `initialData`, decoded
 * from the turbo-stream the server sent — so hydration doesn't refetch anything
 * the server already resolved or streamed. Every subsequent render triggered by
 * a client-side navigation computes a fresh map synchronously, during render,
 * not in an effect — this is what lets React's renderer suspend on a route's
 * loader promise and its `React.lazy()` chunk in the same pass (parallel
 * chunk+data fetch) with no manual `Promise.all`/race choreography needed here.
 * Safe to recompute during a render that ends up thrown away/not committed:
 * `getOrRunLoaderPromise` is memoized by key, so recomputing the same location
 * is idempotent.
 *
 * @param {{ initialData?: Object.<string, Promise<any>>, store?: any, children: any }} props
 */
export const RouteDataProvider = ({ initialData, store, children }) => {
    const isServer = typeof window === "undefined"
    const location = useLocation()
    const routeContext = useContext(UNSAFE_RouteContext)
    const matches = unwrapMatches(routeContext)
    const locationKey = `${location.pathname}${location.search}`

    const committedRef = useRef(null)

    if (isServer || committedRef.current === null) {
        // Server: one request, one map, no caching needed. Client's first
        // render: must match what the server sent, for hydration.
        committedRef.current = { locationKey, map: initialData || {} }
    } else if (committedRef.current.locationKey !== locationKey) {
        // A client-side navigation landed on a new route — kick off every
        // matched route's loader now, before this render commits.
        const map = {}
        const keys = []
        matches.forEach((match) => {
            const { route, params } = match
            if (typeof route.loader !== "function") return
            const id = deriveRouteId(route)
            const key = buildLoaderKey(id, params, location.search)
            keys.push(key)
            map[id] = getOrRunLoaderPromise(key, (signal) =>
                route.loader({
                    params,
                    searchParams: new URLSearchParams(location.search),
                    context: { store, signal },
                })
            )
        })

        // A route left behind by this navigation (its key isn't in the new
        // set) has its in-flight loader aborted — no reason to let a fetch for
        // a page the user already navigated away from keep running.
        const previousKeys = committedRef.current.keys || []
        previousKeys.forEach((previousKey) => {
            if (!keys.includes(previousKey)) abortLoaderPromise(previousKey)
        })

        committedRef.current = { locationKey, map, keys }
    }

    return <RouteDataContext.Provider value={committedRef.current.map}>{children}</RouteDataContext.Provider>
}

const useNearestRouteId = () => {
    const routeContext = useContext(UNSAFE_RouteContext)
    const matches = unwrapMatches(routeContext)
    const nearest = matches[matches.length - 1]
    return nearest && deriveRouteId(nearest.route)
}

/**
 * Reads a route's loader result — the nearest matched route's if no `routeId`
 * is passed, or a specific ancestor's otherwise. Suspends, via React 19's
 * built-in `use()`, until that route's loader promise settles. A route with no
 * `loader` returns `undefined` without suspending.
 *
 * Not react-router's/Remix's `useLoaderData` — deliberately a different name and
 * shape (no `<Await>`; consume a deferred field with `use()` directly), per
 * RFC 0001.
 *
 * @param {string} [routeId]
 */
export const useRouteData = (routeId) => {
    const map = useContext(RouteDataContext)
    const nearestId = useNearestRouteId()
    const id = routeId ?? nearestId
    const loaderPromise = id ? map[id] : undefined
    if (!loaderPromise) return undefined
    return use(loaderPromise)
}

import { createContext } from "react"
import type { RouteMatch, RouteObject } from "react-router"

/**
 * Internal context shared among the router components. `matchedRoutes` is the
 * match chain for the current location; the two callbacks are supplied by
 * RouterDataProvider and consumed by useCurrentRouteData.
 */
export interface OneMgRouterContextValue {
    matchedRoutes?: RouteMatch<string, RouteObject>[]
    refetchData?: (
        route: RouteObject,
        routeKey: string
    ) => (args?: Record<string, any>) => void | Promise<void>
    clear?: (routeKey: string) => (wait?: number) => void
}

/**
 * @description This is internal context made for sharing data among router components
 */
export const OneMgRouterContext = createContext<OneMgRouterContextValue>({})

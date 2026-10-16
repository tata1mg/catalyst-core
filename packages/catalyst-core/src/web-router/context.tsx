import { createContext } from "react"
import type { Location, NavigateFunction, Params, RouteMatch, RouteObject } from "react-router"

/**
 * Internal context shared among the router components. `matchedRoutes` is the
 * match chain for the current location; the two callbacks are supplied by
 * RouterDataProvider and consumed by useCurrentRouteData.
 *
 * `location`/`params`/`navigate` are the same values RouterDataProvider
 * already reads via react-router's own hooks (useLocation/useParams/
 * useNavigate) — republished here so a `catalyst-core/*` SUBPATH package
 * (loaded through a separate module resolution than the app's own
 * react-router import under Vite's dev SSR — `react-router` is deliberately
 * excluded from vite.config.js's `dedupe`, see that file's comment) can read
 * router state through ONE shared React context (identity guaranteed by
 * `react`, which IS deduped) instead of calling react-router's hooks itself
 * and risking a second, unlinked `react-router` module instance whose
 * internal context a subpath's own hook calls can't see.
 */
export interface OneMgRouterContextValue {
    matchedRoutes?: RouteMatch<string, RouteObject>[]
    refetchData?: (
        route: RouteObject,
        routeKey: string
    ) => (args?: Record<string, any>) => void | Promise<void>
    clear?: (routeKey: string) => (wait?: number) => void
    location?: Location
    params?: Params
    navigate?: NavigateFunction
}

/**
 * @description This is internal context made for sharing data among router components
 */
export const OneMgRouterContext = createContext<OneMgRouterContextValue>({})

import { createContext } from "react"
import type React from "react"
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

// One context per JS realm, not per module record. A production build can load
// this file twice: the app's server bundle inlines catalyst-core's main entry
// while `catalyst-core/webmcp` is loaded by Node at runtime (or the reverse),
// and each copy's own `createContext()` would be a different context. Provider
// and consumer then never meet and `useRouterState()` throws on every page.
// Keying the context on the global symbol registry makes every copy share it.
const CONTEXT_KEY = Symbol.for("catalyst-core.OneMgRouterContext")
const globalScope = globalThis as unknown as Record<
    symbol,
    React.Context<OneMgRouterContextValue> | undefined
>

/**
 * @description This is internal context made for sharing data among router components
 */
export const OneMgRouterContext: React.Context<OneMgRouterContextValue> = (globalScope[CONTEXT_KEY] ??=
    createContext<OneMgRouterContextValue>({}))

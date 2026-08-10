/**
 * @typedef oneMgRouterContext
 * @property {import("react-router").RouteMatch<string, import("react-router").RouteObject>[]=} matchedRoutes
 */
/**
 * @description This is internal context made for sharing data among router components
 * @type {import("react").Context<oneMgRouterContext>}
 */
export const OneMgRouterContext: import("react").Context<oneMgRouterContext>
export type oneMgRouterContext = {
    matchedRoutes?:
        | import("react-router").RouteMatch<string, import("react-router").RouteObject>[]
        | undefined
}

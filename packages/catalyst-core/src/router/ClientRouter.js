import { useRoutes } from "../index.jsx"
import { preparedRoutes } from "@catalyst/template/src/js/routes/utils"
import { registerCatalystServiceWorker } from "../offline/registerServiceWorker.js"

registerCatalystServiceWorker()

/**
 * Matches `ServerRouter.js`'s mechanism (plain `useRoutes()`) instead of
 * `createBrowserRouter()`'s real react-router-dom data router — deliberately, per
 * RFC 0001: a data router auto-assigns a tree-position `id` to any route without
 * one and interprets a literal `loader` field on a route object as its own, both
 * colliding with this framework's route config. Matching the server's mechanism
 * removes that collision instead of working around it.
 *
 * A component, not a function returning a router instance — render it inside a
 * `<BrowserRouter>` (or other history-providing `<Router>`) for real browser
 * history, the same way `<StaticRouter>` wraps `ServerRouter` on the server.
 *
 * @returns {React.ReactElement | null} the matched route element tree
 */
const ClientRouter = ({ routerInitialState, store, loaderData }) => {
    return useRoutes(preparedRoutes({ routerInitialState, store, loaderData }))
}

export default ClientRouter

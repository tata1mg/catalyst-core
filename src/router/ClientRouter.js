import { createBrowserRouter } from "@tata1mg/router"
import { preparedRoutes } from "@routes/utils.js"

/**
 * @returns returns browsers routers (client routes)
 */
const clientRouter = ({ store, routerInitialState }) =>
    createBrowserRouter(preparedRoutes({ store, routerInitialState }))

export default clientRouter

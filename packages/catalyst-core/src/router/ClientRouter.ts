import { createBrowserRouter } from "react-router"
import { preparedRoutes } from "@catalyst/template/src/js/routes/utils"
import { registerCatalystServiceWorker } from "../offline/registerServiceWorker.js"

registerCatalystServiceWorker()

/**
 * @returns returns browsers routers (client routes)
 */
const clientRouter = ({ routerInitialState }: { routerInitialState?: any; store?: any }) => {
    const browserRouter = createBrowserRouter(preparedRoutes({ routerInitialState }))
    return browserRouter
}

export default clientRouter

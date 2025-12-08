import { createBrowserRouter } from "react-router-dom"
import { preparedRoutes } from "@catalyst/template/src/js/routes/utils.jsx"

/**
 * @returns returns browsers routers (client routes)
 */
const clientRouter = ({ routerInitialState }) => {
    const browserRouter = createBrowserRouter(preparedRoutes({ routerInitialState }))
    return browserRouter
}

export { clientRouter }

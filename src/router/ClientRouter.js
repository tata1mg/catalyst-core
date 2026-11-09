import { createBrowserRouter } from "../index.jsx"
import { preparedRoutes } from "@catalyst/template/src/js/routes/utils"

/**
 * @returns returns browsers routers (client routes)
 */
const clientRouter = ({ routerInitialState }) => {
    const browserRouter = createBrowserRouter(preparedRoutes({ routerInitialState }))
    return browserRouter
}

// Named export for `import { clientRouter } from "catalyst-core"`; the default export is kept
// because apps import it as `import clientRouter from "catalyst-core/router/ClientRouter"`.
export { clientRouter }
export default clientRouter

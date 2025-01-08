import { createBrowserRouter } from "@tata1mg/router-internal"
const { preparedRoutes } = require(`${process.env.src_path}/src/js/routes/utils.js`)

/**
 * @returns returns browsers routers (client routes)
 */
const clientRouter = ({ store, routerInitialState }) =>
    createBrowserRouter(preparedRoutes({ store, routerInitialState }))

export default clientRouter

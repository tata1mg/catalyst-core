import { createBrowserRouter } from "../index.jsx"

// import path from "path"
// const routePath = path.join(process.env.src_path, "/Users/utkarsh/Desktop/sus/src/js/routes/utils.jsx")
import { preparedRoutes } from "/Users/utkarsh/Documents/1mg_projects/pwa/1mg_web/mweb/src/js/routes/utils.jsx"

// const { preparedRoutes } = await import(routePath)

/**
 * @returns returns browsers routers (client routes)
 */
const clientRouter = ({ routerInitialState }) => {
    const browserRouter = createBrowserRouter(preparedRoutes({ routerInitialState }))
    return browserRouter
}

export default clientRouter

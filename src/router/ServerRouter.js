import { useRoutes } from "../index.jsx"
import path from "path"

const routePath = path.join(process.env.src_path, "/src/js/routes/utils.jsx")
const { preparedRoutes } = await import(routePath)

const ServerRouter = (reduxData) => {
    const { store, intialData } = reduxData
    return useRoutes(preparedRoutes({ store, routerInitialState: intialData }))
}

export default ServerRouter

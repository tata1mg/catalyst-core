import router from "@tata1mg/router"
import path from "path"

const { useRoutes } = router
const routePath = path.join(process.env.src_path, "/src/js/routes/utils.jsx")
const { preparedRoutes } = await import(routePath)

const ServerRouter = (reduxData) => {
    const { store, intialData } = reduxData
    return useRoutes(preparedRoutes({ store, routerInitialState: intialData }))
}

export default ServerRouter

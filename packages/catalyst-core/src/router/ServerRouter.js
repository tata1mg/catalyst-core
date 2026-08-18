import { useRoutes } from "../index.jsx"
import { preparedRoutes } from "@catalyst/template/src/js/routes/utils"

const ServerRouter = (reduxData) => {
    const { store, intialData, loaderData } = reduxData
    return useRoutes(preparedRoutes({ store, routerInitialState: intialData, loaderData }))
}

export default ServerRouter

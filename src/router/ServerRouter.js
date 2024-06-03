import { useRoutes } from "@tata1mg/router"
import { preparedRoutes } from "@routes/utils.js"

const ServerRouter = (reduxData) => {
    const { store, intialData } = reduxData
    return useRoutes(preparedRoutes({ store, routerInitialState: intialData }))
}

export default ServerRouter

import { useRoutes } from "../index.jsx"
import { preparedRoutes } from "@catalyst/template/src/js/routes/utils"

const ServerRouter = (reduxData) => {
    const { store, intialData } = reduxData
    return useRoutes(preparedRoutes({ store, routerInitialState: intialData }))
}

export default ServerRouter

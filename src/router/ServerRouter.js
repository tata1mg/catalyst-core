import { useRoutes } from "@tata1mg/router"
const { preparedRoutes } = require(`${process.env.src_path}/src/js/routes/utils.js`)

const ServerRouter = (reduxData) => {
    const { store, intialData } = reduxData
    return useRoutes(preparedRoutes({ store, routerInitialState: intialData }))
}

export default ServerRouter

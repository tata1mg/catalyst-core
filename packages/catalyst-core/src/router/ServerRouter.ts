import { useRoutes } from "react-router"
import { preparedRoutes } from "@catalyst/template/src/js/routes/utils"
import type { Store } from "redux"

/**
 * Redux data handed to the server router by the SSR handler. `store` is the
 * app's redux store (created by the app's `createStore`); `intialData` is the
 * router initial state hydrated onto the client. The spelling of `intialData`
 * is part of the frozen internal shape and is deliberately preserved.
 */
export interface ServerRouterProps {
    store?: Store
    intialData?: any
}

const ServerRouter = (reduxData: ServerRouterProps) => {
    const { store, intialData } = reduxData
    return useRoutes(preparedRoutes({ store, routerInitialState: intialData }))
}

export default ServerRouter

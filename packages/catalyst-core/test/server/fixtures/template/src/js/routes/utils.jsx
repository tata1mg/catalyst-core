import React from "react"
import { RouterDataProvider } from "catalyst-core"
import App from "../containers/App/index.jsx"
import routes from "./index.jsx"

// Fixture mirror of a scaffolded app's routes/utils. Same two exports the
// framework consumes: getRoutes() (raw table, used by handler.jsx via
// getCachedRoutes / NestedMatchRoutes) and preparedRoutes() (react-router
// shape, used by ServerRouter).
//
// The parent element renders <App />, which renders <Outlet /> — the same
// shape every real create-catalyst-app template uses. Without the Outlet,
// react-router never renders the matched child route, so route components
// (and anything they do during render, e.g. Split's addComponent) stay
// dark. handler.assets.test.ts's deferred-asset cases depend on the child
// actually rendering.

export const getRoutes = () => routes

export const preparedRoutes = ({ routerInitialState } = {}) => {
    const prepare = (list) =>
        list.map((route, index) => {
            const Component = route.component
            const prepared = { ...route, element: <Component key={index} /> }
            if (route.children) prepared.children = prepare(route.children)
            return prepared
        })

    return [
        {
            element: (
                <RouterDataProvider config={{}} initialState={routerInitialState}>
                    <App />
                </RouterDataProvider>
            ),
            children: prepare(routes),
        },
    ]
}

import React from "react"
import { RouterDataProvider } from "catalyst-core"
import routes from "./index.jsx"

// Fixture mirror of a scaffolded app's routes/utils. Same two exports the
// framework consumes: getRoutes() (raw table, used by handler.jsx via
// getCachedRoutes / NestedMatchRoutes) and preparedRoutes() (react-router
// shape, used by ServerRouter).

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
                    <div data-testid="router-shell" />
                </RouterDataProvider>
            ),
            children: prepare(routes),
        },
    ]
}

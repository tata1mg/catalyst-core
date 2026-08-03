import React from "react"
import { RouterDataProvider, MetaTag } from "@tata1mg/router"
import App from "@containers/App"
import routes from "./index.js"

/**
 * Making the routes array compatible with the format accepted by createBrowserRouter
 * API on the client side
 * https://reactrouter.com/en/main/routers/create-browser-router
 */

export const preparedRoutes = ({ store, routerInitialState }) => {
    const getPreparedRoutes = (routes) => {
        return routes.map((route, index) => {
            const Component = route.component
            const routeToRender = {
                ...route,
                element: <Component key={index} />,
            }
            if (route.children) {
                routeToRender.children = getPreparedRoutes(route.children)
            }
            return routeToRender
        })
    }

    return [
        {
            element: (
                <RouterDataProvider config={{}} initialState={routerInitialState} fetcherArgs={{ store }}>
                    <MetaTag />
                    <App />
                </RouterDataProvider>
            ),
            children: getPreparedRoutes(routes),
        },
    ]
}

export const getRoutes = () => {
    return routes
}

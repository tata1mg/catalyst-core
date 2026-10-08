import React from "react"
import { RouterDataProvider, MetaTag } from "catalyst-core"
import { WebMcpProvider } from "catalyst-core/webmcp"
import { installShim } from "catalyst-core/webmcp/shim"
import App from "@containers/App"
import routes from "./index.js"

// Install the shim before WebMcpProvider ever mounts, so its first
// registerTool() call lands on a real document.modelContext — either the
// shim itself, or a native implementation if one is present (installShim()
// prefers native automatically). Safe to call at module scope: it no-ops
// during SSR (no `document`) and is idempotent on the client.
installShim()

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
                    <WebMcpProvider routes={routes}>
                        <MetaTag />
                        <App />
                    </WebMcpProvider>
                </RouterDataProvider>
            ),
            children: getPreparedRoutes(routes),
        },
    ]
}

export const getRoutes = () => {
    return routes
}

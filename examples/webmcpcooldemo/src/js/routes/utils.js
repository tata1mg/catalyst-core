import React from "react"
import { RouterDataProvider, MetaTag } from "catalyst-core"
import { WebMcpProvider } from "catalyst-core/webmcp"
import { installShim } from "catalyst-core/webmcp/shim"
import App from "@containers/App"
import routes from "./index.js"

// Install the shim before WebMcpProvider ever mounts, so its initial
// registerTool() calls land on document.modelContext (native if supported,
// or the shim). No-ops during SSR.
installShim()

/**
 * Making the routes array compatible with the format accepted by createBrowserRouter
 * API on the client side
 * https://reactrouter.com/en/main/routers/create-browser-router
 */
export const preparedRoutes = ({ routerInitialState }) => {
    const getPreparedRoutes = (routesList) => {
        return routesList.map((route, index) => {
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
                <RouterDataProvider config={{}} initialState={routerInitialState}>
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

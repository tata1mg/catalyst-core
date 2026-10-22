import React from 'react'
import { RouterDataProvider, MetaTag } from 'catalyst-core'
import { WebMcpProvider } from 'catalyst-core/webmcp'
import { installShim } from 'catalyst-core/webmcp/shim'
import App from '@containers/App'
import routes from './index.js'

// Install the shim before WebMcpProvider ever mounts, so its first
// registerTool() call lands on a real document.modelContext — either the
// shim itself, or a native implementation if one is present (installShim()
// prefers native automatically). Safe at module scope: no-ops during SSR
// (no `document`), idempotent on the client.
installShim()

/**
 * Making the routes array compatible with the format accepted by createBrowserRouter
 * API on the client side
 * https://reactrouter.com/en/main/routers/create-browser-router
 */

export const preparedRoutes = ({ routerInitialState }) => {
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
                <RouterDataProvider
                    config={{}}
                    initialState={routerInitialState}
                >
                    <WebMcpProvider routes={routes} filterNavigable={isNavigableForAgents}>
                        <MetaTag />
                        <App />
                    </WebMcpProvider>
                </RouterDataProvider>
            ),
            children: getPreparedRoutes(routes),
        },
    ]
}

/**
 * Excludes the 74+ generated doc-content routes (routes/index.js's
 * ...docsRoutes spread, one per markdown page under /content/...) from the
 * framework `navigate` tool's enum. Those pages are reachable through
 * search_docs -> open_doc instead (see DocsLayout.js) — dumping the whole
 * site map into one enum would make `navigate` unusable and bloat every
 * tool-list response. Also excludes the top-level `*` catch-all (the 404
 * page) — not a meaningful navigation target. Non-generated routes (/,
 * /errors) stay navigable directly.
 */
function isNavigableForAgents(route) {
    return route.path !== '*' && !route.path.startsWith('/content/')
}

export const getRoutes = () => {
    return routes
}

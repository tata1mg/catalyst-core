import React from "react"
import "./styles"
import { hydrateRoot } from "react-dom/client"
import { hydrationReady, PPRHydrationBoundary } from "catalyst-core"
import { RouterProvider } from "react-router/dom"
import clientRouter from "catalyst-core/router/ClientRouter"

window.addEventListener("load", () => {
    hydrationReady().then(() => {
        const { __ROUTER_INITIAL_DATA__: routerInitialData } = window

        const router = clientRouter({ routerInitialState: routerInitialData })

        const Application = (
            <PPRHydrationBoundary>
                <React.StrictMode>
                    <RouterProvider router={router} />
                </React.StrictMode>
            </PPRHydrationBoundary>
        )

        const container = document.getElementById("app")
        hydrateRoot(container, Application)
    })
})

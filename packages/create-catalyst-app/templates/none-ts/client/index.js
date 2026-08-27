import React from "react"
import "./styles"
import { hydrateRoot } from "react-dom/client"
import { hydrationReady } from "catalyst-core"
import { RouterProvider } from "react-router"
import clientRouter from "catalyst-core/router/ClientRouter"

window.addEventListener("load", () => {
    hydrationReady().then(() => {
        const { __ROUTER_INITIAL_DATA__: routerInitialData } = window

        const router = clientRouter({ routerInitialState: routerInitialData })

        const Application = (
            <React.StrictMode>
                <RouterProvider router={router} />
            </React.StrictMode>
        )

        const container = document.getElementById("app")
        hydrateRoot(container, Application)
    })
})

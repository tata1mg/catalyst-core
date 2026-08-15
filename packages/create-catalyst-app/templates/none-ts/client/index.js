import React from "react"
import "./styles"
import { hydrateRoot } from "react-dom/client"
import { BrowserRouter, hydrationReady } from "catalyst-core"
import ClientRouter from "catalyst-core/router/ClientRouter"

window.addEventListener("load", () => {
    hydrationReady().then(() => {
        const { __ROUTER_INITIAL_DATA__: routerInitialData } = window

        const Application = (
            <React.StrictMode>
                <BrowserRouter>
                    <ClientRouter routerInitialState={routerInitialData} />
                </BrowserRouter>
            </React.StrictMode>
        )

        const container = document.getElementById("app")
        hydrateRoot(container, Application)
    })
})

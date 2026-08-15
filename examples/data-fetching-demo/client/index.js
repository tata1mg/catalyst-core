import React from "react"
import "./styles"
import { hydrateRoot } from "react-dom/client"
import { BrowserRouter, hydrationReady, decodeLoaderData } from "catalyst-core"
import ClientRouter from "catalyst-core/router/ClientRouter"

window.addEventListener("load", () => {
    Promise.all([hydrationReady(), decodeLoaderData()]).then(([, loaderData]) => {
        const { __ROUTER_INITIAL_DATA__: routerInitialData } = window

        const Application = (
            <React.StrictMode>
                <BrowserRouter>
                    <ClientRouter routerInitialState={routerInitialData} loaderData={loaderData} />
                </BrowserRouter>
            </React.StrictMode>
        )

        const container = document.getElementById("app")
        hydrateRoot(container, Application)
    })
})

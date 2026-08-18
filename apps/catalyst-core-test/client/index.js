import React from "react"
import "./styles"
import { hydrateRoot } from "react-dom/client"
import { BrowserRouter, hydrationReady, decodeLoaderData } from "catalyst-core"
import ClientRouter from "catalyst-core/router/ClientRouter"

window.addEventListener("load", () => {
    // decodeLoaderData() reads window.__CATALYST_LOADER_DATA__ (written by
    // deferredStream.server.js) — awaited alongside hydrationReady()'s existing
    // chunk-prefetch gate so hydration never races a still-decoding stream.
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

import React from "react"
import "./styles"
import { hydrateRoot } from "react-dom/client"
import { hydrationReady } from "catalyst-core"
import { Provider } from "react-redux"
import { RouterProvider } from "react-router/dom"
import clientRouter from "catalyst-core/router/ClientRouter"
import configureStore from "@store"
import WebBridge from "catalyst-core/WebBridge"
window.addEventListener("load", () => {
    hydrationReady().then(() => {
        const { __ROUTER_INITIAL_DATA__: routerInitialData, __INITIAL_STATE__ } = window
        const store = configureStore(__INITIAL_STATE__ || {})

        const router = clientRouter({ store, routerInitialState: routerInitialData })

        const Application = (
            <Provider store={store} serverState={__INITIAL_STATE__}>
                <React.StrictMode>
                    <RouterProvider router={router} />
                </React.StrictMode>
            </Provider>
        )
        WebBridge.init()

        const container = document.getElementById("app")
        hydrateRoot(container, Application)
    })
})

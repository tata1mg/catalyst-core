import React from "react"
import "./styles"
import { hydrateRoot } from "react-dom/client"
import { Provider } from "react-redux"
import { RouterProvider, hydrationReady } from "catalyst-core"
import clientRouter from "catalyst-core/router/ClientRouter"
import configureStore from "@store"

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

        const container = document.getElementById("app")
        hydrateRoot(container, Application)
    })
})

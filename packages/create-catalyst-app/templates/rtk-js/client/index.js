import React from "react"
import "./styles"
import { hydrateRoot } from "react-dom/client"
import { Provider } from "react-redux"
import { BrowserRouter, hydrationReady } from "catalyst-core"
import ClientRouter from "catalyst-core/router/ClientRouter"
import configureStore from "@store"

window.addEventListener("load", () => {
    hydrationReady().then(() => {
        const { __ROUTER_INITIAL_DATA__: routerInitialData, __INITIAL_STATE__ } = window
        const store = configureStore(__INITIAL_STATE__ || {})

        const Application = (
            <Provider store={store} serverState={__INITIAL_STATE__}>
                <React.StrictMode>
                    <BrowserRouter>
                        <ClientRouter store={store} routerInitialState={routerInitialData} />
                    </BrowserRouter>
                </React.StrictMode>
            </Provider>
        )

        const container = document.getElementById("app")
        hydrateRoot(container, Application)
    })
})

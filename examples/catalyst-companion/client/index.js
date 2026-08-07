import React from "react"
import "./styles"
import { hydrateRoot } from "react-dom/client"
import { RouterProvider, hydrationReady } from "catalyst-core"
import clientRouter from "catalyst-core/router/ClientRouter"
import WebBridge from "catalyst-core/WebBridge"
import { applyShellAttribute } from "../src/js/components/hub/DocumentBootstrap"

window.addEventListener("load", () => {
    WebBridge.init()

    // The inline bootstrap ran at parse time, possibly before the native shell
    // finished registering its bridge handlers — most visibly after exiting a
    // preview, which rebuilds the WebView. Re-assert now, and once more on the
    // next frame to cover a late registration.
    applyShellAttribute()
    requestAnimationFrame(applyShellAttribute)

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

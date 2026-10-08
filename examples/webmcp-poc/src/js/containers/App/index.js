import React from "react"
import { Outlet } from "react-router"
import { DevPanel } from "@devtools/DevPanel.jsx"

// DevPanel used to be rendered by WebMcpProvider itself. Core's provider now
// ships no UI (dev panel is an app-level concern, not core) — this app opts
// in by rendering it here, inside the provider's tree so it can read the
// registry.
const App = () => {
    return (
        <>
            <Outlet />
            <div id="webmcp-panel" />
            <DevPanel />
        </>
    )
}

App.serverSideFunction = () => {
    return new Promise((resolve) => resolve())
}

export default App

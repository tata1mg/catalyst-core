import React from "react"
import { Outlet } from "react-router"

const App = () => {
    return (
        <>
            <Outlet />
            <div id="webmcp-panel" />
        </>
    )
}

App.serverSideFunction = () => {
    return new Promise((resolve) => resolve())
}

export default App

import React from "react"
import { Outlet } from "catalyst-core"

const App = () => {
    return (
        <>
            <Outlet />
        </>
    )
}

App.serverSideFunction = () => {
    return new Promise((resolve) => resolve())
}

export default App

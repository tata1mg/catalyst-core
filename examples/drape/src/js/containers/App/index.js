import React from "react"
import { Outlet } from "@tata1mg/router"

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

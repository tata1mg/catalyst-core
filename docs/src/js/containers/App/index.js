import React from 'react'
import { Outlet } from 'react-router'
import WebMcpToastBridge from '../../components/WebMcpToastBridge'

const App = () => {
    return (
        <>
            <Outlet />
            <WebMcpToastBridge />
        </>
    )
}

App.serverSideFunction = () => {
    return new Promise((resolve) => resolve())
}

export default App

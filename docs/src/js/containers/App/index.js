import React from 'react'
import { Outlet } from 'catalyst-core'
import ChatBot from '../ChatBot'
import WebMcpToastBridge from '../../components/WebMcpToastBridge'

const App = () => {
    return (
        <>
            <Outlet />
            <ChatBot />
            <WebMcpToastBridge />
        </>
    )
}

App.serverSideFunction = () => {
    return new Promise((resolve) => resolve())
}

export default App

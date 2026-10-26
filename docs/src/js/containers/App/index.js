import React from 'react'
import { Outlet } from 'catalyst-core'
import ChatBot from '../ChatBot'

const App = () => {
    return (
        <>
            <Outlet />
            <ChatBot />
        </>
    )
}

App.serverSideFunction = () => {
    return new Promise((resolve) => resolve())
}

export default App

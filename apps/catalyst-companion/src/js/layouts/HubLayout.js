import React from "react"
import { Outlet } from "catalyst-core"
import { ThemeProvider } from "../components/docs/ThemeContext"
import DocumentBootstrap from "../components/hub/DocumentBootstrap"
import Navbar from "../components/hub/Navbar"

const HubLayout = () => (
    <ThemeProvider>
        <DocumentBootstrap />
        <div className="hub-shell">
            <Navbar />
            <Outlet />
        </div>
    </ThemeProvider>
)

export default HubLayout

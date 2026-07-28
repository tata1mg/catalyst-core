import React from "react"
import { Outlet } from "catalyst-core"
import { ThemeProvider } from "../components/docs/ThemeContext"
import DocumentBootstrap from "../components/hub/DocumentBootstrap"
import Navbar from "../components/hub/Navbar"
import BottomNav from "../components/hub/BottomNav"

const HubLayout = () => (
    <ThemeProvider>
        <DocumentBootstrap />
        <div className="hub-shell">
            <Navbar />
            <Outlet />
            <BottomNav />
        </div>
    </ThemeProvider>
)

export default HubLayout

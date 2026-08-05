import React from "react"
import { Outlet } from "catalyst-core"
import { ThemeProvider } from "../components/docs/ThemeContext"
import DocumentBootstrap from "../components/hub/DocumentBootstrap"
import Navbar from "../components/hub/Navbar"
import BottomNav from "../components/hub/BottomNav"
import ScrollReset from "../components/hub/ScrollReset"

const HubLayout = () => (
    <ThemeProvider>
        <DocumentBootstrap />
        <ScrollReset />
        <div className="hub-shell">
            <Navbar />
            <Outlet />
            <BottomNav />
        </div>
    </ThemeProvider>
)

export default HubLayout

import React from "react"
import { Outlet } from "@tata1mg/router"
import loadable from "@loadable/component"
import Header from "../../components/Header/Header"

const Footer = loadable(() => import("../../components/Footer/Footer"), {
    fallback: <div>Loading footer...</div>,
    ssr: false,
})

const MainLayout = () => {
    return (
        <div>
            <Header />
            <main>
                <Outlet />
            </main>
            <Footer />
        </div>
    )
}

export default MainLayout

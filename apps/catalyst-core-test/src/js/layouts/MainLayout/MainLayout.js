import React from "react"
import { split } from "catalyst-core"
import { Outlet } from "react-router"
import Header from "../../components/Header/Header"

const Footer = split(() => import("../../components/Footer/Footer"), {
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

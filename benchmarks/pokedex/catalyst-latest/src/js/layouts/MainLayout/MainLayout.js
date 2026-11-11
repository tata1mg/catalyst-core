import React from "react"
import { Outlet, Link } from "react-router"

const MainLayout = () => (
    <div>
        <header className="site"><Link to="/">Pokédex</Link></header>
        <main><Outlet /></main>
    </div>
)
export default MainLayout

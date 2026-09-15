import React from "react"
import { Link } from "react-router"
import css from "./Home.scss"

function Home() {
    return (
        <div className={css.container}>
            <h1 className={css.title}>WebMCP POC</h1>
            <p className={css.blurb}>
                A proof-of-concept e-commerce application demonstrating WebMCP tool registrations and state management.
            </p>
            <nav className={css.nav}>
                <Link className={css.navLink} to="/products">
                    Browse Products
                </Link>
                <Link className={css.navLink} to="/cart">
                    View Cart
                </Link>
            </nav>
        </div>
    )
}

Home.setMetaData = () => [
    <title key="t">WebMCP POC — agent-ready storefront</title>,
    <meta
        key="d"
        name="description"
        content="A proof-of-concept storefront whose product browsing, cart and checkout are exposed to browser AI agents as WebMCP tools."
    />,
]

export default Home

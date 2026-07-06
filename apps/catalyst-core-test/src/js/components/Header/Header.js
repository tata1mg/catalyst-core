// src/js/components/Header/Header.js
import React from "react"
import { Link } from "@tata1mg/router"

const Header = () => {
    return (
        <header
            style={{
                background: "white",
                padding: "10px 20px",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
            }}
        >
            <div style={{ display: "flex", alignItems: "center" }}>
                <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Dog Adoption Center</h1>
            </div>
            <nav>
                <Link
                    to="/"
                    style={{
                        marginRight: "20px",
                        textDecoration: "none",
                        color: "#4CAF50",
                    }}
                >
                    Home
                </Link>
                <Link to="/about" style={{ textDecoration: "none", color: "#4CAF50" }}>
                    About
                </Link>
            </nav>
        </header>
    )
}

export default Header

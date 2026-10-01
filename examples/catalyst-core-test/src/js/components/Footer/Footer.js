import React from "react"

const Footer = () => {
    return (
        <footer
            style={{
                background: "#333",
                color: "white",
                padding: "20px",
                marginTop: "50px",
                textAlign: "center",
            }}
        >
            <p>© 2025 Dog Adoption Center. All rights reserved.</p>
            <p>
                Data provided by{" "}
                <a href="https://dog.ceo/dog-api/" style={{ color: "white" }}>
                    Dog API
                </a>
            </p>
            <p>This is a demo application built with Catalyst.</p>
        </footer>
    )
}

export default Footer

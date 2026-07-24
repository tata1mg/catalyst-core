import React from "react"
import { Link } from "catalyst-core"
import { ThemeProvider } from "../../components/docs/ThemeContext"
import DocumentBootstrap from "../../components/hub/DocumentBootstrap"
import Navbar from "../../components/hub/Navbar"

// Top-level catch-all. Lives outside HubLayout because the framework only
// sends HTTP 404 when the outermost matched route's path is "*"
// (see catalyst-core server/renderer/handler.jsx), so it renders its own
// navbar chrome.
const NotFound = () => (
    <ThemeProvider>
        <DocumentBootstrap />
        <Navbar />
        <main className="hub-not-found">
            <h1>404</h1>
            <p>This page doesn&apos;t exist.</p>
            <Link to="/" className="button button--primary">
                Back to home
            </Link>
        </main>
    </ThemeProvider>
)

NotFound.setMetaData = () => [
    <title key="title">Page Not Found | Catalyst</title>,
    <meta key="robots" name="robots" content="noindex" />,
]

export default NotFound

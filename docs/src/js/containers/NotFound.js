import React from 'react'
import { Link } from 'catalyst-core'
import { ThemeProvider } from '../components/docs/ThemeContext'
import DocumentBootstrap from '../components/DocumentBootstrap'
import Navbar from '../components/Navbar'

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
            <div className="hub-not-found-actions">
                <Link to="/" className="hub-cta">
                    Back to home
                </Link>
                <a
                    href="https://github.com/tata1mg/catalyst-core/issues/new"
                    target="_blank"
                    rel="noreferrer"
                    className="hub-not-found-report"
                >
                    Report a broken link
                </a>
            </div>
        </main>
    </ThemeProvider>
)

NotFound.setMetaData = () => [
    <title key="title">Page Not Found | Catalyst</title>,
    <meta key="robots" name="robots" content="noindex" />,
]

export default NotFound

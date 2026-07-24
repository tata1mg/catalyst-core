import React from "react"
import { Link } from "catalyst-core"
import { ThemeProvider } from "../../components/docs/ThemeContext"
import DocumentBootstrap from "../../components/hub/DocumentBootstrap"

const SAMPLE_APP_URL = "https://www.1mg.com"

/**
 * Companion home — the native app's start URL (WEBVIEW_CONFIG.initial_url).
 * Top-level route with its own chrome (not the docs navbar). Both variants
 * ship in the SSR HTML; the DocumentBootstrap pre-paint script stamps
 * data-shell and CSS picks one, so neither audience sees a flash. Without JS
 * the page safely renders the web variant.
 */
const AppHome = () => (
    <ThemeProvider>
        <DocumentBootstrap />
        <div className="app-home">
            <header className="app-home-header">
                <img src="/img/logo-light.svg" alt="" className="hub-logo hub-logo-light" />
                <img src="/img/logo-dark.svg" alt="" className="hub-logo hub-logo-dark" />
                <span>Catalyst Companion</span>
            </header>

            {/* In the Companion shell: the app's actual home. */}
            <main className="shell-only app-home-main">
                <h1>Preview apps on this device</h1>

                <Link to="/try" className="app-home-card app-home-card-primary">
                    <h2>Try Your Own App</h2>
                    <p>
                        Load any deployed HTTPS app in an isolated native WebView — no bridges, no
                        shared state, storage cleared per session.
                    </p>
                </Link>

                <Link
                    to={`/try?url=${encodeURIComponent(SAMPLE_APP_URL)}`}
                    className="app-home-sample"
                >
                    Or try a sample app first →
                </Link>

                <div className="app-home-card app-home-card-muted">
                    <h2>
                        Showcase <span className="app-home-badge">Coming soon</span>
                    </h2>
                    <p>A gallery of apps built with Catalyst.</p>
                </div>

                <Link to="/content/Introduction/why-catalyst" className="app-home-secondary">
                    Browse Documentation →
                </Link>
            </main>

            {/* On the web: a short pitch, no dead store buttons until published. */}
            <main className="web-only app-home-main">
                <h1>Catalyst Companion</h1>
                <p>
                    The Companion app lets you preview any deployed HTTPS app in an isolated native
                    WebView on a real device — scan a QR code, tweak display options, and see it
                    running in seconds.
                </p>
                <p className="app-home-muted">Coming soon to the App Store and Google Play.</p>
                <Link to="/content/Introduction/why-catalyst" className="app-home-secondary">
                    Browse Documentation →
                </Link>
            </main>
        </div>
    </ThemeProvider>
)

AppHome.setMetaData = () => [
    <title key="title">Catalyst Companion</title>,
    <meta key="robots" name="robots" content="noindex, follow" />,
    <meta
        key="description"
        name="description"
        content="Preview your apps on a real device with the Catalyst Companion."
    />,
]

export default AppHome

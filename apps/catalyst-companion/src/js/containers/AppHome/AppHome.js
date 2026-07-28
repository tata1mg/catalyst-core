import React from "react"
import { Link } from "catalyst-core"
import { useNativeTransition } from "catalyst-core/hooks"
import { ThemeProvider } from "../../components/docs/ThemeContext"
import DocumentBootstrap from "../../components/hub/DocumentBootstrap"
import BottomNav from "../../components/hub/BottomNav"

/**
 * Companion home — the native app's start URL (WEBVIEW_CONFIG.initial_url).
 * Top-level route with its own chrome (not the docs navbar). Both variants
 * ship in the SSR HTML; the DocumentBootstrap pre-paint script stamps
 * data-shell and CSS picks one, so neither audience sees a flash. Without JS
 * the page safely renders the web variant.
 */
const AppHome = () => {
    // Shell entries push forward (direction "right"); the bottom tab bar owns
    // the lateral tab swaps, so these keep the default non-replacing history.
    const { navigate } = useNativeTransition({ type: "slide", duration: 280 })

    return (
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

                    <button
                        type="button"
                        className="app-home-card app-home-card-primary"
                        onClick={() => navigate("/try", { direction: "right" })}
                    >
                        <h2>Try Your Own App</h2>
                        <p>
                            Load any deployed HTTPS app in an isolated native WebView — no bridges,
                            no shared state, storage cleared per session.
                        </p>
                    </button>

                    <button
                        type="button"
                        className="app-home-card"
                        onClick={() => navigate("/showcase", { direction: "right" })}
                    >
                        <h2>
                            Showcase <span className="app-home-badge">New</span>
                        </h2>
                        <p>
                            Live demos of Catalyst&rsquo;s native capabilities — camera, files,
                            sign-in, notifications.
                        </p>
                    </button>

                    <button
                        type="button"
                        className="app-home-secondary"
                        onClick={() =>
                            navigate("/content/Introduction/why-catalyst", { direction: "right" })
                        }
                    >
                        Browse Documentation →
                    </button>
                </main>

                {/* On the web: a short pitch, no dead store buttons until published. */}
                <main className="web-only app-home-main">
                    <h1>Catalyst Companion</h1>
                    <p>
                        The Companion app lets you preview any deployed HTTPS app in an isolated
                        native WebView on a real device — scan a QR code, tweak display options, and
                        see it running in seconds.
                    </p>
                    <p className="app-home-muted">Coming soon to the App Store and Google Play.</p>
                    <Link to="/content/Introduction/why-catalyst" className="app-home-secondary">
                        Browse Documentation →
                    </Link>
                </main>

                <BottomNav />
            </div>
        </ThemeProvider>
    )
}

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

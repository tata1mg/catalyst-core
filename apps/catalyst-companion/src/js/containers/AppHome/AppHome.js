import React from "react"
import { Link } from "catalyst-core"
import { useNativeTransition } from "catalyst-core/hooks"
import { ThemeProvider } from "../../components/docs/ThemeContext"
import DocumentBootstrap from "../../components/hub/DocumentBootstrap"
import BottomNav from "../../components/hub/BottomNav"
import ScrollReset from "../../components/hub/ScrollReset"

const IconScan = () => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
        <path d="M7 12h10" />
    </svg>
)

const IconGrid = () => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
)

const IconChevron = () => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <path d="m9 5 7 7-7 7" />
    </svg>
)

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
            <ScrollReset />
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
                        <span className="app-home-card-icon">
                            <IconScan />
                        </span>
                        <span className="app-home-card-body">
                            <h2>Try Your Own App</h2>
                            <p>
                                Scan a QR from <code>npm start</code> or paste a URL — your app
                                runs here with the full native bridge and its own config applied.
                            </p>
                        </span>
                        <span className="app-home-card-chevron">
                            <IconChevron />
                        </span>
                    </button>

                    <button
                        type="button"
                        className="app-home-card"
                        onClick={() => navigate("/showcase", { direction: "right" })}
                    >
                        <span className="app-home-card-icon">
                            <IconGrid />
                        </span>
                        <span className="app-home-card-body">
                            <h2>
                                Showcase <span className="app-home-badge">New</span>
                            </h2>
                            <p>
                                Live demos of Catalyst&rsquo;s native capabilities — camera, files,
                                sign-in, notifications.
                            </p>
                        </span>
                        <span className="app-home-card-chevron">
                            <IconChevron />
                        </span>
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
                        The Companion app previews any Catalyst app on a real device — scan the QR
                        from your dev server and it runs with the full native bridge, using the
                        config your server provides.
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

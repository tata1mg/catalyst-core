import React from "react"
import { Link } from "catalyst-core"

const Showcase = () => (
    <>
        <div className="web-only hub-showcase">
            <h1>Showcase</h1>
            <p>Coming soon: a tour of Catalyst-built experiences.</p>
        </div>

        {/* In the Companion shell this deep link presents as an app screen. */}
        <section className="shell-only app-screen hub-showcase-app">
            <header className="app-screen-bar">
                <Link to="/app" className="app-screen-back" aria-label="Back to App Home">
                    ‹
                </Link>
                <span className="app-screen-title">Showcase</span>
            </header>
            <div className="app-home-card app-home-card-muted">
                <h2>
                    Coming soon <span className="app-home-badge">In progress</span>
                </h2>
                <p>A gallery of apps built with Catalyst, ready to open on this device.</p>
            </div>
        </section>
    </>
)

export default Showcase

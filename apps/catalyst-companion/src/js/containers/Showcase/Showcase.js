import React from "react"
import { Outlet } from "catalyst-core"
import kit from "../shared/appKit.scss"

/**
 * Showcase shell: web visitors get a pointer to the Companion app; inside the
 * shell each native capability is a sub-route so moving between them runs
 * through useNativeTransition (native snapshot slide).
 */
const Showcase = () => (
    <>
        <div className="web-only hub-showcase">
            <h1>Showcase</h1>
            <p>
                Live demos of Catalyst&rsquo;s native capabilities — camera streaming, file
                picking, Google Sign-In, notifications. Available in the Catalyst Companion app.
            </p>
        </div>

        <section className={`shell-only app-screen ${kit.screen}`}>
            <Outlet />
        </section>
    </>
)

export default Showcase

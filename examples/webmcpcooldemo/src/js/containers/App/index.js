import React, { useCallback, useEffect, useState } from "react"
import { NavLink, Outlet } from "react-router"
import { useTool } from "catalyst-core/webmcp"
import AgentDock from "@lib/agent/AgentDock.jsx"
import ToolCallBanner from "@lib/webmcp/ToolCallBanner.jsx"
import { useWire } from "@lib/webmcp/wire.js"
import css from "./App.scss"

const LINKS = [
    { to: "/", label: "Studio", icon: "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zm0 0v18M4 7.5l8 4.5 8-4.5" },
    { to: "/journey", label: "Living Quest", icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" },
    { to: "/pass", label: "Reveal Pass", icon: "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm4 4h4m-4 4h4m-4 4h4" },
    { to: "/stickers", label: "Blend Lab", icon: "M4 4h11l5 5v11H4zM15 4v5h5" },
    { to: "/inspector", label: "Inspector", icon: "M4 6h16M4 12h10M4 18h7M17 15l3 3-3 3" },
]


// eslint-disable-next-line react/prop-types
function Icon({ d }) {
    return (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function LiveCount() {
    const { tools, isNative } = useWire()
    const [bump, setBump] = useState(0)
    useEffect(() => setBump((b) => b + 1), [tools.length])
    return (
        <span className={css.live} title="Tools currently registered on document.modelContext">
            <span className={`dot ${css.liveDot}`} />
            <span key={bump} className={css.liveNum}>
                {tools.length}
            </span>
            <span className={css.liveLabel}>tools live</span>
            <span className={css.liveMode} data-native={isNative}>
                {isNative ? "native" : "shim"}
            </span>
        </span>
    )
}

const App = () => {
    const [dockOpen, setDockOpen] = useState(false)
    const [deviceMode, setDeviceMode] = useState("desktop") // "desktop" | "mobile"

    // Desktop opens the dock by default (after hydration so SSR markup matches).
    useEffect(() => {
        if (window.matchMedia("(min-width: 1100px)").matches) setDockOpen(true)
    }, [])

    // WebMCP Tools to toggle device view programmatically via AI agents!
    useTool({
        name: "set_device_view",
        description: "Switch viewport presentation between 'desktop' (full screen layout) and 'mobile' (simulated mobile device frame).",
        inputSchema: {
            type: "object",
            properties: {
                view: { type: "string", enum: ["desktop", "mobile"], description: "Viewport layout: 'desktop' or 'mobile'" },
            },
            required: ["view"],
        },
        execute: async ({ view }) => {
            if (view !== "desktop" && view !== "mobile") {
                throw new Error(`Invalid view "${view}". Must be "desktop" or "mobile".`)
            }
            setDeviceMode(view)
            return { view, ok: true, note: `Switched viewport presentation to ${view.toUpperCase()}` }
        },
    })

    useTool({
        name: "toggle_device_view",
        description: "Toggle between desktop full screen and mobile device simulation frame.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
            const next = deviceMode === "desktop" ? "mobile" : "desktop"
            setDeviceMode(next)
            return { view: next, ok: true, note: `Toggled viewport presentation to ${next.toUpperCase()}` }
        },
    })

    const closeDock = useCallback(() => setDockOpen(false), [])
    const toggleDock = useCallback(() => setDockOpen((o) => !o), [])

    return (
        <div className={css.shell} data-dock={dockOpen ? "open" : "closed"} data-mode={deviceMode}>
            <a href="#main" className={css.skip}>
                Skip to content
            </a>
            <header className={css.nav}>
                <NavLink to="/" className={css.brand} viewTransition aria-label="WebMCP Lab home">
                    <span className={css.brandMark} aria-hidden="true" />
                    <span className={css.brandText}>
                        webmcp<span>/lab</span>
                    </span>
                </NavLink>

                <nav className={css.links} aria-label="Primary">
                    {LINKS.map((l) => (
                        <NavLink
                            key={l.to}
                            to={l.to}
                            end={l.to === "/"}
                            viewTransition
                            className={({ isActive }) => `${css.link} ${isActive ? css.active : ""}`}
                        >
                            {l.label}
                        </NavLink>
                    ))}
                </nav>

                <div className={css.right}>
                    {/* Device Viewport Switcher (Requested by User!) */}
                    <div className={css.deviceToggle} role="group" aria-label="Device Viewport Switcher">
                        <button
                            className={`${css.deviceOption} ${deviceMode === "desktop" ? css.deviceOptionActive : ""}`}
                            onClick={() => setDeviceMode("desktop")}
                            title="Desktop View (set_device_view: desktop)"
                            aria-label="Desktop View"
                        >
                            <span aria-hidden="true">🖥️</span>
                            <span className={css.deviceLabel}>Desktop</span>
                        </button>
                        <button
                            className={`${css.deviceOption} ${deviceMode === "mobile" ? css.deviceOptionActive : ""}`}
                            onClick={() => setDeviceMode("mobile")}
                            title="Mobile Frame View (set_device_view: mobile)"
                            aria-label="Mobile Frame View"
                        >
                            <span aria-hidden="true">📱</span>
                            <span className={css.deviceLabel}>Mobile</span>
                        </button>
                    </div>

                    <LiveCount />

                    <button
                        id="agent-toggle"
                        className={`btn btn-primary ${css.agentBtn}`}
                        onClick={toggleDock}
                        aria-expanded={dockOpen}
                        aria-controls="agent-dock"
                    >
                        <span className={css.spark} aria-hidden="true">
                            ✦
                        </span>
                        {dockOpen ? "Hide agent" : "Ask agent"}
                    </button>
                </div>
            </header>

            {/* Viewport: Either standard desktop layout or mobile device chassis */}
            {deviceMode === "mobile" ? (
                <div className={css.phoneStage}>
                    <div className={css.phoneChassis}>
                        <div className={css.phoneNotch} aria-hidden="true">
                            <div className={css.phoneSpeaker} />
                            <div className={css.phoneCamera} />
                        </div>
                        <div className={css.phoneScreen}>
                            <main id="main" className={css.phoneMain}>
                                <Outlet />
                            </main>
                        </div>
                        <div className={css.phoneHomeBar} aria-hidden="true" />
                    </div>
                </div>
            ) : (
                <main id="main" className={css.main}>
                    <Outlet />
                </main>
            )}

            {/* Mobile bottom tab bar */}
            <nav className={css.tabbar} aria-label="Primary mobile">
                <NavLink
                    to="/"
                    end
                    viewTransition
                    className={({ isActive }) => `${css.tabItem} ${isActive ? css.tabActive : ""}`}
                >
                    <Icon d={LINKS[0].icon} />
                    <span>Studio</span>
                </NavLink>

                <NavLink
                    to="/journey"
                    viewTransition
                    className={({ isActive }) => `${css.tabItem} ${isActive ? css.tabActive : ""}`}
                >
                    <Icon d={LINKS[1].icon} />
                    <span>Quest</span>
                </NavLink>

                <NavLink
                    to="/pass"
                    viewTransition
                    className={({ isActive }) => `${css.tabItem} ${isActive ? css.tabActive : ""}`}
                >
                    <Icon d={LINKS[2].icon} />
                    <span>Pass</span>
                </NavLink>

                <button className={css.tabAgent} onClick={toggleDock} aria-expanded={dockOpen} aria-controls="agent-dock">
                    <span className={css.tabAgentOrb} aria-hidden="true">
                        ✦
                    </span>
                    <span>Agent</span>
                </button>

                <NavLink
                    to="/stickers"
                    viewTransition
                    className={({ isActive }) => `${css.tabItem} ${isActive ? css.tabActive : ""}`}
                >
                    <Icon d={LINKS[2].icon} />
                    <span>Blend</span>
                </NavLink>

                <NavLink
                    to="/inspector"
                    viewTransition
                    className={({ isActive }) => `${css.tabItem} ${isActive ? css.tabActive : ""}`}
                >
                    <Icon d={LINKS[3].icon} />
                    <span>Tools</span>
                </NavLink>
            </nav>

            <ToolCallBanner />
            <AgentDock open={dockOpen} onClose={closeDock} />
        </div>
    )
}

App.serverSideFunction = () => {
    return new Promise((resolve) => resolve())
}

export default App

import React from "react"
import { useLocation } from "catalyst-core"
import { useNativeTransition } from "catalyst-core/hooks"

/**
 * Shell-only bottom tab bar — the Companion's persistent navigation. Rendered
 * on every shell screen (HubLayout + the top-level /app route). Switching tabs
 * runs through useNativeTransition so it feels like a native tab swap, and
 * uses replace so tabs never stack up in history.
 *
 * Styling lives in hub.scss as global classes (not a CSS module) so the
 * .shell-only display override can special-case the flex layout.
 */
const TABS = [
    {
        id: "home",
        to: "/app",
        label: "Home",
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 10.5 12 3l9 7.5" />
                <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
            </svg>
        ),
    },
    {
        id: "try",
        to: "/try",
        label: "Try",
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="m10 8.5 6 3.5-6 3.5V8.5Z" />
            </svg>
        ),
    },
    {
        id: "showcase",
        to: "/showcase",
        label: "Showcase",
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
        ),
    },
    {
        id: "docs",
        to: "/content/Introduction/why-catalyst",
        label: "Docs",
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H5.5A1.5 1.5 0 0 0 4 19.5v-15Z" />
                <path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H19" />
            </svg>
        ),
    },
]

const activeIdFor = (pathname) => {
    if (pathname === "/app") {
        return "home"
    }
    if (pathname.startsWith("/try")) {
        return "try"
    }
    if (pathname.startsWith("/showcase")) {
        return "showcase"
    }
    if (pathname.startsWith("/content") || pathname === "/") {
        return "docs"
    }
    return null
}

const BottomNav = () => {
    const location = useLocation()
    const { navigate } = useNativeTransition({ type: "slide", duration: 280 })

    const activeId = activeIdFor(location.pathname)
    const fromIndex = TABS.findIndex((tab) => tab.id === activeId)

    const onTab = (tab, toIndex) => {
        if (tab.id === activeId) {
            return
        }
        // Direction mirrors the tab order so the slide matches the visual
        // left-to-right position of the destination tab.
        const direction = toIndex >= fromIndex ? "right" : "left"
        navigate(tab.to, { direction, replace: true })
    }

    return (
        <nav className="shell-only hub-bottom-nav" aria-label="Sections">
            {TABS.map((tab, index) => {
                const isActive = tab.id === activeId
                return (
                    <button
                        key={tab.id}
                        type="button"
                        className={`hub-bottom-nav-item ${isActive ? "active" : ""}`}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => onTab(tab, index)}
                    >
                        <span className="hub-bottom-nav-icon">{tab.icon}</span>
                        <span className="hub-bottom-nav-label">{tab.label}</span>
                    </button>
                )
            })}
        </nav>
    )
}

export default BottomNav

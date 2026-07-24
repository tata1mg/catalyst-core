import React, { useState } from "react"
import { Link } from "catalyst-core"
import { useTheme } from "../docs/ThemeContext"
import SearchModal from "./SearchModal"

/**
 * Hub navbar — ported from the docs site's navbar config, plus the two new
 * Hub items (Showcase, Try Your Own App).
 */
const COMMUNITY_ITEMS = [
    { label: "Conferences", to: "/content/conferences" },
    { label: "Discord", href: "https://discord.gg/GTzYzP8X6s" },
    { label: "X (formerly Twitter)", href: "https://x.com/Catalyst448356" },
    { label: "GitHub Community", href: "https://github.com/tata1mg/catalyst-core/discussions" },
]

const Navbar = ({ onToggleSidebar, hasSidebar }) => {
    const { theme, toggleTheme } = useTheme()
    const [searchOpen, setSearchOpen] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)
    const [communityOpen, setCommunityOpen] = useState(false)

    const closeMenu = () => setMenuOpen(false)

    React.useEffect(() => {
        const onKey = (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault()
                setSearchOpen(true)
            }
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [])

    return (
        <nav className="hub-navbar">
            {hasSidebar && (
                <button className="hub-navbar-burger docs-only" onClick={onToggleSidebar} aria-label="Toggle sidebar">
                    ☰
                </button>
            )}
            <Link to="/" className="hub-navbar-brand" onClick={closeMenu}>
                <img src="/img/logo-light.svg" alt="catalyst logo" className="hub-logo hub-logo-light" />
                <img src="/img/logo-dark.svg" alt="catalyst logo" className="hub-logo hub-logo-dark" />
                <span>Catalyst</span>
            </Link>

            <button
                className="hub-navbar-burger hub-menu-toggle"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label="Toggle navigation"
            >
                {menuOpen ? "✕" : "☰"}
            </button>

            <div className={`hub-navbar-items ${menuOpen ? "open" : ""}`}>
                {/* Companion users enter at /app; this is their only persistent
                    route home from the docs. Hidden on the web (shell-only). */}
                <Link to="/app" className="shell-only" onClick={closeMenu}>
                    App Home
                </Link>
                <Link to="/content/Introduction/why-catalyst" onClick={closeMenu}>
                    Documentation
                </Link>
                <a href="/#features" onClick={closeMenu}>
                    Features
                </a>
                <div className={`hub-dropdown ${communityOpen ? "open" : ""}`}>
                    <button onClick={() => setCommunityOpen(!communityOpen)} aria-expanded={communityOpen}>
                        Community ▾
                    </button>
                    <div className="hub-dropdown-menu">
                        {COMMUNITY_ITEMS.map((item) =>
                            item.to ? (
                                <Link key={item.label} to={item.to} onClick={closeMenu}>
                                    {item.label}
                                </Link>
                            ) : (
                                <a key={item.label} href={item.href} target="_blank" rel="noreferrer">
                                    {item.label}
                                </a>
                            )
                        )}
                    </div>
                </div>
                <Link to="/content/contribution" onClick={closeMenu}>
                    Contribute
                </Link>
            </div>

            <div className="hub-navbar-right">
                <button className="hub-navbar-search" onClick={() => setSearchOpen(true)} aria-label="Search">
                    <span className="hub-search-icon">⌕</span>
                    <span className="hub-search-label">Search documentation…</span>
                    <kbd className="hub-search-kbd">⌘K</kbd>
                </button>
                <button className="hub-theme-toggle" onClick={toggleTheme} aria-label="Toggle dark mode">
                    {theme === "dark" ? "☀" : "☾"}
                </button>
                <a
                    href="https://github.com/tata1mg/catalyst-core"
                    className="hub-github-link"
                    aria-label="GitHub repository"
                    target="_blank"
                    rel="noreferrer"
                >
                    GitHub
                </a>
            </div>

            <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
        </nav>
    )
}

export default Navbar

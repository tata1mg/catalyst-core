import React, { useState } from 'react'
import { Link } from 'catalyst-core'
import { useTheme } from './docs/ThemeContext'
import SearchModal from './SearchModal'

/**
 * Site navbar. Docs pages are routes in this app, so they are Links again —
 * the Companion copy this came from had to point at a remote URL.
 */
const COMMUNITY_ITEMS = [
    { label: 'Conferences', to: '/content/conferences' },
    { label: 'Discord', href: 'https://discord.gg/GTzYzP8X6s' },
    { label: 'X (formerly Twitter)', href: 'https://x.com/Catalyst448356' },
    {
        label: 'GitHub Community',
        href: 'https://github.com/tata1mg/catalyst-core/discussions',
    },
]

const IconMenu = () => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
    >
        <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
)

const IconClose = () => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
    >
        <path d="M6 6l12 12M18 6 6 18" />
    </svg>
)

const IconSearch = () => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
    >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
    </svg>
)

const IconSun = () => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7" />
    </svg>
)

const IconMoon = () => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <path d="M20.3 14.6A8.5 8.5 0 0 1 9.4 3.7a8.5 8.5 0 1 0 10.9 10.9Z" />
    </svg>
)

const IconChevronDown = () => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <path d="m6 9 6 6 6-6" />
    </svg>
)

const Navbar = ({ onToggleSidebar, hasSidebar }) => {
    const { theme, toggleTheme } = useTheme()
    const [searchOpen, setSearchOpen] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)
    const [communityOpen, setCommunityOpen] = useState(false)

    const closeMenu = () => setMenuOpen(false)

    React.useEffect(() => {
        const onKey = (event) => {
            if (
                (event.metaKey || event.ctrlKey) &&
                event.key.toLowerCase() === 'k'
            ) {
                event.preventDefault()
                setSearchOpen(true)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    return (
        <nav className="hub-navbar">
            {hasSidebar && (
                <button
                    className="hub-navbar-burger docs-only"
                    onClick={onToggleSidebar}
                    aria-label="Toggle sidebar"
                >
                    <IconMenu />
                </button>
            )}
            <Link to="/" className="hub-navbar-brand" onClick={closeMenu}>
                <img
                    src="/img/logo-light.svg"
                    alt="catalyst logo"
                    className="hub-logo hub-logo-light"
                />
                <img
                    src="/img/logo-dark.svg"
                    alt="catalyst logo"
                    className="hub-logo hub-logo-dark"
                />
                <span>Catalyst</span>
            </Link>

            <button
                className="hub-navbar-burger hub-menu-toggle"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label="Toggle navigation"
                aria-expanded={menuOpen}
            >
                {menuOpen ? <IconClose /> : <IconMenu />}
            </button>

            <div className={`hub-navbar-items ${menuOpen ? 'open' : ''}`}>
                <Link
                    to="/content/Introduction/why-catalyst"
                    onClick={closeMenu}
                >
                    Documentation
                </Link>
                <a href="/#features" onClick={closeMenu}>
                    Features
                </a>
                <div className={`hub-dropdown ${communityOpen ? 'open' : ''}`}>
                    <button
                        onClick={() => setCommunityOpen(!communityOpen)}
                        aria-expanded={communityOpen}
                    >
                        Community
                        <span className="hub-dropdown-caret">
                            <IconChevronDown />
                        </span>
                    </button>
                    <div className="hub-dropdown-menu">
                        {COMMUNITY_ITEMS.map((item) =>
                            item.to ? (
                                <Link
                                    key={item.label}
                                    to={item.to}
                                    onClick={closeMenu}
                                >
                                    {item.label}
                                </Link>
                            ) : (
                                <a
                                    key={item.label}
                                    href={item.href}
                                    target="_blank"
                                    rel="noreferrer"
                                >
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
                <button
                    className="hub-navbar-search"
                    onClick={() => setSearchOpen(true)}
                    aria-label="Search"
                >
                    <span className="hub-search-icon">
                        <IconSearch />
                    </span>
                    <span className="hub-search-label">
                        Search documentation…
                    </span>
                    <kbd className="hub-search-kbd">⌘K</kbd>
                </button>
                <button
                    className="hub-theme-toggle"
                    onClick={toggleTheme}
                    aria-label="Toggle dark mode"
                >
                    {theme === 'dark' ? <IconSun /> : <IconMoon />}
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

            <SearchModal
                open={searchOpen}
                onClose={() => setSearchOpen(false)}
            />
        </nav>
    )
}

export default Navbar

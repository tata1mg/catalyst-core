import React, { useState, useEffect } from 'react'
import clsx from 'clsx'
import styles from './styles.module.css'

const AppShellDemo = () => {
    const [isLoading, setIsLoading] = useState(true)
    const [currentPage, setCurrentPage] = useState('home')
    const [copiedCode, setCopiedCode] = useState('')

    // Copy to clipboard function
    const copyToClipboard = async (text, codeType) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopiedCode(codeType)
            setTimeout(() => setCopiedCode(''), 2000)
        } catch (err) {
            console.error('Failed to copy: ', err)
        }
    }

    // Code examples
    const appShellCode = `import React from "react"
import { Outlet } from "@tata1mg/router"

const App = () => {
    return (
        <div className="app-shell">
            <header className="app-header">
                <div className="logo">Catalyst</div>
                <nav className="navigation">
                    {/* Navigation links */}
                </nav>
            </header>
            
            <main className="app-content">
                <Outlet />
            </main>
            
            <footer className="app-footer">
                {/* Footer content */}
            </footer>
        </div>
    )
}

App.serverSideFunction = ({store, req, res}) => {
    // Runs on every page request
    return new Promise((resolve) => resolve())
}

export default App`

    const pageComponentCode = `import React from "react"

const Home = () => {
    return (
        <div>
            <h1>Welcome to Home Page</h1>
            <p>This content is rendered inside the App Shell</p>
        </div>
    )
}

Home.serverFetcher = async () => {
    // Fetch data for this specific page
    const data = await fetch('/api/home-data')
    return data.json()
}

export default Home`

    useEffect(() => {
        // Simulate loading
        const timer = setTimeout(() => {
            setIsLoading(false)
        }, 2000)

        return () => clearTimeout(timer)
    }, [])

    const handlePageChange = (page) => {
        setIsLoading(true)
        setCurrentPage(page)

        // Simulate page loading
        setTimeout(() => {
            setIsLoading(false)
        }, 1000)
    }

    const pages = {
        home: {
            title: 'Home',
            content:
                'Welcome to our application! This is the home page content.',
        },
        about: {
            title: 'About',
            content:
                'Learn more about our company and mission. This is the about page content.',
        },
        contact: {
            title: 'Contact',
            content: 'Get in touch with us. This is the contact page content.',
        },
    }

    return (
        <div className={styles.appShellDemo}>
            <div className={styles.demoContent}>
                <div className={styles.benefits}>
                    <h2>App Shell Benefits</h2>
                    <div className={styles.benefitsGrid}>
                        <div className={styles.benefit}>
                            <h4>🚀 Fast Loading</h4>
                            <p>
                                Navigation and shell load instantly, only
                                content changes
                            </p>
                        </div>
                        <div className={styles.benefit}>
                            <h4>🔄 Persistent UI</h4>
                            <p>
                                Header, navigation, and footer remain stable
                                during navigation
                            </p>
                        </div>
                        <div className={styles.benefit}>
                            <h4>⚡ Better UX</h4>
                            <p>
                                Users see immediate feedback and familiar
                                interface
                            </p>
                        </div>
                    </div>
                </div>

                <h2>App Shell Implementation</h2>
                <p>
                    This example demonstrates how Catalyst implements the App
                    Shell pattern to provide a fast, reliable loading experience
                    with persistent navigation and content loading.
                </p>

                <div className={styles.appShellExample}>
                    <div className={styles.shellHeader}>
                        <div className={styles.logo}>Catalyst</div>
                        <nav className={styles.nav}>
                            <button
                                className={clsx(styles.navLink, {
                                    [styles.active]: currentPage === 'home',
                                })}
                                onClick={() => handlePageChange('home')}
                            >
                                Home
                            </button>
                            <button
                                className={clsx(styles.navLink, {
                                    [styles.active]: currentPage === 'about',
                                })}
                                onClick={() => handlePageChange('about')}
                            >
                                About
                            </button>
                            <button
                                className={clsx(styles.navLink, {
                                    [styles.active]: currentPage === 'contact',
                                })}
                                onClick={() => handlePageChange('contact')}
                            >
                                Contact
                            </button>
                        </nav>
                    </div>

                    <div className={styles.shellContent}>
                        {isLoading ? (
                            <div className={styles.contentPlaceholder}>
                                <div className={styles.loadingSkeleton}>
                                    <div className={styles.skeletonLine}></div>
                                    <div className={styles.skeletonLine}></div>
                                    <div className={styles.skeletonLine}></div>
                                </div>
                                <p>
                                    App Shell loads instantly while content
                                    loads in background
                                </p>
                            </div>
                        ) : (
                            <div className={styles.pageContent}>
                                <h3>{pages[currentPage].title}</h3>
                                <p>{pages[currentPage].content}</p>
                                <div className={styles.contentInfo}>
                                    <strong>Current Page:</strong>{' '}
                                    {pages[currentPage].title}
                                    <br />
                                    <strong>Loading State:</strong>{' '}
                                    {isLoading ? 'Loading...' : 'Loaded'}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className={styles.shellFooter}>
                        <p>Footer content - Always visible in App Shell</p>
                    </div>
                </div>

                <div className={styles.codeExample}>
                    <h3>Code Example</h3>
                    <div className={styles.codeBlock}>
                        <div className={styles.codeHeader}>
                            <h4>
                                App Shell Structure
                                (src/js/containers/App/index.js)
                            </h4>
                            <button
                                onClick={() =>
                                    copyToClipboard(appShellCode, 'appShell')
                                }
                                className={clsx(styles.copyButton, {
                                    [styles.copied]: copiedCode === 'appShell',
                                })}
                            >
                                {copiedCode === 'appShell'
                                    ? '✓ Copied!'
                                    : '📋 Copy'}
                            </button>
                        </div>
                        <pre>{appShellCode}</pre>
                    </div>

                    <div className={styles.codeBlock}>
                        <div className={styles.codeHeader}>
                            <h4>Page Component (src/js/pages/Home/Home.js)</h4>
                            <button
                                onClick={() =>
                                    copyToClipboard(
                                        pageComponentCode,
                                        'pageComponent'
                                    )
                                }
                                className={clsx(styles.copyButton, {
                                    [styles.copied]:
                                        copiedCode === 'pageComponent',
                                })}
                            >
                                {copiedCode === 'pageComponent'
                                    ? '✓ Copied!'
                                    : '📋 Copy'}
                            </button>
                        </div>
                        <pre>{pageComponentCode}</pre>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default AppShellDemo

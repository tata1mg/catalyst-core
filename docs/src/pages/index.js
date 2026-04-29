import React from 'react'
import clsx from 'clsx'
import Layout from '@theme/Layout'
import Link from '@docusaurus/Link'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import CopyButton from '@site/src/components/CopyButton'
import styles from './index.module.css'

const features = [
    {
        title: 'SSR Framework',
        icon: 'server',
        description:
            'Render dynamic pages on the server with predictable performance and better discoverability for content-heavy experiences.',
    },
    {
        title: 'Performance',
        icon: 'speed',
        description:
            'Optimize load time through intelligent JS/CSS injection, fine-grained delivery, and SEO-friendly rendering defaults.',
    },
    {
        title: 'Customizable',
        icon: 'settings',
        description:
            'Start with zero-config defaults, then extend quickly with integrations and production-ready out-of-the-box capabilities.',
    },
    {
        title: 'Data Fetching',
        icon: 'data',
        description:
            'Unify server and client fetching patterns so teams can build reliable data workflows at scale.',
    },
    {
        title: 'Route Management',
        icon: 'routes',
        description:
            'Handle nested routes, dynamic parameters, and transitions with a clean and maintainable routing model.',
    },
    {
        title: 'Universal Apps',
        icon: 'devices',
        description:
            'Ship Web, iOS, and Android experiences from one shared React codebase without fragmenting your architecture.',
    },
]

function FeatureIcon({ type }) {
    const icons = {
        server: <path d="M4 7h16M4 12h16M4 17h16M7 7v10M17 7v10" />,
        speed: (
            <>
                <path d="M6 14a6 6 0 1 1 12 0" />
                <path d="M12 14l3-3" />
                <path d="M12 18h.01" />
            </>
        ),
        settings: (
            <>
                <path d="M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" />
                <path d="M19 12h-1.2a5.8 5.8 0 0 0-.35-1.1l.84-.84-1.4-1.4-.84.84a5.8 5.8 0 0 0-1.1-.35V8h-2v1.2a5.8 5.8 0 0 0-1.1.35l-.84-.84-1.4 1.4.84.84c-.16.35-.28.72-.35 1.1H5v2h1.2c.07.38.19.75.35 1.1l-.84.84 1.4 1.4.84-.84c.35.16.72.28 1.1.35V20h2v-1.2c.38-.07.75-.19 1.1-.35l.84.84 1.4-1.4-.84-.84c.16-.35.28-.72.35-1.1H19v-2Z" />
            </>
        ),
        data: (
            <>
                <path d="M4 8c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2Z" />
                <path d="M4 8v4c0 1.1 3.6 2 8 2s8-.9 8-2V8" />
                <path d="M4 12v4c0 1.1 3.6 2 8 2s8-.9 8-2v-4" />
            </>
        ),
        routes: (
            <>
                <path d="M5 6h4v4H5zM15 14h4v4h-4z" />
                <path d="M9 8h3a2 2 0 0 1 2 2v4" />
                <path d="M14 14h1" />
            </>
        ),
        devices: (
            <>
                <path d="M4 7h12v8H4z" />
                <path d="M8 17h4" />
                <path d="M17 9h3v8h-3z" />
            </>
        ),
    }

    return (
        <svg
            viewBox="0 0 24 24"
            className={styles.featureIconSvg}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {icons[type]}
        </svg>
    )
}

function Feature({ title, icon, description }) {
    return (
        <div className={styles.feature}>
            <div className={styles.featureIcon} aria-hidden="true">
                <FeatureIcon type={icon} />
            </div>
            <h3 className={styles.featureTitle}>{title}</h3>
            <p className={styles.featureDescription}>{description}</p>
        </div>
    )
}

function HomepageHero() {
    return (
        <header className={styles.hero}>
            {/* Animated background */}
            <div className={styles.heroBackground}>
                <div className={`${styles.heroOrb} ${styles.heroOrb1}`} />
                <div className={`${styles.heroOrb} ${styles.heroOrb2}`} />
                <div className={`${styles.heroOrb} ${styles.heroOrb3}`} />
                <div className={`${styles.heroOrb} ${styles.heroOrb4}`} />
            </div>
            <div className={styles.heroContent}>
                <div className={styles.heroText}>
                    <div className={styles.heroBadge}>Powered by Tata 1mg</div>
                    <h1 className={styles.heroTitle}>
                        One React Codebase for
                        <br />
                        <span className={styles.heroHighlight}>
                            Web, iOS, and Android
                        </span>
                    </h1>
                    <p className={styles.heroSubtitle}>
                        Build cross-platform applications with native device
                        capabilities, server-side rendering, and blazing-fast
                        performance from a single codebase.
                    </p>
                    <div className={styles.heroCta}>
                        <Link
                            className={clsx(
                                'button button--primary button--lg',
                                styles.ctaPrimary
                            )}
                            to="/content/Introduction/getting-started"
                        >
                            Get Started
                        </Link>
                        <Link
                            className={clsx(
                                'button button--secondary button--lg',
                                styles.ctaSecondary
                            )}
                            to="https://github.com/tata1mg/catalyst-core"
                        >
                            GitHub
                        </Link>
                    </div>
                    <div className={styles.heroInstall}>
                        <code>npx create-catalyst-app@latest</code>
                        <CopyButton text="npx create-catalyst-app@latest" />
                    </div>
                </div>
                <div className={styles.heroTerminal}>
                    <div className={styles.terminalWindow}>
                        <div className={styles.terminalHeader}>
                            <span className={styles.terminalDot} />
                            <span className={styles.terminalDot} />
                            <span className={styles.terminalDot} />
                            <span className={styles.terminalTitle}>
                                Terminal
                            </span>
                        </div>
                        <div className={styles.terminalBody}>
                            <div className={styles.terminalLine}>
                                <span className={styles.terminalPrompt}>$</span>
                                <span className={styles.terminalCommand}>
                                    npm run start
                                </span>
                                <span className={styles.terminalLabel}>
                                    Web
                                </span>
                            </div>
                            <div className={styles.terminalLine}>
                                <span className={styles.terminalPrompt}>$</span>
                                <span className={styles.terminalCommand}>
                                    npm run buildApp:android
                                </span>
                                <span className={styles.terminalLabel}>
                                    Android
                                </span>
                            </div>
                            <div className={styles.terminalLine}>
                                <span className={styles.terminalPrompt}>$</span>
                                <span className={styles.terminalCommand}>
                                    npm run buildApp:ios
                                </span>
                                <span className={styles.terminalLabel}>
                                    iOS
                                </span>
                            </div>
                            <div className={styles.terminalOutput}>
                                Build successful! Your app is ready.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </header>
    )
}

function FeaturesSection() {
    return (
        <section id="features" className={styles.features}>
            <div className="container">
                <h2 className={styles.sectionTitle}>Features</h2>
                <div className={styles.featuresGrid}>
                    {features.map((feature, idx) => (
                        <Feature key={idx} {...feature} />
                    ))}
                </div>
            </div>
        </section>
    )
}

function UniversalSection() {
    return (
        <section className={styles.universalSection}>
            <div className="container">
                <h2 className={styles.sectionTitle}>
                    One Codebase. Every Platform.
                </h2>
                <p className={styles.sectionSubtitle}>
                    Build and scale with one shared architecture across web and
                    native touchpoints. Catalyst helps teams ship faster while
                    keeping platform behavior consistent, maintainable, and
                    production-ready.
                </p>
                <div className={styles.platformGrid}>
                    <div className={styles.platformCard}>
                        <div className={styles.platformIcon}>Web</div>
                        <p>
                            Server-side rendering, code splitting, and SEO
                            readiness for high-performing experiences.
                        </p>
                    </div>
                    <div className={styles.platformCard}>
                        <div className={styles.platformIcon}>iOS</div>
                        <p>
                            Native APIs, notifications, camera access, and
                            device capabilities through a unified interface.
                        </p>
                    </div>
                    <div className={styles.platformCard}>
                        <div className={styles.platformIcon}>Android</div>
                        <p>
                            Flexible native integrations with camera, storage,
                            and platform-specific extensions.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    )
}

function HomepageFooter() {
    return (
        <footer className={styles.footer}>
            <div className="container">
                <div className={styles.footerContent}>
                    <div className={styles.footerBrand}>
                        <picture>
                            <source
                                media="(prefers-color-scheme: dark)"
                                srcSet="https://onemg.gumlet.io/staging/7ee66dfb-b5fb-4fbe-8dea-789685e45f7a.svg"
                            />
                            <img
                                src="https://onemg.gumlet.io/staging/2fdb0975-8f51-4fd1-bd7d-6375d793f581.svg"
                                width="160px"
                                alt="Catalyst Logo"
                                className={styles.footerLogo}
                            />
                        </picture>
                        <p className={styles.footerTagline}>
                            Universal React framework for Web, iOS, and Android.
                        </p>
                    </div>

                    <div className={styles.footerLinks}>
                        {/* Newsletter temporarily disabled.
                        <div className={styles.footerLinkColumn}>
                            <h4>Newsletter</h4>
                            <p className={styles.newsletterText}>
                                Product updates, release notes, and best
                                practices in your inbox.
                            </p>
                            <form
                                className={styles.newsletterForm}
                                onSubmit={handleSubscribe}
                            >
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="you@company.com"
                                    aria-label="Email address"
                                    className={styles.newsletterInput}
                                />
                                <button
                                    type="submit"
                                    className={styles.newsletterButton}
                                >
                                    Subscribe
                                </button>
                            </form>
                            {status && (
                                <p className={styles.newsletterStatus}>
                                    {status}
                                </p>
                            )}
                        </div>
                        */}
                        <div className={styles.footerLinkColumn}>
                            <h4>Docs</h4>
                            <Link to="/content/Introduction/getting-started">
                                Getting Started
                            </Link>
                            <Link to="/content/data-fetching">
                                Data Fetching
                            </Link>
                            <Link to="/content/Introduction/universal-app">
                                Universal App
                            </Link>
                        </div>
                        <div className={styles.footerLinkColumn}>
                            <h4>Community</h4>
                            <Link href="https://github.com/tata1mg/catalyst-core">
                                GitHub
                            </Link>
                            <Link href="https://discord.gg/GTzYzP8X6s">
                                Discord
                            </Link>
                            <Link href="https://www.npmjs.com/package/catalyst-core">
                                npm
                            </Link>
                            <Link href="mailto:catalyst-core@1mg.com">
                                Contact
                            </Link>
                        </div>
                    </div>
                </div>

                <div className={styles.footerBottom}>
                    <p>© 2026 Catalyst Framework. Built by 1mg.</p>
                </div>
            </div>
        </footer>
    )
}

export default function Home() {
    const { siteConfig } = useDocusaurusContext()
    return (
        <Layout
            title="Catalyst - Universal React Framework for Web, iOS, and Android"
            description="Build cross-platform applications with native device capabilities, server-side rendering, and blazing-fast performance from a single React codebase."
        >
            <div className={styles.pageWrapper}>
                <HomepageHero />
                <main>
                    <FeaturesSection />
                    <UniversalSection />
                </main>
                <HomepageFooter />
            </div>
        </Layout>
    )
}

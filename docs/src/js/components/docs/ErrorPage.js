import React, { useCallback, useState } from 'react'
import { useCurrentRouteData, useParams, Link } from 'catalyst-core'
import DocsSidebar from './DocsSidebar'
import ErrorsUnavailable from './ErrorsUnavailable'
import { loadErrorsCatalog, githubBlobUrlFor } from '../../data/errorsCatalog'

/**
 * One error code's page — `/errors/:category/:code`.
 *
 * `serverFetcher` runs on a direct hit (the shape a developer reaches by
 * following a `Docs:` link printed in their terminal); `clientFetcher` runs on
 * in-app navigation. Both return the same `{ catalog }` / `{ unavailable }`
 * sentinel from loadErrorsCatalog, so the render states below are identical
 * across SSR and CSR. The docs sidebar stays put — the Error reference group
 * inside it is handed the same catalog so it needs no fetch of its own.
 */

const Field = ({ label, children }) =>
    children ? (
        <section className="error-field">
            <h2>{label}</h2>
            <p>{children}</p>
        </section>
    ) : null

const Skeleton = () => (
    <div className="error-article-skeleton" aria-hidden="true">
        <div className="errors-skeleton-row w-40" />
        <div className="errors-skeleton-row w-70" />
        <div className="errors-skeleton-row w-90" />
        <div className="errors-skeleton-row w-60" />
    </div>
)

const ErrorPage = () => {
    const { category, code } = useParams()
    const { data, isFetching, refetch } = useCurrentRouteData()
    const [sidebarOpen, setSidebarOpen] = useState(false)

    const retry = useCallback(() => refetch && refetch(), [refetch])

    const catalog = data && data.ok ? data.catalog : null
    const unavailable = data && data.ok === false
    const entry = catalog ? catalog[code] : null

    return (
        <div className="docs-shell">
            <button
                className="docs-mobile-sidebar-toggle"
                onClick={() => setSidebarOpen(true)}
            >
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
                Menu
            </button>

            <DocsSidebar
                currentUrl={`/errors/${category}/${code}`}
                errorsCatalog={catalog}
                mobileOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
            />

            <div className="doc-main">
                <nav className="doc-breadcrumbs" aria-label="Breadcrumbs">
                    <Link to="/">Home</Link>
                    <span> › </span>
                    <Link to="/errors">Errors</Link>
                    <span> › {category}</span>
                    <span> › {code}</span>
                </nav>

                <article className="doc-article markdown-body">
                    {unavailable ? (
                        <ErrorsUnavailable
                            code={code}
                            category={category}
                            reason={data.reason}
                            onRetry={retry}
                        />
                    ) : isFetching || !data ? (
                        <Skeleton />
                    ) : !entry ? (
                        <div className="error-unknown-code" role="alert">
                            <h1>{code}</h1>
                            <p>
                                No error with this code is in the catalog. It may
                                be from a newer or older version of Catalyst, or
                                the code in the link is wrong.
                            </p>
                            <p>
                                <Link to="/errors">Browse all error codes</Link>
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="error-page-header">
                                <h1>{code}</h1>
                                <span className="error-category-badge">
                                    {entry.category}
                                </span>
                            </div>
                            <p className="error-headline">{entry.message}</p>
                            <Field label="Details">{entry.details}</Field>
                            <Field label="Suggested action">
                                {entry.suggestedAction}
                            </Field>
                            <p className="error-source-link">
                                <a
                                    href={githubBlobUrlFor(entry.category, code)}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    View this doc on GitHub
                                </a>
                            </p>
                        </>
                    )}
                </article>
            </div>
        </div>
    )
}

// RouterDataProvider.fetchRouteData only picks up a route's fetcher when the
// route component is a loadable (has a `.load()` that resolves a module). A
// plain `component:` reference is skipped. We use synchronous imports for
// these pages (matching the docs app's deliberate no-split posture — see
// generate-docs-manifest.mjs), so shim `.load()` to hand back this module.
ErrorPage.load = () => Promise.resolve({ default: ErrorPage })

const fetchData = async ({ params } = {}) => {
    const res = await loadErrorsCatalog()
    // Echo the requested code back so setMetaData (which is handed the fetcher
    // data map, not the route match) can title the page.
    const code = params?.code
    return res.ok
        ? { ok: true, catalog: res.data, code }
        : { ok: false, reason: res.reason, status: res.status, code }
}

ErrorPage.serverFetcher = fetchData
ErrorPage.clientFetcher = fetchData

// getMetaData passes the whole route-keyed fetcher-data map. Find our entry by
// the `code` the fetcher stamped on it.
ErrorPage.setMetaData = (routeData) => {
    const entry = Object.values(routeData || {}).find((d) => d?.data?.code)
    const code = entry?.data?.code || 'Error'
    return [
        <title key="title">{`${code} | Catalyst Errors`}</title>,
        <meta
            key="description"
            name="description"
            content={`Reference for Catalyst framework error ${code === 'Error' ? '' : code}.`.trim()}
        />,
    ]
}

export default ErrorPage

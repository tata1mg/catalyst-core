import React, { useCallback, useMemo, useState } from 'react'
import { useCurrentRouteData, Link } from 'catalyst-core'
import DocsSidebar from './DocsSidebar'
import ErrorsUnavailable from './ErrorsUnavailable'
import { loadErrorsCatalog, groupByCategory } from '../../data/errorsCatalog'

/**
 * `/errors` landing — the whole catalog, searchable and category-filterable,
 * grouped by category.
 *
 * The docs sidebar stays put; its Error reference group gets the fetched
 * catalog so it opens fully populated. Data comes from the live GitHub fetch
 * (serverFetcher on direct hit, clientFetcher on nav). Search + category
 * filter are client-only state over the in-memory catalog — SSR renders the
 * full list so a direct hit from a terminal link is complete and indexable.
 */

const Skeleton = () => (
    <div className="error-article-skeleton" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="errors-skeleton-row w-90" />
        ))}
    </div>
)

const textMatches = (code, entry, q) => {
    if (!q) return true
    const needle = q.toLowerCase()
    return (
        code.toLowerCase().includes(needle) ||
        entry.message.toLowerCase().includes(needle) ||
        (entry.details || '').toLowerCase().includes(needle)
    )
}

const FilterIcon = () => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <path d="M3 5h18M6 12h12M10 19h4" />
    </svg>
)

const ErrorsIndexPage = () => {
    const { data, isFetching, refetch } = useCurrentRouteData()
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [activeCategories, setActiveCategories] = useState([])
    const [filterOpen, setFilterOpen] = useState(false)

    const retry = useCallback(() => refetch && refetch(), [refetch])

    const catalog = data && data.ok ? data.catalog : null
    const unavailable = data && data.ok === false

    const allGroups = useMemo(
        () => (catalog ? groupByCategory(catalog) : []),
        [catalog]
    )

    const toggleCategory = (category) =>
        setActiveCategories((prev) =>
            prev.includes(category)
                ? prev.filter((c) => c !== category)
                : [...prev, category]
        )

    const filteredGroups = useMemo(() => {
        if (!catalog) return []
        return allGroups
            .filter(
                (g) =>
                    activeCategories.length === 0 ||
                    activeCategories.includes(g.category)
            )
            .map(({ category, codes }) => ({
                category,
                codes: codes.filter((code) =>
                    textMatches(code, catalog[code], query)
                ),
            }))
            .filter((g) => g.codes.length > 0)
    }, [allGroups, catalog, query, activeCategories])

    const hasFilters = query !== '' || activeCategories.length > 0

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
                currentUrl="/errors"
                errorsCatalog={catalog}
                mobileOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
            />

            <div className="doc-main">
                <nav className="doc-breadcrumbs" aria-label="Breadcrumbs">
                    <Link to="/">Home</Link>
                    <span> › Errors</span>
                </nav>

                <article className="doc-article markdown-body">
                    <h1>Error reference</h1>
                    <p>
                        Every coded error the Catalyst framework can emit. Each
                        entry is the same content shown by the <code>Docs:</code>{' '}
                        link printed alongside the error in your terminal.
                    </p>

                    {unavailable ? (
                        <ErrorsUnavailable reason={data.reason} onRetry={retry} />
                    ) : isFetching || !data ? (
                        <Skeleton />
                    ) : (
                        <>
                            <div className="errors-toolbar">
                                <input
                                    type="search"
                                    className="errors-search"
                                    placeholder="Search errors by code or message…"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    aria-label="Search errors"
                                />
                                <button
                                    type="button"
                                    className={`errors-filter-btn ${activeCategories.length ? 'has-active' : ''} ${filterOpen ? 'open' : ''}`}
                                    onClick={() => setFilterOpen((v) => !v)}
                                    aria-expanded={filterOpen}
                                    aria-label="Filter by category"
                                >
                                    <FilterIcon />
                                    Category
                                    {activeCategories.length > 0 && (
                                        <span className="errors-filter-dot" />
                                    )}
                                </button>
                            </div>

                            {filterOpen && (
                                <div
                                    className="errors-filter-panel"
                                    role="group"
                                    aria-label="Categories"
                                >
                                    {allGroups.map(({ category }) => (
                                        <label
                                            key={category}
                                            className="errors-filter-option"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={activeCategories.includes(
                                                    category
                                                )}
                                                onChange={() =>
                                                    toggleCategory(category)
                                                }
                                            />
                                            {category}
                                        </label>
                                    ))}
                                    {activeCategories.length > 0 && (
                                        <button
                                            type="button"
                                            className="errors-filter-clear"
                                            onClick={() =>
                                                setActiveCategories([])
                                            }
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                            )}

                            {activeCategories.length > 0 && (
                                <div className="errors-active-filters">
                                    {activeCategories.map((category) => (
                                        <button
                                            key={category}
                                            type="button"
                                            className="errors-active-chip"
                                            onClick={() =>
                                                toggleCategory(category)
                                            }
                                            aria-label={`Remove ${category} filter`}
                                        >
                                            {category} ×
                                        </button>
                                    ))}
                                </div>
                            )}

                            {filteredGroups.length === 0 ? (
                                <p className="errors-empty">
                                    {hasFilters
                                        ? 'No errors match your search.'
                                        : 'No errors in the catalog.'}
                                </p>
                            ) : (
                                filteredGroups.map(({ category, codes }) => (
                                    <section
                                        key={category}
                                        id={category}
                                        className="errors-category-block"
                                    >
                                        <h2>{category}</h2>
                                        <ul className="errors-code-list">
                                            {codes.map((code) => (
                                                <li key={code}>
                                                    <Link
                                                        to={`/errors/${category}/${code}`}
                                                    >
                                                        <span className="errors-code-msg">
                                                            {catalog[code].message}
                                                        </span>
                                                        <span className="errors-code">
                                                            {code}
                                                        </span>
                                                    </Link>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                ))
                            )}
                        </>
                    )}
                </article>
            </div>
        </div>
    )
}

// See ErrorPage — same loadable shim so the fetcher is picked up with a
// synchronous import.
ErrorsIndexPage.load = () => Promise.resolve({ default: ErrorsIndexPage })

const fetchData = async () => {
    const res = await loadErrorsCatalog()
    return res.ok
        ? { ok: true, catalog: res.data }
        : { ok: false, reason: res.reason, status: res.status }
}

ErrorsIndexPage.serverFetcher = fetchData
ErrorsIndexPage.clientFetcher = fetchData

ErrorsIndexPage.setMetaData = () => [
    <title key="title">Error reference | Catalyst</title>,
    <meta
        key="description"
        name="description"
        content="Every coded error the Catalyst framework can emit, with the cause and suggested fix for each."
    />,
]

export default ErrorsIndexPage

import React, { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "catalyst-core"
import manifest from "../../generated/docsManifest.json"

/**
 * In-browser docs search (same model as the docs site's local-search plugin):
 * the index is the build-time manifest; matching happens client-side.
 */
const search = (query) => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return []

    return manifest
        .map((page) => {
            const title = page.title.toLowerCase()
            const body = page.searchText.toLowerCase()
            let score = 0
            for (const term of terms) {
                if (title.includes(term)) score += 10
                else if (body.includes(term)) score += 1
                else return null
            }
            return { page, score }
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((entry) => entry.page)
}

const SearchModal = ({ open, onClose }) => {
    const [query, setQuery] = useState("")
    const [active, setActive] = useState(0)
    const inputRef = useRef(null)
    const results = useMemo(() => search(query), [query])

    useEffect(() => {
        if (open) {
            setQuery("")
            setActive(0)
            setTimeout(() => inputRef.current?.focus(), 0)
        }
    }, [open])

    useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
            if (event.key === "Escape") onClose()
            if (event.key === "ArrowDown") setActive((current) => Math.min(current + 1, results.length - 1))
            if (event.key === "ArrowUp") setActive((current) => Math.max(current - 1, 0))
            if (event.key === "Enter" && results[active]) {
                onClose()
                window.location.assign(results[active].url)
            }
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [open, results, active, onClose])

    if (!open) return null

    return (
        <div className="search-overlay" onClick={onClose} role="presentation">
            <div className="search-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Search documentation">
                <input
                    ref={inputRef}
                    className="search-input"
                    placeholder="Search documentation…"
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value)
                        setActive(0)
                    }}
                />
                <ul className="search-results">
                    {results.map((page, index) => (
                        <li key={page.url}>
                            <Link
                                to={page.url}
                                className={`search-result ${index === active ? "active" : ""}`}
                                onClick={onClose}
                            >
                                <span className="search-result-title">{page.title}</span>
                                <span className="search-result-path">
                                    {[...page.categories, ""].join(" › ")}
                                </span>
                            </Link>
                        </li>
                    ))}
                    {query && !results.length && <li className="search-empty">No results for “{query}”</li>}
                </ul>
            </div>
        </div>
    )
}

export default SearchModal

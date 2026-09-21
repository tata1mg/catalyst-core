import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { search } from '../search.js'

const SearchModal = ({ open, onClose }) => {
    const [query, setQuery] = useState('')
    const [active, setActive] = useState(0)
    const inputRef = useRef(null)
    const results = useMemo(() => search(query), [query])

    useEffect(() => {
        if (open) {
            setQuery('')
            setActive(0)
            setTimeout(() => inputRef.current?.focus(), 0)
        }
    }, [open])

    useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
            if (event.key === 'Escape') onClose()
            if (event.key === 'ArrowDown')
                setActive((current) =>
                    Math.min(current + 1, results.length - 1)
                )
            if (event.key === 'ArrowUp')
                setActive((current) => Math.max(current - 1, 0))
            if (event.key === 'Enter' && results[active]) {
                onClose()
                window.location.assign(results[active].url)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open, results, active, onClose])

    if (!open) return null

    // Portalled to <body> on purpose. The navbar that renders this sets
    // backdrop-filter, which makes it a containing block for fixed-position
    // descendants — inside it, `position: fixed; inset: 0` resolves against the
    // 60px navbar instead of the viewport, and no z-index escapes it.
    // Rendering nowhere during SSR is fine: the modal only ever opens from a
    // client-side click or ⌘K.
    if (typeof document === 'undefined') return null

    return createPortal(
        <div className="search-overlay" onClick={onClose} role="presentation">
            <div
                className="search-modal"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-label="Search documentation"
            >
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
                                className={`search-result ${index === active ? 'active' : ''}`}
                                onClick={onClose}
                            >
                                <span className="search-result-title">
                                    {page.title}
                                </span>
                                <span className="search-result-path">
                                    {[...page.categories, ''].join(' › ')}
                                </span>
                            </Link>
                        </li>
                    ))}
                    {query && !results.length && (
                        <li className="search-empty">
                            No results for “{query}”
                        </li>
                    )}
                </ul>
            </div>
        </div>,
        document.body
    )
}

export default SearchModal

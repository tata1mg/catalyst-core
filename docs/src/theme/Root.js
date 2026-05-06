import React, { useEffect } from 'react'
import { useHistory, useLocation } from '@docusaurus/router'

// Default implementation, that you can customize
export default function Root({ children }) {
    const history = useHistory()
    const location = useLocation()

    useEffect(() => {
        const handleKeyDown = (e) => {
            // Cmd+K (Mac) or Ctrl+K (Windows/Linux)
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault()
                // Target the search input from @cmfcmf/docusaurus-search-local
                const searchInput = document.querySelector(
                    '.dsla-search-field input, .aa-Input, .dsla-search-wrapper input'
                )
                if (searchInput) {
                    searchInput.focus()
                    searchInput.click()
                } else {
                    // Fallback: click on the search button/wrapper to open it
                    const searchButton = document.querySelector(
                        '.dsla-search-field button, .aa-DetachedSearchButton, .navbar__search-input'
                    )
                    if (searchButton) {
                        searchButton.click()
                    }
                }
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [])

    useEffect(() => {
        const prefersReducedMotion = window.matchMedia(
            '(prefers-reduced-motion: reduce)'
        ).matches
        const behavior = prefersReducedMotion ? 'auto' : 'smooth'
        const pendingHashKey = 'catalyst_pending_hash_scroll'

        const normalizePathname = (pathname) => {
            if (!pathname || pathname === '/') return '/'
            return pathname.replace(/\/+$/, '') || '/'
        }

        const getTargetFromHash = (hash) => {
            const rawId = hash.replace(/^#/, '')
            if (!rawId) return null
            const decodedId = decodeURIComponent(rawId)
            const byId = document.getElementById(decodedId)
            if (byId) return byId
            const byName = document.getElementsByName(decodedId)
            return byName.length ? byName[0] : null
        }

        const scrollToHash = (hash) => {
            const target = getTargetFromHash(hash)
            if (!target) return false
            target.scrollIntoView({ behavior, block: 'start' })
            return true
        }

        const handleAnchorClick = (event) => {
            const targetNode = event.target
            if (!(targetNode instanceof Element)) return
            const anchor = targetNode.closest('a[href*="#"]')
            if (!anchor) return

            const url = new URL(anchor.href, window.location.origin)
            if (url.origin !== window.location.origin || !url.hash) return
            event.preventDefault()

            const currentPath = normalizePathname(window.location.pathname)
            const targetPath = normalizePathname(url.pathname)

            if (currentPath === targetPath) {
                const didScroll = scrollToHash(url.hash)
                if (didScroll && window.location.hash !== url.hash) {
                    window.history.pushState(
                        null,
                        '',
                        `${window.location.pathname}${window.location.search}${url.hash}`
                    )
                }
                return
            }

            sessionStorage.setItem(pendingHashKey, url.hash)
            history.push(`${url.pathname}${url.search}`)
        }

        // Handle same-page hash links with smooth behavior.
        document.addEventListener('click', handleAnchorClick, true)

        // Handle route changes that land with a hash (e.g. /docs -> /#features).
        const pendingHash = sessionStorage.getItem(pendingHashKey)
        const hashToScroll = location.hash || pendingHash

        if (hashToScroll) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const didScroll = scrollToHash(hashToScroll)
                    if (!didScroll) return
                    if (pendingHash) {
                        sessionStorage.removeItem(pendingHashKey)
                    }
                    if (window.location.hash !== hashToScroll) {
                        window.history.replaceState(
                            null,
                            '',
                            `${window.location.pathname}${window.location.search}${hashToScroll}`
                        )
                    }
                })
            })
        }

        return () =>
            document.removeEventListener('click', handleAnchorClick, true)
    }, [history, location.hash, location.pathname, location.search])

    return <>{children}</>
}

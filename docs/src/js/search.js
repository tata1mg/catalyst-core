import manifest from './generated/docsManifest.json'

/**
 * In-browser docs search (same model as the docs site's local-search plugin):
 * the index is the build-time manifest; matching happens client-side.
 *
 * Shared between SearchModal.js (the shopper-facing ⌘K UI) and the
 * search_docs WebMCP tool (WebMcpTools.js) — one index, one ranking, so an
 * agent and a human searching the same term see the same results.
 */
export function search(query, { limit = 10 } = {}) {
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
        .slice(0, limit)
        .map((entry) => entry.page)
}

/** Every URL search()/open_doc can validate against — the manifest's own page list. */
export function isKnownDocUrl(url) {
    return manifest.some((page) => page.url === url)
}

/** The full manifest entry for one page — used by get_doc_content to hand an agent real grounding text. */
export function getDocByUrl(url) {
    return manifest.find((page) => page.url === url) || null
}

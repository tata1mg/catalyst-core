/**
 * Scroll the doc article into view and briefly highlight it — the
 * highlight_content WebMCP tool's implementation. Called standalone, on
 * whatever page is CURRENTLY mounted (not tied to a navigation): the agent
 * decides when drawing the person's eye to the content is useful, rather
 * than it happening automatically on every open_doc call.
 */
const HIGHLIGHT_DURATION_MS = 1600

let _styleInjected = false
function ensureHighlightStyle() {
    if (_styleInjected || typeof document === 'undefined') return
    const style = document.createElement('style')
    style.textContent = `
        @keyframes webmcp-doc-highlight {
            0% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.55); }
            100% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0); }
        }
        .webmcp-doc-highlight {
            animation: webmcp-doc-highlight ${HIGHLIGHT_DURATION_MS}ms ease-out;
            border-radius: 8px;
        }
    `
    document.head.appendChild(style)
    _styleInjected = true
}

/**
 * @returns {boolean} whether an article was actually found and highlighted
 *   (false on a non-doc page, e.g. /errors or the landing page, which have
 *   no .doc-article — not an error, just nothing to highlight there).
 */
export function scrollToAndHighlightArticle() {
    if (typeof document === 'undefined') return false
    const article = document.querySelector('.doc-article')
    if (!article) return false

    ensureHighlightStyle()
    article.scrollIntoView({ behavior: 'smooth', block: 'start' })
    article.classList.add('webmcp-doc-highlight')
    setTimeout(() => article.classList.remove('webmcp-doc-highlight'), HIGHLIGHT_DURATION_MS)
    return true
}

/**
 * Scroll the doc article into view and briefly highlight it.
 *
 * Two entry points, because "highlight whatever's on screen right now" and
 * "highlight the page I just navigated to" have different timing needs:
 *
 *   - scrollToAndHighlightArticle(): synchronous, current page only. Backs
 *     the standalone highlight_content WebMCP tool — the agent calls this
 *     on a page that's already settled, so there's nothing to wait for.
 *
 *   - scrollToAndHighlightArticleAfterNavigation(): async, POLLS for a doc
 *     article to (re)appear. navigate() is synchronous to call, but the
 *     route swap + new page's DOM only exist a render or two later — there
 *     is no promise/callback for "the new route finished mounting". Used by
 *     get_doc_content, which auto-highlights right after navigating (an
 *     earlier version relied on the agent calling highlight_content itself
 *     afterward via a hint in the result; that hint was reliably ignored in
 *     practice across multiple live sessions, so get_doc_content now does
 *     it unconditionally instead of asking).
 */
const HIGHLIGHT_DURATION_MS = 1600
const POLL_INTERVAL_MS = 40
const POLL_TIMEOUT_MS = 1500

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

function applyHighlight(article) {
    ensureHighlightStyle()
    article.scrollIntoView({ behavior: 'smooth', block: 'start' })
    article.classList.add('webmcp-doc-highlight')
    setTimeout(() => article.classList.remove('webmcp-doc-highlight'), HIGHLIGHT_DURATION_MS)
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
    applyHighlight(article)
    return true
}

/**
 * Same effect, but for right after a navigate() call: polls briefly for a
 * NEW .doc-article to mount (not just any .doc-article — a fast poll can
 * otherwise catch the OLD page's article in the instant before react-router
 * swaps it out) rather than assuming a fixed delay, so a slower render
 * doesn't just silently miss the highlight.
 *
 * @returns {Promise<boolean>} resolves once highlighted, or once the poll
 *   times out (e.g. the destination isn't a doc-article page at all).
 */
export function scrollToAndHighlightArticleAfterNavigation() {
    if (typeof document === 'undefined') return Promise.resolve(false)

    return new Promise((resolve) => {
        const startedAt = Date.now()
        const previousArticle = document.querySelector('.doc-article')

        const poll = () => {
            const article = document.querySelector('.doc-article')
            if (article && article !== previousArticle) {
                applyHighlight(article)
                resolve(true)
                return
            }
            if (Date.now() - startedAt < POLL_TIMEOUT_MS) {
                setTimeout(poll, POLL_INTERVAL_MS)
            } else {
                resolve(false)
            }
        }

        setTimeout(poll, POLL_INTERVAL_MS)
    })
}

import React from 'react'
import { Outlet, useNavigate } from 'react-router'
import { useTool, WebMcpError, WEBMCP_ERROR_CODES } from 'catalyst-core/webmcp'
import { ThemeProvider } from '../components/docs/ThemeContext'
import DocumentBootstrap from '../components/DocumentBootstrap'
import Navbar from '../components/Navbar'
import ScrollReset from '../components/ScrollReset'
import { search, isKnownDocUrl, getDocByUrl } from '../search.js'
import { scrollToAndHighlightArticle, scrollToAndHighlightArticleAfterNavigation } from '../scrollHighlight.js'

/**
 * Site chrome. The docs grid itself (sidebar, article, TOC) belongs to
 * DocPage, which renders `.docs-shell` per page — this only wraps it in the
 * navbar and theme.
 *
 * Also where search_docs/open_doc are registered: DocsLayout is the `/`
 * layout route (no `end: true`), so it stays in react-router's matched-route
 * chain on every navigation within the app — registering useTool() here
 * gives these two tools an effectively app-lifetime scope (never reaped by
 * WebMcpProvider's route-scoped teardown) without needing routePath "" the
 * way the framework tools (navigate/get_current_route/get_page_info) get it.
 */
const DocsLayout = () => {
    const navigate = useNavigate()

    // Read-only: reuses the SAME index/ranking as the ⌘K search modal
    // (src/js/search.js) so an agent and a person searching the same term
    // land on the same results — no separate index to keep in sync.
    useTool({
        name: 'search_docs',
        description:
            'Search the Catalyst documentation by keyword. Returns matching pages with title, URL, and category. ' +
            'Call get_doc_content with a result URL to open it and read the full page text — this is the usual ' +
            'next step, since search_docs alone only returns a short description, not enough to answer from.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'search terms, e.g. "server-side rendering data fetching"' },
                limit: { type: 'number', minimum: 1, description: 'max results to return (default 10)' },
            },
            required: ['query'],
        },
        annotations: { readOnlyHint: true },
        execute: async ({ query, limit } = {}) => {
            const results = search(query, limit ? { limit } : undefined)
            return {
                query,
                count: results.length,
                results: results.map(({ url, title, categories }) => ({ url, title, categories })),
            }
        },
    })

    // Paired with search_docs: `url` is validated against the manifest
    // rather than offered as an enum (74+ entries — see routes/utils.js's
    // isNavigableForAgents for why that path isn't put in navigate's enum
    // either). An agent gets a valid `url` from search_docs's own results.
    useTool({
        name: 'open_doc',
        description:
            "Open a documentation page by its URL, WITHOUT reading its content — get the URL from search_docs' " +
            'results first. Most of the time get_doc_content is what you want instead (it opens the page AND ' +
            'returns its text in one call); use open_doc on its own only when you just want to move the page ' +
            "somewhere (e.g. handing off to the person) without needing the content yourself.",
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'a URL returned by search_docs, e.g. "/content/Introduction/why-catalyst"' },
            },
            required: ['url'],
        },
        execute: async ({ url } = {}) => {
            if (!isKnownDocUrl(url)) {
                throw new WebMcpError(WEBMCP_ERROR_CODES.INVALID_ARGS, {
                    message: `"${url}" is not a known documentation page. Call search_docs to find a valid URL.`,
                })
            }
            navigate(url)
            // Auto-highlight, not a hint: a hint field in the result asking
            // the agent to call highlight_content afterward was reliably
            // ignored across multiple live sessions — the same failure mode
            // get_doc_content hit before it started navigating unprompted.
            // A navigation the person can't see happen isn't useful even
            // when it "worked", so this waits for the new page to mount and
            // highlights it every time, no agent action required.
            const highlighted = await scrollToAndHighlightArticleAfterNavigation()
            return { navigated: true, url, highlighted }
        },
    })

    // A separate, standalone tool for RE-highlighting without a fresh
    // navigation (e.g. the person scrolled away, or the agent wants to draw
    // attention to something mid-conversation without moving the page).
    // open_doc and get_doc_content already auto-highlight on navigation —
    // this exists for the case that isn't tied to navigating at all.
    useTool({
        name: 'highlight_content',
        description:
            "Scroll the current page's main content into view and briefly highlight it, without navigating " +
            'anywhere new — open_doc and get_doc_content already do this automatically right after they ' +
            'navigate, so you usually don\'t need to call this yourself. Use it to re-highlight later in the ' +
            "conversation (e.g. the person scrolled away, or you're pointing out something on the current page).",
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        execute: async () => {
            const highlighted = scrollToAndHighlightArticle()
            return highlighted
                ? { highlighted: true }
                : { highlighted: false, note: 'This page has no main content to highlight (not a doc article page).' }
        },
    })

    // Gives an agent the actual doc CONTENT to ground an answer on — e.g.
    // "paste an error, find the relevant doc, write a fix" needs more than
    // the title/description search_docs returns. This does NOT generate a
    // solution itself (a page has no LLM to call) — it hands the agent
    // driving the page enough real text to write one accurately, rather
    // than the agent guessing from a title alone.
    //
    // ALSO navigates to the page it's reading — NOT readOnlyHint. An agent
    // that already has the content it needs to answer has no reason to make
    // a second call just to move the page, so a pure-read version silently
    // never navigated even while correctly answering from real doc content.
    // Reading a page and being ON that page are now the same action.
    //
    // ALSO auto-highlights after navigating (not a hint asking the agent to
    // call highlight_content separately) — that hint was reliably ignored
    // across multiple live sessions, same failure mode as the navigation
    // gap above. A navigation the person can't see isn't useful even when
    // the agent's answer is correct.
    useTool({
        name: 'get_doc_content',
        description:
            'Open a documentation page and read its full text content, by URL (from search_docs\' results). This ' +
            'is the tool to use before answering a question or writing a solution based on a specific doc page — ' +
            'get_page_info/search_docs alone only give a short description, not enough to ground a real answer on. ' +
            'Also navigates the page there, so use open_doc separately only if you want to open a page WITHOUT ' +
            "reading its content first (e.g. handing off to the person to read it themselves).",
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'a URL returned by search_docs, e.g. "/content/Introduction/why-catalyst"' },
            },
            required: ['url'],
        },
        execute: async ({ url } = {}) => {
            const doc = getDocByUrl(url)
            if (!doc) {
                throw new WebMcpError(WEBMCP_ERROR_CODES.INVALID_ARGS, {
                    message: `"${url}" is not a known documentation page. Call search_docs to find a valid URL.`,
                })
            }
            navigate(url)
            const highlighted = await scrollToAndHighlightArticleAfterNavigation()
            return {
                url: doc.url,
                title: doc.title,
                categories: doc.categories,
                content: doc.searchText,
                toc: doc.toc,
                highlighted,
            }
        },
    })

    return (
        <ThemeProvider>
            <DocumentBootstrap />
            <ScrollReset />
            <div className="docs-site">
                <Navbar />
                <Outlet />
            </div>
        </ThemeProvider>
    )
}

export default DocsLayout

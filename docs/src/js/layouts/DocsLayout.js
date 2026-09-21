import React from 'react'
import { Outlet, useNavigate } from 'react-router'
import { useTool, WebMcpError, WEBMCP_ERROR_CODES } from 'catalyst-core/webmcp'
import { ThemeProvider } from '../components/docs/ThemeContext'
import DocumentBootstrap from '../components/DocumentBootstrap'
import Navbar from '../components/Navbar'
import ScrollReset from '../components/ScrollReset'
import { search, isKnownDocUrl, getDocByUrl } from '../search.js'
import { scrollToAndHighlightArticle } from '../scrollHighlight.js'

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
            // Nudge, not automatic: open_doc still doesn't call
            // scrollToAndHighlightArticle itself (that stays the agent's own
            // call, per the earlier decision to split them) — but an agent
            // that read the result and never even considered
            // highlight_content is a real gap a description alone didn't
            // close in practice. Putting the suggestion directly in the
            // return value the agent just received is much harder to miss
            // than a sentence buried in a tool description read once at
            // discovery time.
            return {
                navigated: true,
                url,
                hint: 'If the person is watching the page, call highlight_content now to show them where this is.',
            }
        },
    })

    // Separate from open_doc on purpose: the agent decides whether drawing
    // the person's eye to the article is useful for this turn (e.g. after
    // landing on a long page, or specifically when walking someone through
    // "here's the section that answers that") rather than it happening
    // unconditionally on every navigation.
    useTool({
        name: 'highlight_content',
        description:
            "Scroll the current page's main content into view and briefly highlight it — use this to draw the " +
            'person\'s attention to what you just navigated to, when that\'s useful (e.g. right after open_doc, ' +
            "or when pointing out where an answer lives). Not automatic — call it only when it adds value.",
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
    // ALSO navigates to the page it's reading — NOT readOnlyHint. Earlier
    // this stayed pure-read and open_doc handled navigation separately; in
    // practice, an agent that already has the content it needs to answer
    // has no reason to make a second call just to move the page, so
    // navigation silently never happened even while the agent correctly
    // answered from real doc content. Reading a page and being ON that page
    // are now the same action, which is also just how a person actually
    // uses a docs site — you don't know a page's content without opening
    // it. highlight_content stays a separate, agent-chosen call.
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
            return {
                url: doc.url,
                title: doc.title,
                categories: doc.categories,
                content: doc.searchText,
                toc: doc.toc,
                hint: 'If the person is watching the page, call highlight_content now to show them where this is.',
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

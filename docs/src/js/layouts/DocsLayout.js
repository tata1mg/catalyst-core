import React from 'react'
import { Outlet, useNavigate } from 'react-router'
import { useTool, WebMcpError, WEBMCP_ERROR_CODES } from 'catalyst-core/webmcp'
import { ThemeProvider } from '../components/docs/ThemeContext'
import DocumentBootstrap from '../components/DocumentBootstrap'
import Navbar from '../components/Navbar'
import ScrollReset from '../components/ScrollReset'
import { search, isKnownDocUrl } from '../search.js'

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
            'Search the Catalyst documentation by keyword. Returns matching pages with title, URL, and category — ' +
            'call open_doc with a result URL to navigate there.',
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
        description: "Open a documentation page by its URL — get the URL from search_docs' results first.",
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
            return { navigated: true, url }
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

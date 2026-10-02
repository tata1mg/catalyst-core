/**
 * get_page_info — a framework WebMCP tool that describes the current page to an
 * agent, built ENTIRELY from metadata the app already writes for SEO.
 *
 * Catalyst pages define `Component.setMetaData(routeData)` returning an array of
 * JSX <head> elements (<title>, <meta name/property ... content ...>). MetaTag
 * renders exactly this into the document head. We read the SAME static, call it,
 * and flatten the elements into a plain object an agent can consume:
 *
 *   { title, description, canonical, og: {...}, keywords, raw: [...] }
 *
 * No new authoring surface: if the page has good meta tags, the agent gets a
 * good page description for free. This is the read-side complement to
 * get_current_route ("where am I") — "what is this page and what's it for".
 *
 * Phase-3 note for discussion #466: the next layer up is the browser's
 * accessibility tree (roles, landmarks, labelled controls) — a structured map
 * of the page the platform already computes for screen readers. WebMCP could
 * surface that too instead of leaving agents to DOM-scrape.
 */

/**
 * Pull `{ type, props }` out of a React element without depending on React
 * internals beyond the stable `.type` / `.props` shape.
 */
function readEl(el) {
    if (!el || typeof el !== "object") return null
    const type = typeof el.type === "string" ? el.type : null
    const props = el.props || {}
    return { type, props }
}

/**
 * Flatten an array of head JSX elements (possibly nested arrays) into a
 * plain, agent-friendly object.
 */
export function flattenHeadElements(elements) {
    const out = { title: null, description: null, canonical: null, keywords: null, og: {}, twitter: {}, other: {} }
    const walk = (node) => {
        if (Array.isArray(node)) return node.forEach(walk)
        const el = readEl(node)
        if (!el || !el.type) return
        const { type, props } = el

        if (type === "title") {
            out.title = childText(props.children)
            return
        }
        if (type === "link" && (props.rel === "canonical")) {
            out.canonical = props.href || null
            return
        }
        if (type === "meta") {
            const key = props.name || props.property || props["http-equiv"] || props.httpEquiv
            const content = props.content
            if (!key) return
            if (key === "description") out.description = content
            else if (key === "keywords") out.keywords = content
            else if (String(key).startsWith("og:")) out.og[String(key).slice(3)] = content
            else if (String(key).startsWith("twitter:")) out.twitter[String(key).slice(8)] = content
            else out.other[key] = content
        }
    }
    walk(elements)
    // drop empties for a cleaner payload
    if (!Object.keys(out.og).length) delete out.og
    if (!Object.keys(out.twitter).length) delete out.twitter
    if (!Object.keys(out.other).length) delete out.other
    return out
}

function childText(children) {
    if (children == null) return null
    if (typeof children === "string" || typeof children === "number") return String(children)
    if (Array.isArray(children)) return children.map(childText).filter(Boolean).join("")
    return null
}

/**
 * Build the get_page_info tool.
 *
 * @param getMatched  () => RouteMatch[]  (the current matched-route chain)
 * @param getRouteData () => object       (RouterContext data, or {} — POC pages
 *                                         use Redux so this is usually empty)
 */
export function pageInfoTool(getMatched, getRouteData) {
    return {
        name: "get_page_info",
        description:
            "Describe the current page: its title, description, and social/SEO metadata — " +
            "the same information the page publishes in its <head>. Use this to understand " +
            "what a page is about before acting on it.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        execute: async () => {
            const matched = getMatched() || []
            const routeData = (getRouteData && getRouteData()) || {}
            const collected = []
            for (const m of matched) {
                const fn = m && m.route && m.route.component && m.route.component.setMetaData
                if (typeof fn === "function") {
                    try {
                        collected.push(fn(routeData))
                    } catch (err) {
                        // a page's setMetaData threw — report it, don't crash the tool
                        collected.push([])
                    }
                }
            }
            const info = flattenHeadElements(collected)
            const hasAny = info.title || info.description || info.canonical
            return {
                ...info,
                _source: "Component.setMetaData (same as the page <head>)",
                _note: hasAny ? undefined : "This page defines no setMetaData; nothing to report.",
            }
        },
    }
}

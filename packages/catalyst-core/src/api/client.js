import { ApiError } from "./errors.js"

const isAbsoluteUrl = (url) => /^[a-z][a-z0-9+.-]*:\/\//i.test(url)

const splitPathAndQuery = (path, query) => {
    const [pathname, existingQuery] = path.split("?")
    const params = new URLSearchParams(existingQuery)
    Object.entries(query || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null) params.set(key, value)
    })
    const queryString = params.toString()
    return { pathname, queryString, queryObject: Object.fromEntries(params.entries()) }
}

const getServerOrigin = () => {
    const host = process.env.NODE_SERVER_HOSTNAME || "localhost"
    const port = process.env.NODE_SERVER_PORT || 3005
    return `http://${host}:${port}`
}

const parseResponseBody = async (response) => {
    const text = await response.text()
    if (!text) return null
    try {
        return JSON.parse(text)
    } catch {
        return text
    }
}

const fetchOverHttp = async (method, url, { query, body, headers } = {}) => {
    const { pathname, queryString } = splitPathAndQuery(url, query)
    const finalUrl = queryString ? `${pathname}?${queryString}` : pathname

    const response = await fetch(finalUrl, {
        method,
        headers: {
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    const data = await parseResponseBody(response)
    if (!response.ok) {
        throw new ApiError(response.status, data)
    }
    return data
}

/**
 * Isomorphic dispatch: same call site works in a browser fetcher/loader and in an
 * SSR fetcher/loader. On the server, same-origin requests try an in-process
 * loopback call (see dispatch.server.js) before falling back to a real HTTP
 * request against the app's own server.
 */
// catalyst-core is consumed as an installed node_modules package, which Vite's SSR
// pipeline externalizes by default (loaded via plain Node, no Vite transform) — so
// import.meta.env.SSR is never statically replaced here and can't be relied on.
// typeof window is a real runtime check that works regardless of how this module
// got loaded; RouterDataProvider.jsx already uses the same check for the same
// reason (server/client fetcher selection).
const isSSR = () => typeof window === "undefined"

const request = async (method, path, options = {}) => {
    if (isSSR()) {
        if (!isAbsoluteUrl(path)) {
            const { pathname, queryObject } = splitPathAndQuery(path, options.query)
            // Dynamic, non-literal-ish specifier so bundlers targeting the browser
            // don't try to statically include this chunk (and the node:async_hooks
            // import inside it) in a client bundle — see api/dispatch.server.js.
            const dispatchModulePath = "./dispatch.server.js"
            const { dispatchLoopback } = await import(/* @vite-ignore */ dispatchModulePath)
            const result = await dispatchLoopback(method, pathname, {
                query: queryObject,
                body: options.body,
                headers: options.headers,
            })
            if (result.matched) return result.data

            // No registered route matches — fall back to a real HTTP request
            // against this same server (still loopback, just the slower kind).
            return fetchOverHttp(method, `${getServerOrigin()}${path}`, options)
        }
        return fetchOverHttp(method, path, options)
    }

    return fetchOverHttp(method, path, options)
}

export const api = {
    get: (path, options) => request("GET", path, options),
    post: (path, options) => request("POST", path, options),
    put: (path, options) => request("PUT", path, options),
    patch: (path, options) => request("PATCH", path, options),
    delete: (path, options) => request("DELETE", path, options),
}

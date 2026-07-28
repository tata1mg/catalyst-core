import { getRequestContext } from "../server/requestContext.js"
import { ApiError } from "./errors.js"

// res methods that write headers/status. Guarded so a handler that runs via a
// deferred loopback call fails loudly instead of silently dropping a cookie —
// see design-spec-data-fetching-v2.md §6.2 / OQ-6.
const HEADER_MUTATING_METHODS = [
    "setHeader",
    "cookie",
    "clearCookie",
    "append",
    "writeHead",
    "status",
    "set",
    "redirect",
]

const guardResponse = (res) => {
    if (!res) return res

    return new Proxy(res, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver)
            if (typeof value !== "function" || !HEADER_MUTATING_METHODS.includes(prop)) {
                return typeof value === "function" ? value.bind(target) : value
            }

            return function guardedResMethod(...args) {
                if (target.headersSent) {
                    throw new Error(
                        `[catalyst-core/api] An API handler called res.${String(prop)}() after the SSR ` +
                            `shell had already started streaming (headers already sent). Handlers that set ` +
                            `cookies/headers must be awaited as critical loader data — not called via a ` +
                            `deferred/streamed loopback call, which resolves after the shell has flushed.`
                    )
                }
                return value.apply(target, args)
            }
        },
    })
}

const cloneResult = (result) => {
    try {
        return typeof structuredClone === "function" ? structuredClone(result) : result
    } catch {
        // result contains something structuredClone can't handle (functions, class
        // instances, etc.) — sharing by reference here is safer than failing the
        // request outright; routes with genuinely unclonable results should set
        // unsafeShareResult explicitly rather than relying on this fallback.
        return result
    }
}

/**
 * Attempts to serve a same-origin API request via a direct, in-process handler
 * call instead of a real HTTP round-trip. Reads the registry off the current
 * request (attached by expressServer.js) via ALS, so it works correctly regardless
 * of whether this module and the one that built the registry ended up as the same
 * physical module instance (they generally won't be, once Vite has bundled the SSR
 * entry — see design-spec §6.2).
 *
 * @param {string} method
 * @param {string} pathname
 * @param {{ query?: Record<string, any>, body?: any, headers?: Record<string, string> }} [options]
 * @returns {Promise<{ matched: false } | { matched: true, data: any }>}
 */
export const dispatchLoopback = async (method, pathname, options = {}) => {
    const requestContext = getRequestContext()
    const registry = requestContext?.req?.__catalystApiRegistry
    const match = registry?.match(method, pathname)

    if (!match || match.route.loopback === false) {
        return { matched: false }
    }

    const { route, params } = match
    const { query = {}, body, headers = {} } = options

    const mergedHeaders = {
        ...(requestContext?.req?.headers || {}),
        ...headers,
    }

    const context = {
        req: requestContext?.req,
        res: guardResponse(requestContext?.res),
        store: requestContext?.store,
    }

    try {
        const result = await route.handler({ params, query, body, headers: mergedHeaders, context })
        return { matched: true, data: route.unsafeShareResult ? result : cloneResult(result) }
    } catch (error) {
        if (error instanceof ApiError) throw error
        throw new ApiError(500, { message: error.message }, { cause: error })
    }
}

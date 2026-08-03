import { compilePath, matchPath } from "./pathMatcher.js"

const SUPPORTED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]

/**
 * @typedef ApiHandlerArgs
 * @property {Record<string, string>} params
 * @property {Record<string, any>} query
 * @property {any} body
 * @property {Record<string, string>} headers
 * @property {{ req?: any, res?: any, store?: any }} context
 */

/**
 * Declares a single API route with one handler used for both transports:
 * mounted on Express for browser requests, and called directly (loopback) when
 * an SSR loader/fetcher on the same server calls it via the universal api client.
 *
 * @param {{
 *   method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE",
 *   path: string,
 *   handler: (args: ApiHandlerArgs) => any,
 *   loopback?: boolean,
 *   unsafeShareResult?: boolean,
 * }} config
 */
export const defineApi = ({ method, path, handler, loopback = true, unsafeShareResult = false }) => {
    if (!method || !SUPPORTED_METHODS.includes(String(method).toUpperCase())) {
        throw new Error(
            `defineApi: invalid method "${method}" for path "${path}". Supported: ${SUPPORTED_METHODS.join(", ")}`
        )
    }
    if (!path || typeof path !== "string" || !path.startsWith("/")) {
        throw new Error(`defineApi: path must be a string starting with "/", got "${JSON.stringify(path)}"`)
    }
    if (typeof handler !== "function") {
        throw new Error(`defineApi: handler for "${method} ${path}" must be a function`)
    }

    const { regexp, paramNames } = compilePath(path)

    return {
        method: method.toUpperCase(),
        path,
        handler,
        loopback,
        unsafeShareResult,
        regexp,
        paramNames,
    }
}

/**
 * @param {Array<ReturnType<typeof defineApi>>} routes
 */
export const createApiRegistry = (routes = []) => {
    const normalized = routes.flat().filter(Boolean)

    /**
     * @param {string} method
     * @param {string} pathname
     */
    const match = (method, pathname) => {
        const upperMethod = String(method).toUpperCase()
        for (const route of normalized) {
            if (route.method !== upperMethod) continue
            const params = matchPath(route, pathname)
            if (params) return { route, params }
        }
        return null
    }

    return { routes: normalized, match }
}

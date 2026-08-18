/**
 * Minimal dependency-free path matcher for API route definitions, supporting
 * `:param` segments (e.g. "/api/breeds/:breed"). Deliberately not a general-purpose
 * router — API routes are simple REST paths, and a hand-rolled matcher avoids pulling
 * in a dependency on Express's internal (and awkward, pre-1.0-API) path-to-regexp.
 */

/**
 * @param {string} routePath
 * @returns {{ regexp: RegExp, paramNames: string[] }}
 */
export const compilePath = (routePath) => {
    const paramNames = []
    const pattern = routePath
        .split("/")
        .map((segment) => {
            if (segment.startsWith(":")) {
                paramNames.push(segment.slice(1))
                return "([^/]+)"
            }
            return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        })
        .join("/")

    return {
        regexp: new RegExp(`^${pattern}/?$`),
        paramNames,
    }
}

/**
 * @param {{ regexp: RegExp, paramNames: string[] }} compiled
 * @param {string} pathname
 * @returns {Record<string, string> | null}
 */
export const matchPath = (compiled, pathname) => {
    const match = compiled.regexp.exec(pathname)
    if (!match) return null

    return compiled.paramNames.reduce((params, name, index) => {
        params[name] = decodeURIComponent(match[index + 1])
        return params
    }, {})
}

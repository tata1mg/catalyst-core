/**
 * Runs every matched route's `loader` in parallel — each call starts synchronously,
 * before any of them is awaited — and collects the results into a map keyed by
 * route id. Values are NOT awaited here: critical vs. deferred is entirely the
 * loader author's choice (see RFC 0001's "declaring a loader" section). Whatever
 * a loader awaited internally before returning is already resolved by the time its
 * own promise settles; whatever it returned as a raw, un-awaited Promise is still
 * pending inside that resolved value. useRouteData() (RouteDataProvider.jsx) `use()`s
 * a route's individual field to suspend on the deferred part only, independent of
 * sibling routes and sibling fields.
 *
 * No caching, no memoization — call once per request/navigation. A cached,
 * get-or-create variant for client-side rendering (where a component can
 * re-render many times for the same navigation and must not re-invoke the loader
 * on every one of them) lives in loaderCache.js, layered on top of this.
 *
 * @typedef {{ route: any, params: Record<string, string> }} RouteMatch
 * @param {RouteMatch[]} matches
 * @param {{ searchParams?: URLSearchParams, context?: any }} [args]
 * @returns {Record<string, Promise<any>>}
 */
export const buildLoaderPromiseMap = (matches, { searchParams, context } = {}) => {
    const map = {}

    matches.forEach(({ route, params }) => {
        if (typeof route.loader !== "function") return

        const id = deriveRouteId(route)
        if (id in map) {
            throw new Error(
                `[catalyst-core] Two matched routes with a loader resolved to the same id ("${id}"). ` +
                    `Give one of them an explicit \`id\` in route config.`
            )
        }

        map[id] = route.loader({ params, searchParams, context })
    })

    return map
}

/**
 * `route.id || route.path` is only safe when every loader-bearing route has a
 * `path` — a pathless/index route has neither, and silently falling through would
 * collide every such route on the same `undefined` key (whichever registered last
 * would win, silently discarding the rest's loader data). Fail at loader-build
 * time instead, with a message that says exactly what to add and where.
 */
const deriveRouteId = (route) => {
    if (route.id) return route.id
    if (route.path) return route.path
    throw new Error(
        `[catalyst-core] A route with a \`loader\` has neither \`path\` nor an explicit \`id\` — ` +
            `pathless/index routes must set \`id\` explicitly so their loader data has a stable key.`
    )
}

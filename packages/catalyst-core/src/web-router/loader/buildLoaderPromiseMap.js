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
 * `context.signal` is always present (an un-aborted `AbortController().signal`
 * if the caller doesn't pass one) so a loader can pass `context.signal` to
 * `fetch`/`api.get(...)` unconditionally, the same way on server and client,
 * without checking whether it's actually wired to anything. Nothing currently
 * aborts it server-side (SSR has no "navigate away" — a request runs to
 * completion or errors) — the client path (RouteDataProvider.jsx) does abort
 * on navigate-away, which is the scenario this exists for. Threading a real,
 * request-lifecycle signal server-side (e.g. aborting in-flight loaders if
 * the client disconnects mid-response) is a reasonable future extension, not
 * built here — out of scope for what this step asked for.
 *
 * @typedef {{ route: any, params: Record<string, string> }} RouteMatch
 * @param {RouteMatch[]} matches
 * @param {{ searchParams?: URLSearchParams, store?: any, shellStartedRef?: { current: boolean }, signal?: AbortSignal }} [args]
 * @returns {Record<string, Promise<any>>}
 */
export const buildLoaderPromiseMap = (matches, { searchParams, store, shellStartedRef, signal } = {}) => {
    const context = {
        store: guardStoreDispatch(store, shellStartedRef),
        signal: signal || new AbortController().signal,
    }
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
 * A loader that dispatches to the Redux store while the shell is already
 * streaming can mutate state after `initialState` was serialized into
 * `Body.jsx` — a hydration-mismatch class that doesn't exist under the legacy
 * fetch-then-render path, where `serverDataFetcher` always finishes before
 * render starts (RFC 0001). Rather than block the dispatch (a worse failure
 * mode than the mismatch it's guarding against — aborting mid-stream over a
 * store update), this only warns, loudly, naming the action.
 *
 * `console.warn`, not the `logger` global `catalyst-core/logger` exposes:
 * that logger has no `warn` level (only `debug`/`info`/`error`), and more
 * importantly it's only ever set on `globalThis.logger` if a consuming app
 * explicitly calls `configureLogger()` — which most don't (the fixture app
 * doesn't). A framework-level correctness warning that only fires for apps
 * that opted into a specific logging setup, and throws for every other app
 * (`logger` would be an undefined bare reference), would be worse than the
 * thing it's warning about. `console.warn` matches how this same file's
 * caller (`handler.jsx`) already logs its own errors.
 *
 * @param {any} store
 * @param {{ current: boolean }} [shellStartedRef]
 */
const guardStoreDispatch = (store, shellStartedRef) => {
    if (!store || typeof store.dispatch !== "function") return store

    return new Proxy(store, {
        get(target, prop, receiver) {
            if (prop !== "dispatch") return Reflect.get(target, prop, receiver)

            return (action) => {
                if (shellStartedRef?.current) {
                    console.warn(
                        `[catalyst-core] A loader dispatched "${action?.type}" to the Redux store after the ` +
                            `SSR shell had already started streaming. This state change will not be reflected ` +
                            `in the serialized initialState and can cause a hydration mismatch.`
                    )
                }
                return target.dispatch(action)
            }
        },
    })
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

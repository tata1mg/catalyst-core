import React, { useEffect, useMemo, useRef } from "react"
// Relative import, not the "catalyst-core" package specifier: under Vite's
// dev SSR, re-entering through the package specifier from INSIDE
// node_modules/catalyst-core/dist/webmcp/ can resolve to a separate module
// record than the app's own `import ... from "catalyst-core"` — even though
// both point at the identical file on disk — which defeats the whole point
// of routing state through a shared React context (see the file-level
// comment below). A relative path from this file straight to the main
// entry's compiled output guarantees the SAME module record both places.
import { useRouterState } from "../index.jsx"
import { RouteContext } from "./routeContext.js"
import { isNative, reapUnmatched, registerTool, unregisterTool, inspect, newOwnerKey } from "./registry.js"
import { declarativeToolFor, frameworkTools } from "./declarative.js"
import { pageInfoTool } from "./pageInfo.js"

/**
 * WebMcpProvider — framework glue for WebMCP.
 *
 * Mounted once, inside RouterDataProvider (so it sees the same route match
 * chain) and wrapping the app. Two jobs:
 *
 *   1. Publishes the current innermost route path pattern via <RouteContext>
 *      so every useTool() beneath it tags its registration with a route.
 *
 *   2. On every navigation, hands the registry the set of still-matched route
 *      patterns. Any route-scoped tool whose route is no longer matched is
 *      aborted + unregistered *now* — leaving a route aborts its tools.
 *
 * Route state (location/params/navigate/the matched-route chain) comes from
 * catalyst-core's `useRouterState()`, NOT from react-router's own hooks
 * called directly in this file. That is deliberate: this module ships as
 * the `catalyst-core/webmcp` SUBPATH, a separate module-resolution root from
 * the app's own react-router import under Vite's dev SSR (react-router is
 * deliberately excluded from vite.config.js's `dedupe`). Calling
 * `useLocation()` etc. here risks landing on a second, unlinked
 * react-router module instance whose RouterContext this component can't
 * see — `useRouterState()` sidesteps that by reading through a plain React
 * context RouterDataProvider already populates, and `react` context
 * identity (unlike react-router's) IS guaranteed single-instance.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {any[]} props.routes  the app's OWN route table (whatever shape it
 *   builds `preparedRoutes()`/`getRoutes()` from), in its natural nested
 *   form — WebMcpProvider flattens it itself. Required: unlike the earlier
 *   POC, core cannot reach into an app's own routing module, so the caller
 *   passes its routes explicitly.
 * @param {(flatRoute: any) => boolean} [props.filterNavigable]  optional
 *   predicate deciding which flattened, non-parameterised routes are offered
 *   through the `navigate` framework tool's enum. Default: every such route.
 *   An app with many generated pages (e.g. one route per doc page) should
 *   exclude those here — they're reachable through their own search/open
 *   tools instead of bloating `navigate`'s enum to the whole site map.
 */
export function WebMcpProvider({ children, routes, filterNavigable }) {
    const { location, params, navigate, matchedRoutes: matches } = useRouterState()

    const currentRoutePath = useMemo(() => {
        for (let i = matches.length - 1; i >= 0; i--) {
            const patt = patternOf(matches[i])
            if (patt) return patt
        }
        return ""
    }, [matches])

    const matchedPatterns = useMemo(() => {
        const set = new Set()
        for (const m of matches) {
            const patt = patternOf(m)
            if (patt) set.add(patt)
        }
        return set
    }, [matches])

    // A stable string key so effects only fire when the matched SET changes.
    const patternsKey = useMemo(() => Array.from(matchedPatterns).sort().join("|"), [matchedPatterns])

    const firstRun = useRef(true)

    useEffect(() => {
        if (typeof document === "undefined") return
        if (isNative()) return
        // Neither a native document.modelContext nor an app-installed shim
        // is present — every registerTool() call below still "succeeds"
        // against the in-memory fallback (registry.js's safety net), but no
        // agent can see any of it. This is silent otherwise, and the
        // resulting "nothing is broken, nothing works" state is exactly the
        // kind of thing worth a loud one-time warning for.
        // eslint-disable-next-line no-console
        console.warn(
            "[webmcp] No document.modelContext found (native or shim) — WebMCP tools are registering into an " +
                "in-memory fallback that no agent can see. Install a shim (e.g. catalyst-core/webmcp/shim's " +
                "installShim()) before this provider mounts if you need WebMCP to work in a browser without " +
                "native support."
        )
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Keep live route facts + the matched-route chain in a ref so the framework
    // tools (registered once, below) always report the *current* page without
    // re-registering.
    const routeFactsRef = useRef({ pathname: location.pathname, pattern: currentRoutePath, params, matches })
    routeFactsRef.current = { pathname: location.pathname, pattern: currentRoutePath, params, matches }

    const flatRoutes = useMemo(() => flattenRoutes(routes), [routes])

    // Register the DECLARATIVE read tools + the framework tools ONCE, as
    // app-lifetime tools (routePath ""), so an agent can navigate from anywhere
    // to anywhere. Imperative useTool() action tools stay route-scoped.
    useEffect(() => {
        if (typeof document === "undefined") return undefined
        const owners = []

        const getCurrent = () => ({
            pathname: routeFactsRef.current.pathname,
            pattern: routeFactsRef.current.pattern,
            params: routeFactsRef.current.params,
            tools: inspect().tools.map((t) => ({ name: t.name, routePath: t.routePath })),
        })

        // Declarative, one per route that declares route.tool.
        for (const route of flatRoutes) {
            const spec = declarativeToolFor(route, navigate)
            if (!spec) continue
            const key = newOwnerKey()
            const res = registerTool(key, "", spec)
            if (res.ok) owners.push(key)
            else
                // eslint-disable-next-line no-console
                console.warn(`[webmcp] declarative tool "${spec.name}" failed to register:`, res.error)
        }

        // Framework: navigate + get_current_route + get_page_info.
        const navigableRoutes = filterNavigable ? flatRoutes.filter(filterNavigable) : flatRoutes
        const fw = [
            ...frameworkTools(navigableRoutes, navigate, getCurrent),
            pageInfoTool(
                () => routeFactsRef.current.matches,
                () => ({})
            ),
        ]
        for (const spec of fw) {
            const key = newOwnerKey()
            const res = registerTool(key, "", spec)
            if (res.ok) owners.push(key)
        }

        return () => owners.forEach(unregisterTool)
        // navigate identity is stable for the life of the router; flatRoutes
        // is memoised on the routes prop, which an app should pass a stable
        // reference for (the same module-level array every render).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flatRoutes])

    useEffect(() => {
        if (firstRun.current) {
            firstRun.current = false
            return
        }
        const reaped = reapUnmatched(matchedPatterns)
        if (reaped.length) {
            // eslint-disable-next-line no-console
            console.info(
                `[webmcp] navigated to ${location.pathname} — reaped ${reaped.length} stale tool(s): ${reaped.join(", ")}`
            )
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [patternsKey, location.pathname])

    return <RouteContext.Provider value={currentRoutePath}>{children}</RouteContext.Provider>
}

/**
 * Flatten a nested route table into the flat array declarative.js's
 * declarativeToolFor()/frameworkTools() expect: one entry per NAVIGABLE
 * route, each carrying an absolute `.path` and (if present) its own
 * `.tool` config.
 *
 * Rules:
 *   - A route with `children` is a layout wrapper — recurse into its
 *     children, joining relative child paths against the parent's absolute
 *     path. Its own entry is dropped UNLESS it itself has a `path` (a layout
 *     can also be directly navigable, e.g. nested `/parent` + `/parent/:id`).
 *   - A route with `index: true` and no `path` is the default child of its
 *     parent — it has no path of its own to register a tool under, so it is
 *     skipped. (Its parent's own path, if any, already covers "/".)
 *   - A route with neither `path` nor `children` nor `index` contributes
 *     nothing (matches ServerRouter's own tolerance for pathless wrapper
 *     routes, e.g. an outer <RouterDataProvider> element with no path).
 */
export function flattenRoutes(routes, parentPath = "") {
    if (!Array.isArray(routes)) return []
    const out = []
    for (const route of routes) {
        if (route.index || typeof route.path !== "string") {
            if (Array.isArray(route.children)) {
                out.push(...flattenRoutes(route.children, parentPath))
            }
            continue
        }
        const absolutePath = route.path.startsWith("/")
            ? route.path
            : `${parentPath.replace(/\/$/, "")}/${route.path}`
        out.push({ ...route, path: absolutePath })
        if (Array.isArray(route.children)) {
            out.push(...flattenRoutes(route.children, absolutePath))
        }
    }
    return out
}

/**
 * A RouteMatch has `.route.path` (the pattern segment as react-router sees
 * it — usually just the leaf segment, not the full absolute path) and
 * `.pathname` (the full matched URL). We want the full pattern, so this
 * joins every matched segment's `.route.path` up the chain rather than
 * trusting either alone.
 *
 * A *pathless* layout route (no `.route.path`) contributes NO scope — it is
 * not a navigable destination. Falling back to `.pathname` instead would pin
 * whatever page happened to be current into the matched-set, and stop that
 * route's tools from ever being reaped.
 */
function patternOf(match) {
    if (!match || !match.route || typeof match.route.path !== "string" || !match.route.path) return ""
    const p = match.route.path
    return p.startsWith("/") ? p : `/${p}`
}

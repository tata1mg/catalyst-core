import React, { useContext, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useParams, UNSAFE_RouteContext } from "react-router"
import { getRoutes } from "@routes/utils"
import { RouteContext } from "./routeContext.js"
import { ensureModelContext } from "./shim.js"
import { reapUnmatched, registerTool, unregisterTool, inspect, newOwnerKey } from "./registry.js"
import { declarativeToolFor, frameworkTools } from "./declarative.js"
import { pageInfoTool } from "./pageInfo.js"
import { DevPanel } from "./DevPanel.jsx"

/**
 * WebMcpProvider — framework glue for WebMCP.
 *
 * Mounted once, inside RouterDataProvider (so it sees the same route match
 * chain) and wrapping <App/>. Two jobs:
 *
 *   1. Publishes the current innermost route path pattern via <RouteContext>
 *      so every useTool() beneath it tags its registration with a route.
 *
 *   2. On every navigation, hands the registry the set of still-matched route
 *      patterns. Any route-scoped tool whose route is no longer matched is
 *      aborted + unregistered *now* — the "leaving /category/:slug aborts its
 *      tools" behaviour from the discussion.
 *
 * Route matches come from react-router's UNSAFE_RouteContext (same source
 * RouterDataProvider itself reads via getMatchedRoutes) rather than
 * `useMatches()` — the latter throws outside a data router, which is exactly
 * the shape Catalyst renders on the server.
 *
 * Dev panel is portalled into #webmcp-panel, client-only.
 */
export function WebMcpProvider({ children }) {
    const location = useLocation()
    const navigate = useNavigate()
    const params = useParams()
    const routeContext = useContext(UNSAFE_RouteContext)

    const matches = useMemo(() => collectMatches(routeContext), [routeContext])

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

    const [panelTick, setPanelTick] = useState(0)
    const firstRun = useRef(true)

    useEffect(() => {
        ensureModelContext()
    }, [])

    // Keep live route facts + the matched-route chain in a ref so the framework
    // tools (registered once, below) always report the *current* page without
    // re-registering.
    const routeFactsRef = useRef({ pathname: location.pathname, pattern: currentRoutePath, params, matches })
    routeFactsRef.current = { pathname: location.pathname, pattern: currentRoutePath, params, matches }

    // Register the DECLARATIVE read tools + the two framework tools ONCE, as
    // app-lifetime tools (routePath ""), so an agent can navigate from anywhere
    // to anywhere. Imperative useTool() action tools stay route-scoped.
    useEffect(() => {
        if (typeof document === "undefined") return undefined
        const routes = getRoutes()
        const owners = []

        const getCurrent = () => ({
            pathname: routeFactsRef.current.pathname,
            pattern: routeFactsRef.current.pattern,
            params: routeFactsRef.current.params,
            tools: inspect().tools.map((t) => ({ name: t.name, routePath: t.routePath })),
        })

        // Declarative, one per route that declares Component.tool.
        for (const route of routes) {
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
        const fw = [
            ...frameworkTools(routes, navigate, getCurrent),
            pageInfoTool(
                () => routeFactsRef.current.matches,
                () => ({}) // POC pages read Redux, not RouterContext data
            ),
        ]
        for (const spec of fw) {
            const key = newOwnerKey()
            const res = registerTool(key, "", spec)
            if (res.ok) owners.push(key)
        }

        setPanelTick((t) => t + 1)
        return () => owners.forEach(unregisterTool)
        // navigate identity is stable for the life of the router.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

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
        setPanelTick((t) => t + 1)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [patternsKey, location.pathname])

    return (
        <RouteContext.Provider value={currentRoutePath}>
            {children}
            <DevPanel tick={panelTick} snapshot={inspect()} />
        </RouteContext.Provider>
    )
}

/**
 * Walk react-router's route context to the leaf, collecting every RouteMatch.
 * Mirrors RouterDataProvider's getMatchedRoutes, but keeps the whole chain
 * instead of just the deepest `matches` array.
 */
function collectMatches(routeContext) {
    if (!routeContext) return []
    // routeContext.matches is the chain up to *this* provider's position;
    // routeContext.outlet.props.routeContext.matches goes one level deeper.
    let ctx = routeContext
    let deepest = ctx.matches || []
    while (ctx && ctx.outlet && ctx.outlet.props && ctx.outlet.props.routeContext) {
        ctx = ctx.outlet.props.routeContext
        if (ctx.matches && ctx.matches.length > deepest.length) deepest = ctx.matches
    }
    return deepest
}

/**
 * A RouteMatch has `.route.path` (the pattern segment) and `.pathname`. For our
 * flat route table `.route.path` is already the full pattern ("/product/:id",
 * "/cart", "/").
 *
 * A *pathless* layout route (the `{ element, children }` wrapper in
 * routes/utils.js) has no `route.path` — it is not a navigable destination, so
 * it contributes NO scope. Returning its `.pathname` ("/") instead would pin
 * "/" into the matched-set on every page and stop Home's tools from ever being
 * reaped.
 */
function patternOf(match) {
    if (!match || !match.route || typeof match.route.path !== "string" || !match.route.path) return ""
    const p = match.route.path
    return p.startsWith("/") ? p : `/${p}`
}

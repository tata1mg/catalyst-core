/**
 * Declarative WebMCP tools — the §4a layer of discussion #466.
 *
 * A route declares its own tool config directly in routes/index.js, next to
 * `path`/`component` — NOT as a static on the page component:
 *
 *   { path: "/products", component: ProductList, tool: {
 *       description: "Browse the product catalogue, optionally filtered.",
 *       searchParams: {
 *         category: { type: "string", enum: ["footwear","electronics","apparel"], description: "..." },
 *         maxPrice: { type: "number", description: "upper price bound in INR" },
 *       },
 *       annotations: { readOnlyHint: true },
 *   } }
 *
 * `route.tool` over a `Component.tool` static: routing config belongs with
 * the route, and — unlike a component static — it survives lazy-loading. A
 * component rendered through Split (packages/catalyst-core/src/web-router/
 * components/Split.tsx) only has its statics copied onto the lazy wrapper
 * for the keys Split's own copyRouteStatics() lists (clientFetcher/
 * serverFetcher/setMetaData); a `tool` static would silently vanish behind
 * Split. `route.tool` needs no such patch: getRoutes() returns the route
 * table directly, before any Split wrapping happens. No app has ever shipped
 * the component-static form, so there is no fallback to carry here.
 *
 * From that + the route's path pattern, the framework derives a full WebMCP
 * tool with zero extra wiring:
 *
 *   - name         from the path      ("/products" -> "products",
 *                                       "/product/:id" -> "product")
 *   - inputSchema   route :params (required) + declared searchParams (optional)
 *   - execute       navigate to the filled path + query string, then report the
 *                   new location. (This POC's pages fetch via Redux, not
 *                   serverFetcher/clientFetcher, and plain {path,component}
 *                   routes never have their fetchers invoked by Catalyst — so
 *                   "navigate + refetch" degrades cleanly to "navigate".)
 *
 * Lifetime: declarative READ tools are registered ONCE, for the life of the
 * app — NOT scoped to a matched route. That is the whole point: an agent
 * sitting on /cart must still be able to call `products({category:"footwear"})`
 * to get there. (Only imperative ACTION tools — useTool — are route-scoped,
 * because acting on a page you've left is what you want to prevent.)
 * This resolves open question #4 in the discussion for the POC.
 */

/** "/product/:id" -> "product" ; "/products" -> "products" ; "/" -> "home" */
export function toolNameFromPath(pathPattern) {
    const segs = String(pathPattern)
        .split("/")
        .filter(Boolean)
        .filter((s) => !s.startsWith(":"))
    if (segs.length === 0) return "home"
    return segs.join("_")
}

/** Pull ":id", ":slug" etc. out of a path pattern. */
export function paramNames(pathPattern) {
    return String(pathPattern)
        .split("/")
        .filter((s) => s.startsWith(":"))
        .map((s) => s.slice(1))
}

/** Fill "/product/:id" + { id: "trail-runner-x" } -> "/product/trail-runner-x". */
export function fillPath(pathPattern, params = {}) {
    return String(pathPattern).replace(/:([A-Za-z0-9_]+)/g, (_, k) => {
        if (params[k] == null || params[k] === "") {
            throw new Error(`missing required path param "${k}" for ${pathPattern}`)
        }
        return encodeURIComponent(params[k])
    })
}

/**
 * Build the WebMCP inputSchema for a declarative tool: path params are required
 * strings, declared searchParams are optional and typed as given.
 */
export function buildInputSchema(pathPattern, toolStatic) {
    const properties = {}
    const required = []
    for (const p of paramNames(pathPattern)) {
        properties[p] = { type: "string", description: `path parameter "${p}"` }
        required.push(p)
    }
    const sp = (toolStatic && toolStatic.searchParams) || {}
    for (const [key, def] of Object.entries(sp)) {
        properties[key] = { ...def }
    }
    const schema = { type: "object", properties }
    if (required.length) schema.required = required
    return schema
}

/**
 * Turn one route (with a `.tool` config) into a registrable WebMCP tool
 * spec. `navigate` is react-router's navigate fn.
 */
export function declarativeToolFor(route, navigate) {
    const toolStatic = route && route.tool
    if (!toolStatic) return null

    const pattern = route.path.startsWith("/") ? route.path : `/${route.path}`
    const name = toolNameFromPath(pattern)
    const params = paramNames(pattern)
    const searchKeys = Object.keys((toolStatic && toolStatic.searchParams) || {})

    return {
        name,
        description: toolStatic.description || `Open ${pattern}`,
        inputSchema: buildInputSchema(pattern, toolStatic),
        annotations: { readOnlyHint: true, ...(toolStatic.annotations || {}) },
        execute: async (args = {}) => {
            const pathParams = {}
            for (const p of params) pathParams[p] = args[p]
            const path = fillPath(pattern, pathParams)

            const qs = new URLSearchParams()
            for (const k of searchKeys) {
                if (args[k] != null && args[k] !== "") qs.set(k, String(args[k]))
            }
            const query = qs.toString()
            const to = query ? `${path}?${query}` : path

            navigate(to)
            return {
                navigated: true,
                path: to,
                note:
                    "Navigation done. The set of available tools changes with the route — " +
                    "call get_current_route to see what's now callable before the next step.",
            }
        },
    }
}

/**
 * The two fixed framework tools from §4c.
 *
 * @param routes      flat route table (from getRoutes())
 * @param navigate    react-router navigate fn
 * @param getCurrent  () => ({ pathname, params, patterns, tools })
 */
export function frameworkTools(routes, navigate, getCurrent) {
    // Closed set of navigable destinations. Parameterised routes ("/product/:id")
    // are reachable through their own declarative tool, so we list only the
    // static paths here.
    const staticPaths = routes
        .map((r) => (r.path.startsWith("/") ? r.path : `/${r.path}`))
        .filter((p) => !p.includes(":"))

    return [
        {
            name: "navigate",
            description: "Go to one of this app's pages.",
            inputSchema: {
                type: "object",
                properties: {
                    path: { type: "string", enum: staticPaths, description: "destination route" },
                },
                required: ["path"],
            },
            annotations: { readOnlyHint: true },
            execute: async ({ path } = {}) => {
                if (!staticPaths.includes(path)) {
                    throw new Error(`"${path}" is not a navigable page. One of: ${staticPaths.join(", ")}`)
                }
                navigate(path)
                return { navigated: true, path }
            },
        },
        {
            name: "get_current_route",
            description: "Report the current page, its URL params, and which tools are callable right now.",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: true },
            execute: async () => getCurrent(),
        },
    ]
}

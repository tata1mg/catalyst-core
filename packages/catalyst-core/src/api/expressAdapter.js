import { runWithRequestContext } from "../server/requestContext.js"
import { ApiError } from "./errors.js"

/**
 * Mounts every route in an API registry onto an Express app as real HTTP endpoints
 * — this is how browsers (and any HTTP client) reach them. SSR loopback dispatch
 * (dispatch.server.js) bypasses this entirely for same-process calls; this adapter
 * exists for everyone else.
 *
 * Mount before the app's own `addMiddlewares`/catch-all so explicit `defineApi`
 * routes take priority, and any broader manual `/api` handler an app already has
 * still works as a fallback for paths this registry doesn't cover.
 *
 * @param {import("express").Express} app
 * @param {ReturnType<typeof import("./registry.js").createApiRegistry>} registry
 */
export const mountApiRegistry = (app, registry) => {
    registry.routes.forEach((route) => {
        app[route.method.toLowerCase()](route.path, async (req, res) => {
            // Every request — including ones an API handler makes to another API
            // route via loopback — runs inside its own ALS scope, so recursive
            // api.get() calls from within a handler can find the registry and
            // inherit this request's headers.
            await runWithRequestContext({ req, res }, async () => {
                try {
                    const result = await route.handler({
                        params: req.params,
                        query: req.query,
                        body: req.body,
                        headers: req.headers,
                        context: { req, res },
                    })
                    res.status(200).json(result)
                } catch (error) {
                    if (error instanceof ApiError) {
                        res.status(error.status).json(
                            typeof error.body === "object" && error.body !== null
                                ? error.body
                                : { message: error.message }
                        )
                        return
                    }
                    console.error(`[catalyst-core/api] Unhandled error in ${route.method} ${route.path}:`, error)
                    res.status(500).json({ message: "Internal Server Error" })
                }
            })
        })
    })
}

import { AsyncLocalStorage } from "node:async_hooks"

/**
 * Per-request context, entered once at the top of the SSR handler and read by
 * anything that needs to know "which request am I part of" without req/res being
 * threaded through every call — the universal api client (loopback dispatch) and
 * route loaders both rely on this.
 *
 * Stored on globalThis (keyed by a registry symbol) rather than as a plain
 * module-scoped singleton: Vite's dev SSR pipeline loads its ssrLoadModule entry
 * (handler.jsx) through its own module graph, but treats this file as an
 * externalized node_modules dependency when reached from elsewhere (e.g. from
 * dispatch.server.js via the api client) — loaded through Node's separate,
 * plain-import module cache instead. A `new AsyncLocalStorage()` at module scope
 * would silently split into two unrelated stores across that boundary, so
 * runWithRequestContext and getRequestContext would never see each other's data.
 * globalThis is the one thing guaranteed to be shared across both load paths.
 */
const REQUEST_CONTEXT_KEY = Symbol.for("catalyst-core.requestContextStorage")
const requestContextStorage =
    globalThis[REQUEST_CONTEXT_KEY] || (globalThis[REQUEST_CONTEXT_KEY] = new AsyncLocalStorage())

/**
 * @param {{ req: import("express").Request, res: import("express").Response, store?: any }} context
 * @param {() => any} fn
 */
export const runWithRequestContext = (context, fn) => {
    return requestContextStorage.run(context, fn)
}

/**
 * @returns {{ req: import("express").Request, res: import("express").Response, store?: any } | undefined}
 */
export const getRequestContext = () => {
    return requestContextStorage.getStore()
}

// catalyst-cloudflare runtime — the reusable core of the adapter.
//
// Importing this module (which the Worker entry must do BEFORE importing the Catalyst app)
// has three side effects the app relies on:
//   1. installs a console `globalThis.logger` (Catalyst's renderer expects a global logger
//      that is normally set by a dev/prod bootstrap the Worker never runs);
//   2. installs the C2 same-origin fetch reroute (see below);
//   3. exposes the D-style context fetch (`globalThis.__ctxFetch`).
//
// createWorker(app) then wires the Express app to the Workers runtime via httpServerHandler,
// binding each inbound request into AsyncLocalStorage so server-side same-origin fetches can
// forward request context (cookies / authorization) to the in-process dispatch.
import { httpServerHandler } from "cloudflare:node"
import { env } from "cloudflare:workers"
import { AsyncLocalStorage } from "node:async_hooks"
import http from "node:http"

// workerd's nodejs_compat http.ServerResponse write path appears to transfer (neuter)
// a Buffer/Uint8Array's underlying ArrayBuffer the first time it's written — a no-op
// concern for a fresh, one-shot buffer, but handler.jsx's static-page cache
// (_renderMarkUpStatic/staticPageCache) deliberately keeps and replays the SAME Buffer
// object across every request for a cached route: the first request (which both writes
// it AND stores the reference) works, but every later "cache hit" request writes an
// already-neutered (zero-length) buffer, silently sending an empty 200. Defensively
// copy Buffer/Uint8Array chunks before handing them to the real implementation so a
// caller-retained buffer is never mutated out from under it.
for (const method of ["write", "end"]) {
    const original = http.ServerResponse.prototype[method]
    http.ServerResponse.prototype[method] = function (chunk, ...rest) {
        if (Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk)
        else if (chunk instanceof Uint8Array) chunk = new Uint8Array(chunk)
        return original.call(this, chunk, ...rest)
    }
}

// workerd's nodejs_compat http.ServerResponse also appears to fire a spurious 'close'
// event as a side effect of flushHeaders() (used by SSE routes like catalyst-ai's
// /:provider/stream to send headers before any body content exists) — 'close' fires
// immediately, before anything has actually been written or the client has
// disconnected (writableEnded/finished both still false). Any handler using the
// standard Node pattern of `res.on("close", () => abortController.abort())` as a
// client-disconnect guard (this adapter's own AI route does exactly that) aborts its
// own request before it even starts. Real Node/the container target don't have this
// problem - flushHeaders() there doesn't touch 'close' at all - so this is patched
// here rather than in the shared route code. Suppress 'close' listeners for one
// macrotask after flushHeaders() runs; a genuine disconnect within that ~0ms window is
// vanishingly unlikely for a request whose handler is still on its very first line.
const originalFlushHeaders = http.ServerResponse.prototype.flushHeaders
if (originalFlushHeaders) {
    http.ServerResponse.prototype.flushHeaders = function (...args) {
        const originalEmit = this.emit
        this.emit = function (event, ...eventArgs) {
            if (event === "close") return false
            return originalEmit.call(this, event, ...eventArgs)
        }
        const result = originalFlushHeaders.apply(this, args)
        setTimeout(() => {
            this.emit = originalEmit
        }, 0)
        return result
    }
}

// 1. logger shim
if (!globalThis.logger) {
    const line = (m) => (typeof m === "string" ? m : JSON.stringify(m))
    globalThis.logger = {
        info: (m) => console.log(line(m)),
        debug: () => {},
        warn: (m) => console.warn(line(m)),
        error: (m) => console.error(line(m)),
    }
}

const als = new AsyncLocalStorage()
const SELF_HOSTS = new Set()
// Some apps' serverFetcher builds its self-call URL from a fixed config value
// (e.g. `http://${NODE_SERVER_HOSTNAME}:${NODE_SERVER_PORT}/api/x`, the Node/container
// server's own host:port) rather than echoing the inbound request's actual host. That
// literal never matches this Worker's real hostname, so it'd fall through to a real
// fetch (which fails — nothing is listening on localhost inside a Worker). adapter.mjs
// derives this alias from the app's config/config.json and injects it as a var.
if (env.CATALYST_SELF_HOST_ALIAS) SELF_HOSTS.add(env.CATALYST_SELF_HOST_ALIAS)

// Return the path+query if `urlStr` targets this Worker's own origin (or is relative),
// else null. External URLs return null and are left untouched.
const selfPathOf = (urlStr) => {
    if (!urlStr) return null
    if (urlStr.startsWith("/")) {
        const u = new URL(urlStr, "https://self.local")
        return u.pathname + u.search
    }
    try {
        const u = new URL(urlStr)
        if (SELF_HOSTS.has(u.host)) return u.pathname + u.search
    } catch {
        /* not absolute */
    }
    return null
}

// Build headers for an internal dispatch, forwarding the inbound request's context.
const forwardedHeaders = (base) => {
    const headers = new Headers(base)
    const store = als.getStore()
    if (store && store.request) {
        for (const h of ["cookie", "authorization"]) {
            const v = store.request.headers.get(h)
            if (v && !headers.has(h)) headers.set(h, v)
        }
    }
    return headers
}

// Dispatch a request to this Worker's own routes, in-process, via the SELF service binding.
const dispatchSelf = (pathAndQuery, { method = "GET", headers } = {}) =>
    env.SELF.fetch(
        new Request(`https://catalyst-internal${pathAndQuery}`, {
            method,
            headers: forwardedHeaders(headers),
        }),
    )

// 2. C2 — transparent same-origin fetch reroute. App code calls fetch() normally.
const realFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = (input, init) => {
    const urlStr = typeof input === "string" ? input : input && input.url
    const selfPath = selfPathOf(urlStr)
    if (selfPath === null || !env.SELF) return realFetch(input, init)
    const method = (typeof input === "object" && input ? input.method : init && init.method) || "GET"
    const headers = (init && init.headers) || (typeof input === "object" && input ? input.headers : undefined)
    return dispatchSelf(selfPath, { method, headers })
}

// 3. D — explicit context fetch (used by an app helper that both fetchers call identically).
globalThis.__ctxFetch = (pathAndQuery) => dispatchSelf(pathAndQuery)

// Register the bundle-embedded file map the fs-shim serves (loadable-stats.json + CSS).
export const registerFsAssets = (map) => {
    globalThis.__CATALYST_FS_ASSETS__ = map || {}
}

// Wire the Catalyst Express app to the Workers runtime.
export function createWorker(app, options = {}) {
    const port = options.port || 3000
    if (options.fsAssets) registerFsAssets(options.fsAssets)
    app.listen(port)
    const base = httpServerHandler({ port })
    return {
        fetch(request, workerEnv, ctx) {
            try {
                SELF_HOSTS.add(new URL(request.url).host)
            } catch {
                /* ignore */
            }
            return als.run({ request }, () => base.fetch(request, workerEnv, ctx))
        },
    }
}

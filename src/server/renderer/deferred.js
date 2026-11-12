/**
 * Deferred route data (server).
 *
 * A serverFetcher can hand slow work to `defer(name, promise)` and return without awaiting it.
 * The response then goes out at once (document, header, the section's fallback) and the section
 * wrapped in `<Deferred name>` streams into the same response when the work settles (see
 * web-router/components/Deferred.jsx). On a PPR route the work does not hold the resumed app
 * either: the route boundary waits for the serverFetchers, which no longer wait for it.
 *
 * A blocking request awaits every deferred promise before rendering, as if the fetcher had
 * awaited it, so the first response holds the whole page: bots, static routes,
 * DEFER_STREAMING_ENABLE=false (the kill switch) and requests the app's isBlockingRequest()
 * marks blocking.
 *
 * No React import here, so it can be unit tested on its own.
 */
import { serializeForScript } from "./ppr.js"

// config.json → process.env. On unless explicitly disabled.
export const isDeferredStreamingEnabled = () =>
    !(process.env.DEFER_STREAMING_ENABLE === false || process.env.DEFER_STREAMING_ENABLE === "false")

// Upper bound for deferred sections on the streaming path: on timeout React sends what is still
// pending to the client to render and ends the response (PPR routes use PPR_RESUME_TIMEOUT_MS).
export const DEFER_TIMEOUT_MS = () => {
    const n = Number(process.env.DEFER_TIMEOUT_MS)
    return Number.isFinite(n) && n > 0 ? n : 15000
}
// Reasons the streaming render is aborted with; reported once where they happen.
export const DEFER_TIMED_OUT = "Deferred data timed out"
export const DEFER_CLIENT_GONE = "Deferred data: client disconnected"
export const isDeferAbort = (error) =>
    error?.message === DEFER_TIMED_OUT || error?.message === DEFER_CLIENT_GONE

/**
 * Flushes the response at most once per event-loop turn while it streams. compression() holds
 * gzip output until its buffer fills, which would hold the shell until the deferred data arrives
 * anyway. React writes in small pieces, so one flush per turn keeps each React flush going out at
 * once without closing a compressed block per piece (which makes the response larger).
 */
export const createFlushScheduler = (res) => {
    let queued = false
    return () => {
        if (queued || typeof res.flush !== "function") return
        queued = true
        setImmediate(() => {
            queued = false
            if (!res.writableEnded) res.flush()
        })
    }
}

const OPEN_TAGS = [Buffer.from("<head"), Buffer.from("<body")]
const GT = 0x3e
const isTagNameEnd = (byte) =>
    byte === GT || byte === 0x20 || byte === 0x0a || byte === 0x09 || byte === 0x0d || byte === 0x2f

/**
 * Inserts `text` right after the opening head tag (or the body tag when there is no head) of
 * the document's first bytes. Works on bytes, so a multi-byte character split across chunks is
 * left intact. Returns null when neither tag is in `chunk`.
 */
export const insertAfterOpenTag = (chunk, text) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    for (const tag of OPEN_TAGS) {
        let at = buf.indexOf(tag)
        // Skip longer names that share the prefix (header, bodyguard...).
        while (at !== -1 && !isTagNameEnd(buf[at + tag.length])) at = buf.indexOf(tag, at + 1)
        if (at === -1) continue
        const end = buf.indexOf(GT, at)
        if (end === -1) return null
        return Buffer.concat([buf.subarray(0, end + 1), Buffer.from(text), buf.subarray(end + 1)])
    }
    return null
}

// A deferred redirect runs as a script navigation, which would also run these schemes.
// Browsers ignore whitespace and control characters inside the scheme ("java\tscript:").
const UNSAFE_SCHEME = /^(javascript|data|vbscript):/i
export const isSafeRedirect = (url) =>
    typeof url === "string" &&
    url.length > 0 &&
    !UNSAFE_SCHEME.test(url.replace(/[\u0000- \u007f-\u009f]/g, ""))

// onError may return a URL, or { redirect, mode }. "assign" keeps the page in history
// (and is what opens app deep links in a WebView); "replace" is the default.
const toRedirect = (mapped) => {
    if (typeof mapped === "string") return { redirect: mapped, mode: "replace" }
    if (mapped && typeof mapped.redirect === "string") {
        return { redirect: mapped.redirect, mode: mapped.mode === "assign" ? "assign" : "replace" }
    }
    return { redirect: null, mode: "replace" }
}

/**
 * The inline script a streamed `<Deferred>` section writes before its content:
 * - marks the section as server-streamed, so the client renders the same element and hydrates;
 * - hands the state slices the deferred work changed to the client. They go into
 *   window.__INITIAL_STATE__ when it already exists, and into window.__CATALYST_DEFERRED_STATE__,
 *   which the document's state script merges in: a section whose data was ready before the render
 *   started is written inside the shell, before that script;
 * - navigates when the work failed and onError mapped the failure to a redirect.
 */
export const buildDeferredScript = ({
    name,
    stateKeys = [],
    state = {},
    redirect = null,
    mode = "replace",
}) => {
    let js = `(window.__CATALYST_DEFERRED__=window.__CATALYST_DEFERRED__||{})[${serializeForScript(name)}]=1;`
    if (stateKeys.length) {
        js +=
            "(function(d,s){" +
            stateKeys
                .map((key) => {
                    const k = serializeForScript(key)
                    return `d[${k}]=${serializeForScript(state?.[key])};if(s)s[${k}]=d[${k}];`
                })
                .join("") +
            "})(window.__CATALYST_DEFERRED_STATE__=window.__CATALYST_DEFERRED_STATE__||{},window.__INITIAL_STATE__);"
    }
    if (redirect) {
        js += `window.location.${mode === "assign" ? "assign" : "replace"}(${serializeForScript(redirect)});`
    }
    return js
}

// React's use() reads a settled thenable synchronously when it carries status/value, so a
// section whose work is already done renders without its fallback (no suspension).
const track = (thenable) => {
    thenable.status = "pending"
    thenable.then(
        (value) => {
            thenable.status = "fulfilled"
            thenable.value = value
        },
        (reason) => {
            thenable.status = "rejected"
            thenable.reason = reason
        }
    )
    return thenable
}

/**
 * One registry per request. `defer` is what serverFetchers receive in their second argument.
 * @param {object} options
 * @param {object} options.store this request's store; the deferred state slices are read from it
 * @param {boolean} options.blocking await every deferred promise before rendering
 * @param {(name: string, error: any) => void} [options.onSettledError] reports a failed promise
 * @param {object} [options.logger]
 */
export const createDeferredRegistry = ({
    store,
    blocking = false,
    onSettledError,
    logger = console,
} = {}) => {
    const entries = new Map()

    const outcome = (name, keys, result) => {
        let state = {}
        try {
            state = store?.getState?.() ?? {}
        } catch (error) {
            logger?.error?.(`[defer] could not read the store for "${name}":`, error)
        }
        return { ...result, html: buildDeferredScript({ name, stateKeys: keys, state, ...result }) }
    }

    /**
     * Hands slow route data to the response stream.
     * @param {string} name unique per request; the `<Deferred name>` with this name renders the section
     * @param {Promise<any>} promise the work; it updates the store itself (e.g. a dispatched thunk)
     * @param {{ stateKeys?: string[], onError?: (error: any) => string | { redirect: string, mode?: "assign" | "replace" } | null }} [options]
     *   stateKeys: the store slices the work changes, handed to the client when it settles. Do not
     *   list slices the shell already rendered (e.g. the header's): they hydrate against the shell.
     *   onError: maps a failure to a redirect, the one the server would have issued had it waited.
     * @returns the promise it was given
     */
    const defer = (name, promise, { stateKeys = [], onError } = {}) => {
        if (typeof name !== "string" || !name) {
            throw new TypeError("defer(name, promise): name must be a non-empty string")
        }
        if (entries.has(name)) {
            logger?.warn?.(`[defer] "${name}" was deferred twice in one request; the second call is ignored`)
            // Nothing waits for the ignored work, so its failure must not become an unhandled rejection.
            Promise.resolve(promise).catch(() => {})
            return promise
        }
        const keys = Array.isArray(stateKeys) ? stateKeys.filter((key) => typeof key === "string") : []
        const settled = Promise.resolve(promise).then(
            () => ({ ok: true, error: null, redirect: null, mode: "replace" }),
            (error) => {
                try {
                    onSettledError?.(name, error)
                } catch (hookError) {
                    logger?.error?.(`[defer] reporting the failure of "${name}" threw:`, hookError)
                }
                let mapped = null
                try {
                    mapped = typeof onError === "function" ? onError(error) : null
                } catch (hookError) {
                    logger?.error?.(`[defer] onError for "${name}" threw:`, hookError)
                }
                const { redirect, mode } = toRedirect(mapped)
                if (redirect && !isSafeRedirect(redirect)) {
                    logger?.error?.(`[defer] refused an unsafe redirect for "${name}"`)
                    return { ok: false, error, redirect: null, mode }
                }
                return { ok: false, error, redirect, mode }
            }
        )
        const result = track(settled.then((r) => outcome(name, keys, r)))
        entries.set(name, { name, stateKeys: keys, result })
        return promise
    }

    return {
        defer,
        blocking: Boolean(blocking),
        get: (name) => entries.get(name),
        get size() {
            return entries.size
        },
        /** True when deferred sections will stream after the shell. */
        get isStreaming() {
            return !blocking && entries.size > 0
        },
        /** Every deferred result (they never reject), in the order they were deferred. */
        settleAll: () => Promise.all(Array.from(entries.values(), (entry) => entry.result)),
    }
}

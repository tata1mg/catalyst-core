/**
 * Deferred route data (server).
 *
 * A serverFetcher can hand slow work to `defer(name, promise)` and return without awaiting it.
 * The response then goes out at once (document, header, the section's fallback) and the section
 * wrapped in `<Deferred name>` streams into the same response when the work settles (see
 * web-router/components/Deferred.jsx). On a PPR route the work does not hold the resumed app
 * either: the route boundary waits for the serverFetchers, which no longer wait for it.
 *
 * defer() must be called before the serverFetcher's promise settles: the registry is sealed when
 * rendering starts, and a later call is ignored (with a warning).
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

// Upper bound for deferred work: on the streaming path React sends what is still pending to the
// client to render and ends the response; a blocking request gets an error status (504). PPR
// routes use PPR_RESUME_TIMEOUT_MS for their sections.
export const DEFER_TIMEOUT_MS = () => {
    const n = Number(process.env.DEFER_TIMEOUT_MS)
    return Number.isFinite(n) && n > 0 ? n : 15000
}
// Reasons Catalyst aborts a render with; each is reported once where it happens.
export const DEFER_TIMED_OUT = "Deferred data timed out"
export const DEFER_CLIENT_GONE = "Render stopped: client disconnected"
export const RENDER_STOPPED = "Render stopped: the response was already answered"
const OWN_ABORTS = new Set([DEFER_TIMED_OUT, DEFER_CLIENT_GONE, RENDER_STOPPED])
export const isDeferAbort = (error) => OWN_ABORTS.has(error?.message)

const isDev = () => process.env.NODE_ENV !== "production"

/**
 * Flushes the response at most once per event-loop turn while it streams. compression() holds
 * gzip output until its buffer fills, which would hold the shell until the deferred data arrives
 * anyway. Call it for every chunk that reached `res` (the 'data' event of the stream piped into
 * it), so parts written after a 'drain' are flushed too. Each flush ends a gzip block
 * (compression() uses Z_FULL_FLUSH), so flushing once per turn rather than per write keeps the
 * size overhead small: about 2% with one deferred section, 13% with ten.
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

// A deferred redirect runs as a script navigation, which would also run these schemes. This is
// not an open-redirect check: the URL comes from the app's own onError, which is trusted.
// Browsers ignore whitespace and control characters inside the scheme ("java\tscript:").
const UNSAFE_SCHEME = /^(javascript|data|vbscript):/i
export const isSafeRedirect = (url) =>
    typeof url === "string" &&
    url.length > 0 &&
    !UNSAFE_SCHEME.test(url.replace(/[\u0000- \u007f-\u009f]/g, ""))

// onError may return a URL, or { redirect, mode, status }. "assign" keeps the page in history
// (and is what opens app deep links in a WebView); "replace" is the default. `status` (300-308)
// is used when the redirect can still be a real one (a blocking request); 302 otherwise.
const toRedirect = (mapped) => {
    if (typeof mapped === "string") return { redirect: mapped, mode: "replace", status: null }
    if (mapped && typeof mapped.redirect === "string") {
        const status =
            Number.isInteger(mapped.status) && mapped.status >= 300 && mapped.status <= 308
                ? mapped.status
                : null
        return { redirect: mapped.redirect, mode: mapped.mode === "assign" ? "assign" : "replace", status }
    }
    return { redirect: null, mode: "replace", status: null }
}

// Names and state keys become property names on the client.
const RESERVED = new Set(["__proto__", "constructor", "prototype"])

/**
 * The inline script a streamed `<Deferred>` section writes before its content:
 * - marks the section as server-streamed, so the client renders the same element and hydrates;
 * - hands the listed state slices to the client: into window.__INITIAL_STATE__ when it already
 *   exists, otherwise into window.__CATALYST_DEFERRED_STATE__, which the document's state script
 *   merges in (a section whose data was ready before the render started is written inside the
 *   shell, before that script). Values go through JSON.parse so every key stays a plain property;
 * - navigates when the work failed and onError mapped the failure to a redirect.
 * Keys whose slice is not in the store are left out.
 */
export const buildDeferredScript = ({
    name,
    stateKeys = [],
    state = {},
    redirect = null,
    mode = "replace",
}) => {
    let js = `(window.__CATALYST_DEFERRED__=window.__CATALYST_DEFERRED__||{})[${serializeForScript(name)}]=1;`
    const keys = stateKeys.filter((key) => state?.[key] !== undefined)
    if (keys.length) {
        js +=
            "(function(s){var d,v;" +
            keys
                .map((key) => {
                    const k = serializeForScript(key)
                    return (
                        `v=JSON.parse(${serializeForScript(JSON.stringify(state[key]) ?? "null")});` +
                        `if(s)s[${k}]=v;else(d=d||(window.__CATALYST_DEFERRED_STATE__=window.__CATALYST_DEFERRED_STATE__||{}))[${k}]=v;`
                    )
                })
                .join("") +
            "})(window.__INITIAL_STATE__);"
    }
    if (redirect) {
        js += `window.location.${mode === "assign" ? "assign" : "replace"}(${serializeForScript(redirect)});`
    }
    return js
}

/**
 * Run right after window.__INITIAL_STATE__ is assigned (Body.jsx): merges the slices of sections
 * written before it, then drops the temporary object. Only own properties of a plain object are
 * merged, so a DOM element with that id (named access on window) is ignored.
 */
export const DEFERRED_STATE_MERGE =
    ";(function(d,s){if(!d||!s||Object.getPrototypeOf(d)!==Object.prototype)return;" +
    "for(var k in d)if(Object.prototype.hasOwnProperty.call(d,k))s[k]=d[k];" +
    "try{delete window.__CATALYST_DEFERRED_STATE__}catch(e){}})(window.__CATALYST_DEFERRED_STATE__,window.__INITIAL_STATE__)"

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
 * @param {(name: string, error: any) => void} [options.onSettledError] reports a failure on a
 *   streaming request (a blocking request reports it through the fetcher error path instead)
 * @param {object} [options.logger]
 */
export const createDeferredRegistry = ({
    store,
    blocking = false,
    onSettledError,
    logger = console,
} = {}) => {
    const entries = new Map()
    let sealed = false
    let snapshot = null
    const warned = new Set()
    const warnOnce = (key, message) => {
        if (warned.has(key)) return
        warned.add(key)
        logger?.warn?.(message)
    }

    /**
     * Hands slow route data to the response stream.
     * @param {string} name unique per request; the `<Deferred name>` with this name renders the section
     * @param {Promise<any>} promise the work; it updates the store itself (e.g. a dispatched thunk)
     * @param {{ stateKeys?: string[], onError?: (error: any) => string | { redirect: string, mode?: "assign" | "replace", status?: number } | null }} [options]
     *   stateKeys: the store slices the work changes, handed to the client when the section renders.
     *   Do not list slices the shell already rendered (e.g. the header's): they hydrate against the
     *   shell. A section must not render other slices the work changes: the client gets only these.
     *   onError: maps a failure to a redirect, the one the server would have issued had it waited.
     * @returns the promise it was given
     */
    const defer = (name, promise, { stateKeys = [], onError } = {}) => {
        if (typeof name !== "string" || !name || RESERVED.has(name)) {
            throw new TypeError(
                "defer(name, promise): name must be a non-empty string other than __proto__, constructor or prototype"
            )
        }
        const ignore = (message) => {
            logger?.warn?.(message)
            // Nothing waits for the ignored work, so its failure must not become an unhandled rejection.
            Promise.resolve(promise).catch(() => {})
            return promise
        }
        if (sealed) {
            return ignore(
                `[defer] "${name}" was deferred after rendering started and is ignored; call defer() before the serverFetcher's promise settles`
            )
        }
        if (entries.has(name)) {
            return ignore(`[defer] "${name}" was deferred twice in one request; the second call is ignored`)
        }
        const list = Array.isArray(stateKeys) ? stateKeys : []
        const keys = list.filter((key) => typeof key === "string" && key && !RESERVED.has(key))
        if (isDev() && (keys.length !== list.length || (!keys.length && !blocking))) {
            logger?.warn?.(
                `[defer] "${name}": stateKeys is missing or has invalid entries; the client gets only the listed store slices, so a section that renders other data from this work will not hydrate`
            )
        }
        const settled = Promise.resolve(promise).then(
            () => ({ name, ok: true, error: null, redirect: null, mode: "replace", status: null }),
            (error) => {
                if (!blocking) {
                    try {
                        onSettledError?.(name, error)
                    } catch (hookError) {
                        logger?.error?.(`[defer] reporting the failure of "${name}" threw:`, hookError)
                    }
                }
                let mapped = null
                try {
                    mapped = typeof onError === "function" ? onError(error) : null
                } catch (hookError) {
                    logger?.error?.(`[defer] onError for "${name}" threw:`, hookError)
                }
                const { redirect, mode, status } = toRedirect(mapped)
                if (redirect && !isSafeRedirect(redirect)) {
                    logger?.error?.(`[defer] refused an unsafe redirect for "${name}"`)
                    return { name, ok: false, error, redirect: null, mode, status: null }
                }
                return { name, ok: false, error, redirect, mode, status }
            }
        )
        entries.set(name, { name, stateKeys: keys, result: track(settled) })
        return promise
    }

    // Slices listed by some deferred work, so the client gets them.
    const listedKeys = () => new Set(Array.from(entries.values(), (entry) => entry.stateKeys).flat())

    /**
     * The section's script, built when it renders, so it carries the same store state the
     * section's HTML is rendered from. Never throws: a slice that cannot be serialized is
     * reported and the script then only marks the section.
     */
    const scriptFor = (name, outcome) => {
        const entry = entries.get(name)
        let state = {}
        try {
            state = store?.getState?.() ?? {}
        } catch (error) {
            logger?.error?.(`[defer] could not read the store for "${name}":`, error)
        }
        const keys = entry?.stateKeys || []
        if (isDev()) {
            for (const key of keys) {
                if (state?.[key] === undefined) {
                    warnOnce(
                        `missing:${key}`,
                        `[defer] "${name}": stateKeys names "${key}", which is not in the store`
                    )
                }
            }
            if (snapshot) {
                const listed = listedKeys()
                const changed = Object.keys(state || {}).filter(
                    (key) => state[key] !== snapshot[key] && !listed.has(key)
                )
                if (changed.length) {
                    warnOnce(
                        `changed:${changed.join(",")}`,
                        `[defer] store slices changed after the shell but are not in any stateKeys: ${changed.join(", ")}. The client does not get them; a section that renders them will not hydrate.`
                    )
                }
            }
        }
        try {
            return buildDeferredScript({
                name,
                stateKeys: keys,
                state,
                redirect: outcome?.redirect,
                mode: outcome?.mode,
            })
        } catch (error) {
            logger?.error?.(
                `[defer] the state of "${name}" could not be serialized; the client gets none of it:`,
                error
            )
            return buildDeferredScript({ name, redirect: outcome?.redirect, mode: outcome?.mode })
        }
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
        /** Called when rendering starts: later defer() calls are ignored. */
        seal() {
            sealed = true
        },
        /** The store state the shell is rendered from (dev check for unlisted slices). */
        setSnapshot(state) {
            snapshot = state
        },
        scriptFor,
        /** Names whose work has not settled yet. */
        pending: () =>
            Array.from(entries.values())
                .filter((entry) => entry.result.status === "pending")
                .map((entry) => entry.name),
        /** Every deferred result (they never reject), in the order they were deferred. */
        settleAll: () => Promise.all(Array.from(entries.values(), (entry) => entry.result)),
    }
}

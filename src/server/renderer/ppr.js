/**
 * Partial prerendering (PPR) helpers: shell cache, nonce placeholders, per-request
 * response guards and safe inline-script serialization.
 *
 * A PPR shell is built once per (pathname, app shell key) with prerenderToNodeStream and
 * replayed to every later request; the app itself is a postponed hole that resumes with
 * each request's data (see handler.jsx and web-router/components/PPR.jsx).
 */
import crypto from "node:crypto"

const toInt = (value, fallback) => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : fallback
}

// config.json → process.env. Off unless explicitly enabled: renderMode "ppr" routes take the
// classic path when PPR_ENABLE is not true, so it doubles as the production kill switch.
export const isPPREnabled = () => process.env.PPR_ENABLE === true || process.env.PPR_ENABLE === "true"
export const PPR_SHELL_CACHE_MAX = () => toInt(process.env.PPR_SHELL_CACHE_MAX, 50)
// Shell prerenders allowed to run at the same time (each is a full React render).
export const PPR_SHELL_BUILDS_MAX = () => toInt(process.env.PPR_SHELL_BUILDS_MAX, 8)
// How long the prerender waits for the static parts before it is cut (the hole never settles).
export const PPR_PRERENDER_SETTLE_MS = () => toInt(process.env.PPR_PRERENDER_SETTLE_MS, 50)
// Upper bound for the resumed (dynamic) part; on timeout React hands the rest to the client.
export const PPR_RESUME_TIMEOUT_MS = () => toInt(process.env.PPR_RESUME_TIMEOUT_MS, 15000)
// React's progressiveChunkSize for the prerender (kept in the postponed state for the resume).
// Smaller values write large nested Suspense boundaries as their own segments, revealed one
// by one in tree order, instead of one hidden segment that shows only once it has fully
// arrived. Unset = React's default (12800 bytes).
export const PPR_PROGRESSIVE_CHUNK_SIZE = () => toInt(process.env.PPR_PROGRESSIVE_CHUNK_SIZE, undefined)

/** Bounded LRU of built shells. Keys come from the URL, so the bound also caps memory. */
export class ShellCache {
    constructor() {
        this.map = new Map()
        this.inflight = new Map()
        // delete()/clear() bump these, so a build that started before them can't publish.
        this.epoch = 0
        this.versions = new Map()
    }
    token(key) {
        return `${this.epoch}:${this.versions.get(key) || 0}`
    }
    get(key) {
        const value = this.map.get(key)
        if (value) {
            this.map.delete(key)
            this.map.set(key, value)
        }
        return value
    }
    set(key, value) {
        this.map.delete(key)
        this.map.set(key, value)
        while (this.map.size > PPR_SHELL_CACHE_MAX()) this.map.delete(this.map.keys().next().value)
    }
    delete(key) {
        this.map.delete(key)
        this.inflight.delete(key)
        this.versions.set(key, (this.versions.get(key) || 0) + 1)
        if (this.versions.size > 10000) {
            // Bounded: start a new epoch (running builds then don't publish).
            this.versions.clear()
            this.epoch++
        }
    }
    clear() {
        this.map.clear()
        this.inflight.clear()
        this.versions.clear()
        this.epoch++
    }
    /** True when a new build for this key would exceed PPR_SHELL_BUILDS_MAX. */
    isSaturated(key, max = PPR_SHELL_BUILDS_MAX()) {
        return !this.inflight.has(key) && this.inflight.size >= max
    }
    /** One build per key at a time; concurrent requests for a missing shell share it. */
    async build(key, builder) {
        if (this.inflight.has(key)) return this.inflight.get(key)
        const token = this.token(key)
        const pending = (async () => {
            try {
                const shell = await builder()
                // Publish only if the key wasn't deleted/cleared while this build ran.
                if (shell && this.token(key) === token) this.set(key, shell)
                return shell
            } finally {
                if (this.inflight.get(key) === pending) this.inflight.delete(key)
            }
        })()
        this.inflight.set(key, pending)
        return pending
    }
    stats() {
        return { size: this.map.size, keys: Array.from(this.map.keys()), building: this.inflight.size }
    }
}

export const shellCache = new ShellCache()
export const clearPPRShellCache = () => shellCache.clear()
export const getPPRShellCacheStats = () => shellCache.stats()

/** Stable signature of the deferred CSS a route had learned when its shell was built. */
export const cssSignature = (paths = []) => [...paths].sort().join("|")

/** Same shape as a real nonce, unguessable, and unique per shell. */
export const createNoncePlaceholder = () => crypto.randomBytes(16).toString("hex")

export const applyNonce = (html, placeholder, nonce) =>
    placeholder ? html.split(placeholder).join(nonce || "") : html

// React 19.2 ends the prelude with `<script id="_R_">`, which records the first paint so that
// streamed Suspense content is revealed no sooner than 300 ms after it (reveal throttling).
// For a PPR shell that only delays the page replacing the skeleton, so by default the script
// is dropped and content is revealed on the next frame, as with React 19.0.
// PPR_REVEAL_THROTTLE=true keeps React's behaviour. React writes the script without the
// nonce option, so it gets the shell's nonce placeholder.
export const isRevealThrottleEnabled = () =>
    process.env.PPR_REVEAL_THROTTLE === true || process.env.PPR_REVEAL_THROTTLE === "true"
const REACT_REVEAL_TIMER = /<script id="_R_">[^<]*<\/script>/g
// Without the throttle React still holds each later reveal until 300 ms after the previous
// one ($RV records $RT); making $RT never a number reveals every segment on its next frame.
const NO_REVEAL_THROTTLE = (nonce) =>
    `<script${
        nonce ? ` nonce="${nonce}"` : ""
    }>Object.defineProperty(window,"$RT",{configurable:true,get:function(){},set:function(){}})</script>`
export const prepareReactScripts = (html, placeholder) => {
    if (!isRevealThrottleEnabled()) {
        const stripped = html.replace(REACT_REVEAL_TIMER, "")
        const at = stripped.indexOf("<body")
        const bodyOpenEnd = at === -1 ? -1 : stripped.indexOf(">", at) + 1
        return bodyOpenEnd > 0
            ? stripped.slice(0, bodyOpenEnd) + NO_REVEAL_THROTTLE(placeholder) + stripped.slice(bodyOpenEnd)
            : stripped
    }
    return placeholder
        ? html.split('<script id="_R_">').join(`<script id="_R_" nonce="${placeholder}">`)
        : html
}

/** JSON for an inline <script>: no `</script>` breakout, no U+2028/9 line terminators. */
export const serializeForScript = (value) =>
    JSON.stringify(value === undefined ? null : value)
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029")

const serializeCookie = (name, value, options = {}) => {
    const v = typeof value === "object" ? "j:" + JSON.stringify(value) : String(value)
    let out = `${encodeURIComponent(name)}=${encodeURIComponent(v)}`
    const opts = { path: "/", ...options }
    if (opts.maxAge != null) {
        const ms = Number(opts.maxAge)
        out += `; Max-Age=${Math.floor(ms / 1000)}; Expires=${new Date(Date.now() + ms).toUTCString()}`
    } else if (opts.expires) {
        out += `; Expires=${new Date(opts.expires).toUTCString()}`
    }
    if (opts.domain) out += `; Domain=${opts.domain}`
    if (opts.path) out += `; Path=${opts.path}`
    if (opts.secure) out += "; Secure"
    if (opts.sameSite) out += `; SameSite=${opts.sameSite === true ? "Strict" : opts.sameSite}`
    return out
}

/**
 * On a PPR request the status line and headers go out with the shell, before route data
 * is fetched. serverFetcher code and app hooks written for the classic path may still call
 * res.cookie / res.redirect / res.setHeader afterwards, which would throw
 * ERR_HTTP_HEADERS_SENT and fail the data fetch. This guard keeps those calls working:
 * cookies set after the flush are replayed with document.cookie (httpOnly/signed ones
 * cannot be, so they are logged), and a late redirect becomes a client-side location.replace.
 * Returns { scripts(), restore() }.
 */
export const guardLateResponseCalls = (res, logger = console) => {
    const names = ["cookie", "clearCookie", "redirect", "setHeader"]
    const original = Object.fromEntries(names.map((n) => [n, res[n]]))
    const ownBefore = new Set(names.filter((n) => Object.prototype.hasOwnProperty.call(res, n)))
    const cookies = []
    let redirectTo = null
    const warn = (message) => logger?.warn?.(`[PPR] ${message}`)

    res.cookie = function (name, value, options = {}) {
        if (!res.headersSent) return original.cookie.call(this, name, value, options)
        if (options.httpOnly || options.signed) {
            warn(`cookie "${name}" set after the shell was sent is httpOnly/signed and was dropped`)
        } else {
            cookies.push(serializeCookie(name, value, options))
        }
        return this
    }
    res.clearCookie = function (name, options = {}) {
        if (!res.headersSent) return original.clearCookie.call(this, name, options)
        cookies.push(serializeCookie(name, "", { ...options, expires: new Date(1), maxAge: undefined }))
        return this
    }
    res.redirect = function (statusOrUrl, maybeUrl) {
        if (!res.headersSent) return original.redirect.apply(this, arguments)
        redirectTo = typeof statusOrUrl === "number" ? maybeUrl : statusOrUrl
        return this
    }
    res.setHeader = function (name, value) {
        if (!res.headersSent) return original.setHeader.call(this, name, value)
        warn(`header "${name}" set after the shell was sent was ignored`)
        return this
    }

    return {
        get redirectTo() {
            return redirectTo
        },
        scripts(nonce) {
            const nonceAttr = nonce ? ` nonce="${nonce}"` : ""
            let js = ""
            for (const c of cookies) js += `document.cookie=${serializeForScript(c)};`
            if (redirectTo) js += `window.location.replace(${serializeForScript(redirectTo)});`
            return js ? `<script${nonceAttr}>${js}</script>` : ""
        },
        restore() {
            for (const n of names) {
                if (ownBefore.has(n)) res[n] = original[n]
                else delete res[n]
            }
        },
    }
}

// ── Learned LCP image preloads ───────────────────────────────────────────
// On the classic path React hoists `<link rel="preload" as="image" fetchPriority="high">` for
// the page's priority images (the LCP banner) to the top of <head>, so the image starts
// downloading with the first bytes. A PPR shell is built before the data exists, so those
// preloads would only arrive with the resumed app, after the whole head. Each PPR response
// records the priority image preloads React wrote for the resumed app; later responses with
// the same preload key get them at the top of the head. PPR_LEARN_PRELOADS=false turns it off.
//
// A wrong preload is worse than none: it downloads an image the page never shows, on the
// connection the real LCP image needs. So:
// - the preload key is the shell key plus getPPRPreloadKey() from the app's server hooks,
//   which must cover every request property that changes image URLs (e.g. a device pixel
//   ratio or screen width read from a cookie); otherwise one visitor's image URLs would be
//   preloaded for the next visitors, who render different ones;
// - a preload is replayed only after the last two responses for that key both wrote it, so
//   per-user or rotating images are not preloaded for the next visitor.
export const isPreloadLearningEnabled = () =>
    !(process.env.PPR_LEARN_PRELOADS === false || process.env.PPR_LEARN_PRELOADS === "false")
const PRIORITY_IMAGE_PRELOAD = /<link rel="preload" as="image"[^>]*fetchPriority="high"[^>]*\/?>/g
export const MAX_LEARNED_PRELOADS = 4

export class PreloadLearner {
    constructor(maxKeys = 1000) {
        this.maxKeys = maxKeys
        this.entries = new Map() // preload key → { last: string[], stable: string[] }
    }
    /** Preloads to write at the top of the head for this key. */
    get(key) {
        return this.entries.get(key)?.stable || []
    }
    /** Records the priority preloads one resumed response wrote. */
    record(key, seen) {
        const prev = this.entries.get(key)
        const stable = prev ? seen.filter((p) => prev.last.includes(p)) : []
        if (!prev && this.entries.size >= this.maxKeys) this.entries.clear()
        this.entries.set(key, { last: seen, stable })
    }
}

export const extractPriorityImagePreloads = (html) => {
    const found = []
    for (const m of html.matchAll(PRIORITY_IMAGE_PRELOAD)) {
        if (!found.includes(m[0])) found.push(m[0])
        if (found.length >= MAX_LEARNED_PRELOADS) break
    }
    return found
}

/** Where React would hoist preloads: before the first <link> in <head> (after charset/viewport). */
export const findHeadPreloadOffset = (html) => {
    const head = html.indexOf("<head")
    if (head === -1) return -1
    const headOpenEnd = html.indexOf(">", head) + 1
    const headEnd = html.indexOf("</head>", headOpenEnd)
    const firstLink = html.indexOf("<link", headOpenEnd)
    return firstLink !== -1 && (headEnd === -1 || firstLink < headEnd) ? firstLink : headOpenEnd
}

export const insertAt = (html, offset, text) =>
    offset > 0 && text ? html.slice(0, offset) + text + html.slice(offset) : html

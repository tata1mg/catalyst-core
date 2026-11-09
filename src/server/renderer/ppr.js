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
// How long the prerender waits for the static parts before it is cut (the hole never settles).
export const PPR_PRERENDER_SETTLE_MS = () => toInt(process.env.PPR_PRERENDER_SETTLE_MS, 50)
// Upper bound for the resumed (dynamic) part; on timeout React hands the rest to the client.
export const PPR_RESUME_TIMEOUT_MS = () => toInt(process.env.PPR_RESUME_TIMEOUT_MS, 15000)

/** Bounded LRU of built shells. Keys come from the URL, so the bound also caps memory. */
export class ShellCache {
    constructor() {
        this.map = new Map()
        this.inflight = new Map()
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
    }
    clear() {
        this.map.clear()
        this.inflight.clear()
    }
    /** One build per key at a time; concurrent requests for a missing shell share it. */
    async build(key, builder) {
        if (this.inflight.has(key)) return this.inflight.get(key)
        const pending = (async () => {
            try {
                const shell = await builder()
                if (shell) this.set(key, shell)
                return shell
            } finally {
                this.inflight.delete(key)
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

// React 19.2 writes `<script id="_R_">` into the prelude without the nonce option.
export const addNonceToReactScripts = (html, placeholder) =>
    placeholder ? html.split('<script id="_R_">').join(`<script id="_R_" nonce="${placeholder}">`) : html

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

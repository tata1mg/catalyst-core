import crypto from "node:crypto"

// Config-driven (config.json → CSP_NONCE_ENABLE): when on, every script Catalyst
// renders carries a per-request nonce, so the app can serve a nonce-based CSP
// without 'unsafe-inline'. Off by default. Same boolean contract as OTEL_ENABLE.
export const isCspNonceEnabled = () => (process.env.CSP_NONCE_ENABLE as any) === true

export const generateNonce = () => crypto.randomBytes(16).toString("base64")

// A nonce goes into raw HTML strings as well as React props, so only the
// base64 alphabet a CSP nonce may use is accepted.
export const isValidNonce = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Za-z0-9+/_-]+={0,2}$/.test(value)

/**
 * Puts the request's nonce on `res.locals.cspNonce`. Mounted before the app's
 * own middlewares, so a middleware in `addMiddlewares` can read it and set a
 * matching Content-Security-Policy header. An app that makes its own nonce
 * overwrites the value, and the renderer uses that one.
 */
export const cspNonceMiddleware = (_req: any, res: any, next: any) => {
    if (isCspNonceEnabled()) {
        res.locals = res.locals || {}
        res.locals.cspNonce = generateNonce()
    }
    next()
}

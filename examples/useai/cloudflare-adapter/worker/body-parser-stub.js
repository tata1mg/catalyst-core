// Stubbing body-parser drops its raw-body/iconv-lite dependency chain, which relies on
// Node stream internals that don't run cleanly on workerd. Most of this app's routes are
// GET (no body to parse, hence the other three exports staying a no-op passthrough), but
// catalyst-ai's /ai/:provider/{stream,generate} routes are POST+JSON, so `json()` needs a
// real (if minimal) implementation rather than a passthrough - without it req.body is
// always undefined and every AI request 400s with "messages must be a non-empty array".
// This reads the request body directly off workerd's real Node-compat IncomingMessage
// stream, which is exactly what httpServerHandler is documented to support - no
// raw-body/iconv-lite needed for the JSON case.
export const json = () => (req, res, next) => {
    if (!/^(POST|PUT|PATCH)$/i.test(req.method)) return next()
    const contentType = req.headers["content-type"] || ""
    if (!contentType.includes("application/json")) return next()

    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8")
        try {
            req.body = raw ? JSON.parse(raw) : {}
        } catch (e) {
            res.status(400).json({ error: `Invalid JSON body: ${e.message}` })
            return
        }
        next()
    })
    req.on("error", next)
}

const passthrough = () => (req, res, next) => next()
export const raw = passthrough
export const text = passthrough
export const urlencoded = passthrough
export default { json, raw, text, urlencoded }

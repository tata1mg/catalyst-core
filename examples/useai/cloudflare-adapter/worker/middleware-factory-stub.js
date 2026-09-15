// No-op Express middleware factory. Used for `compression` (Cloudflare compresses at the
// edge) and `express-static-gzip` (Workers Assets serves static files) — both are
// factories called as `default(...)` that return a middleware.
const factory = () => (req, res, next) => next()
export default factory

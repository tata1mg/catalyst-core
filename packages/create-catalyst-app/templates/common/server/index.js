// Server lifecycle hooks. Every export is optional: delete the ones you don't use.
// They are listed in the order Catalyst calls them.
// Docs: https://catalyst.1mg.com/content/API%20Reference/ssr-lifecycle

// Runs once before the server starts, in dev and production. Values from
// config/config.json are already on process.env. Catalyst waits for it, so
// async setup (logger, telemetry, connections) is fine here.
export const preServerInit = () => {}

// The hooks below run on every page request. Catalyst does not wait for them,
// so keep them synchronous: a redirect sent after an `await` arrives too late
// to stop the render. If a hook sends a response (res.redirect, res.status().send),
// Catalyst skips the rest of the request.

// Runs after the request URL is matched to your routes. Use it for auth checks,
// redirects and per-request setup. Receives { req, res, matches, store }.
// Read the path from req.originalUrl; req.path is always "/" here.
export const onRouteMatch = () => {}

// Run after App.serverSideFunction resolves or throws.
// Receive { req, res, store }, plus `error` on failure.
export const onAppServerSideSuccess = () => {}
export const onAppServerSideError = () => {}

// onFetcherSuccess runs after the matched route's data has loaded. onFetcherError
// runs when loading that data or preparing the page (metadata, assets) fails; the
// page still renders, with the error's status_code (404 by default).
// Receive { req, res, store }, plus `error` on failure.
export const onFetcherSuccess = () => {}
export const onFetcherError = () => {}

// Runs when React fails to render the page on the server.
// Receives { req, res, store, error }.
export const onRenderError = () => {}

// Runs when anything else in the request throws. Catalyst then sends an error
// response. Receives { req, res, error }.
export const onRequestError = () => {}

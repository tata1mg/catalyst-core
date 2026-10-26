// Fixture server hooks for the SSR handler tests (#348). handler.jsx does
// `await import("@catalyst/template/server/index.js")` in a try/catch and
// wires whatever named exports exist (onRouteMatch, onFetcherSuccess,
// onFetcherError, onAppServerSideSuccess, onAppServerSideError,
// onRenderError, onRequestError).
//
// All left undefined by default so safeCall skips them. Tests that need a
// hook (e.g. to assert onRenderError fired) vi.spyOn / re-mock this
// module per-case.
export {}

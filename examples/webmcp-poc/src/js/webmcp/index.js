/**
 * WebMCP POC integration surface.
 *
 * Two public exports, matching what a real `catalyst-core/webmcp` subpath
 * would expose:
 *
 *   WebMcpProvider — framework glue. Mount once, inside RouterDataProvider,
 *     wrapping <App/>. Publishes route scope to useTool() and reaps stale
 *     route-scoped tools on navigation. Also mounts the dev panel.
 *
 *   useTool(spec) — register an imperative action tool for the lifetime of the
 *     calling component. Returns { status, receipt, error } — the receipt is a
 *     registration handle, deliberately not an execution result.
 *
 * Everything else in this folder (shim, registry, errors, DevPanel) is
 * implementation detail.
 */

export { WebMcpProvider } from "./WebMcpProvider.jsx"
export { useTool } from "./useTool.js"
export { WebMcpError, WEBMCP_ERROR_CODES } from "./errors.js"

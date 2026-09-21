/**
 * catalyst-core/webmcp — WebMCP integration for Catalyst apps.
 *
 * Public exports:
 *
 *   WebMcpProvider — framework glue. Mount once, inside RouterDataProvider,
 *     wrapping the app. Takes the app's OWN route table as `routes` (core
 *     cannot reach into an app's routing module the way the framework's own
 *     route preparation can). Publishes route scope to useTool() and reaps
 *     stale route-scoped tools on navigation.
 *
 *   useTool(spec, deps?) — register an imperative action tool for the
 *     lifetime of the calling component, or (with a `deps` array) refresh
 *     its description/inputSchema/annotations in place whenever a dep
 *     changes, without tearing the registration down. Returns
 *     { status, receipt, error } — the receipt is a registration handle,
 *     deliberately not an execution result.
 *
 *   WebMcpError / WEBMCP_ERROR_CODES — the typed error a tool's execute()
 *     should throw for a recoverable failure (bad args, not found, …) so an
 *     agent gets a `.code` to act on instead of an opaque message.
 *
 * A DOM shim for browsers without native `document.modelContext` support is
 * a SEPARATE opt-in subpath: `catalyst-core/webmcp/shim`. It is never
 * imported here — an app calls its `installShim()` itself, once, before
 * WebMcpProvider mounts, if it needs WebMCP to work without native support.
 * Likewise a dev panel (a way to exercise tools by hand without a real
 * agent) is an app-level concern, not shipped from core: subscribe to the
 * `webmcp:register` / `webmcp:unregister` / `webmcp:execute:start` /
 * `webmcp:execute:end` events this module's registry dispatches on
 * `document`, and call `inspect()`/`invokeTool()` — both exported here for
 * exactly that purpose.
 */

export { WebMcpProvider, flattenRoutes } from "./WebMcpProvider.jsx"
export { useTool } from "./useTool.js"
export { WebMcpError, WEBMCP_ERROR_CODES } from "./errors.js"
export { inspect, invokeTool, isNative } from "./registry.js"
export { declarativeToolFor, frameworkTools, toolNameFromPath, paramNames, fillPath, buildInputSchema } from "./declarative.js"
export { pageInfoTool, flattenHeadElements } from "./pageInfo.js"

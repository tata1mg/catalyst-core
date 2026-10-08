/**
 * catalyst-core/webmcp/shim — opt-in DOM shim for `document.modelContext`.
 *
 * Not imported by `catalyst-core/webmcp`'s own entry point. Call
 * `installShim()` once, before mounting WebMcpProvider, in any app that
 * wants WebMCP to work in a browser without native support.
 */
export { installShim } from "./shim.js"

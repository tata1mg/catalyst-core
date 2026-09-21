/**
 * Native `document.modelContext` detection — the part of WebMCP integration
 * that is genuinely framework-owned: there is one `document.modelContext`
 * per document, so there is one place that should decide whether a native
 * implementation is present.
 *
 * This module does NOT install anything. It only looks. Installing a
 * fallback (a DOM shim for browsers with no native WebMCP support yet, or an
 * in-memory stand-in for SSR/tests) is a separate concern — see
 * `catalyst-core/webmcp/shim` for the opt-in DOM shim, and registry.js's own
 * `createFallbackBackend()` for the SSR/test safety net. Neither of those
 * runs unless something explicitly calls it; importing this module alone
 * never touches `document`.
 */

/** Locate a native modelContext, checking both documented mount points. */
export function nativeModelContext() {
    if (typeof document !== "undefined" && document.modelContext && !document.modelContext.__isWebMcpShim) {
        return document.modelContext
    }
    if (typeof navigator !== "undefined" && navigator.modelContext && !navigator.modelContext.__isWebMcpShim) {
        return navigator.modelContext
    }
    return null
}

/** Whether a real (non-shim) `document.modelContext` is present right now. */
export function hasNative() {
    return !!nativeModelContext()
}

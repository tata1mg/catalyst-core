import { encode } from "turbo-stream"

// Base64, not for obfuscation: a raw turbo-stream chunk is opaque-ish text but
// isn't guaranteed HTML-embedding-safe (it could legitimately contain
// `</script`, `<`, or quote characters as part of an encoded string value).
// Base64's output alphabet ([A-Za-z0-9+/=]) can never form any of those
// sequences, sidestepping the "escape this for HTML" problem entirely.
const toBase64 = (text) => Buffer.from(text, "utf-8").toString("base64")

/**
 * Serializes `loaderPromiseMap` (turbo-stream) into a single inline <script>
 * string, meant to be pushed through the existing `tail` Transform's `flush()`
 * hook in handler.jsx — the same single-completion-path convention the deferred
 * asset script/style tags already use there (issue #320 / commit 9dc89c5).
 *
 * Not an incremental/streamed channel, deliberately: `flush()` only fires once
 * React's own `renderToPipeableStream` has finished writing — which, per
 * React's documented `onAllReady` semantics, is only after *every* Suspense
 * boundary has resolved, including ones fed by `use()` on a loader's deferred
 * fields. By the time this runs, every promise in `loaderPromiseMap` (critical
 * and deferred alike) is already settled — there's nothing left to stream
 * progressively for hydration's sake; the progressive *visible* rendering the
 * browser already saw came from React's own mid-stream writes, not from this.
 * So this is one snapshot, not a live reader loop.
 *
 * turbo-stream over `JSON.stringify` (`Body.jsx`'s mechanism for critical-only
 * legacy fetcher data): can express `Date`/`Map`/`Set`/`undefined`, which
 * `JSON.stringify` silently drops or mangles.
 *
 * @param {Object.<string, Promise<any>>} loaderPromiseMap
 * @returns {Promise<string>} empty string if there's nothing to encode
 */
export const encodeDeferredScript = async (loaderPromiseMap) => {
    if (!loaderPromiseMap || Object.keys(loaderPromiseMap).length === 0) return ""

    const reader = encode(loaderPromiseMap).getReader()
    let text = ""
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        text += value
    }

    return `<script>window.__CATALYST_LOADER_DATA__=${JSON.stringify(toBase64(text))}</script>`
}

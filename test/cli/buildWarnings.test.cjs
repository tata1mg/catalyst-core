"use strict"

const assert = require("node:assert/strict")
const { test } = require("node:test")

const { bundleWarnings } = require("../../src/cli/buildWarnings.js")

// Real shapes, copied from Vite/Rollup output rather than invented: the point
// of this function is that a warning survived the config filters and would
// otherwise be discarded on a green build.
const ROLLUP_CHUNK_SIZE = "(!) Some chunks are larger than 500 kB after minification."
const ROLLUP_CIRCULAR = "(!) Circular dependency: src/a.js -> src/b.js -> src/a.js"
const ROLLUP_PLAIN = 'Warning: "foo" is imported but never used'

test("keeps warnings and labels them with the bundle that produced them", () => {
    const output = [
        "vite v5.0.0 building for production...",
        ROLLUP_CHUNK_SIZE,
        "transforming (42) src/js/app.jsx",
        ROLLUP_CIRCULAR,
        "✓ built in 1.2s",
    ].join("\n")

    assert.deepEqual(bundleWarnings(output, "client"), [
        "client Some chunks are larger than 500 kB after minification.",
        "client Circular dependency: src/a.js -> src/b.js -> src/a.js",
    ])
})

test("strips the marker prefix but keeps the message", () => {
    assert.deepEqual(bundleWarnings(ROLLUP_PLAIN, "server"), ['server "foo" is imported but never used'])
})

test("ignores ordinary progress output", () => {
    const output = [
        "vite v5.0.0 building for production...",
        "transforming (12) src/x.js",
        "✓ built in 900ms",
    ].join("\n")
    assert.deepEqual(bundleWarnings(output, "client"), [])
})

test("sees through colour codes", () => {
    // Vite colours its warnings, so matching the raw line would silently stop
    // working the moment the child emits colour -- the exact bug that made the
    // dev-server line classifier fail once already.
    const esc = String.fromCharCode(27)
    const coloured = `${esc}[33m${ROLLUP_CHUNK_SIZE}${esc}[39m`
    assert.deepEqual(bundleWarnings(coloured, "client"), [
        "client Some chunks are larger than 500 kB after minification.",
    ])
})

test("reports each distinct warning once", () => {
    const output = [ROLLUP_CHUNK_SIZE, ROLLUP_CHUNK_SIZE, ROLLUP_CIRCULAR].join("\n")
    assert.equal(bundleWarnings(output, "client").length, 2)
})

test("keeps Rolldown warnings and skips its plugin timing report", () => {
    // Shapes from a real Vite 8.3.8 client build (code frames trimmed).
    const output = [
        "[EVAL] Use of direct `eval` function is strongly discouraged as it poses security risks and may cause issues with minification.",
        "       ╭─[ ../lottie-web/build/player/lottie.js:14422:33 ]",
        "[INEFFECTIVE_DYNAMIC_IMPORT] src/a.js is dynamically imported by src/b.js but also statically imported by src/c.js, dynamic import will not move module into another chunk.",
        "✓ built in 12.63s",
        "[PLUGIN_TIMINGS] JavaScript callbacks ran for 14.1s. The build took 12.6s.",
        "  - plugin route-manifest-plugin closeBundle (12%, 1.5s, 1 call)",
    ].join("\n")

    assert.deepEqual(bundleWarnings(output, "client"), [
        "client [EVAL] Use of direct `eval` function is strongly discouraged as it poses security risks and may cause issues with minification.",
        "client [INEFFECTIVE_DYNAMIC_IMPORT] src/a.js is dynamically imported by src/b.js but also statically imported by src/c.js, dynamic import will not move module into another chunk.",
    ])
})

test("returns nothing for empty or missing output", () => {
    assert.deepEqual(bundleWarnings("", "client"), [])
    assert.deepEqual(bundleWarnings(undefined, "client"), [])
})

"use strict"

const assert = require("node:assert/strict")
const { test } = require("node:test")

const { extractBuildErrors } = require("../../src/cli/buildErrors.js")
const { formatDevLine } = require("../../src/cli/devOutput.js")
const { runtimeFailure } = require("../../src/cli/diagnostic.js")
const { ANSI } = require("../../src/cli/theme.js")

const plain = (text) => (text == null ? text : String(text).replace(ANSI, ""))

// Copied from a real gradle run with no local.properties: not a compiler
// error, so the file:line patterns find nothing and the cause is only in
// gradle's own "What went wrong" block.
const GRADLE_SDK_MISSING = [
    "> Task :app:generateWebViewConfig",
    "BUILD SUCCESSFUL in 737ms",
    "FAILURE: Build failed with an exception.",
    "",
    "* What went wrong:",
    "Could not determine the dependencies of task ':app:compileDebugJavaWithJavac'.",
    "> SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable.",
    "",
    "* Try:",
    "> Run with --stacktrace option to get the stack trace.",
].join("\n")

test("extracts the cause from gradle's What went wrong block", () => {
    assert.deepEqual(extractBuildErrors(GRADLE_SDK_MISSING), [{ message: "SDK location not found." }])
})

test("leaves Vite output to the Vite patterns", () => {
    assert.deepEqual(extractBuildErrors(GRADLE_SDK_MISSING, { toolchain: "vite" }), [])
})

test("hides Vite dependency bookkeeping by default and keeps it under --verbose", () => {
    const line = "1:41:19 pm [vite] (client) Re-optimizing dependencies because lockfile has changed"
    assert.equal(formatDevLine(line, { seenWarnings: new Set(), verbose: false }), null)
    assert.match(plain(formatDevLine(line, { seenWarnings: new Set(), verbose: true })), /Re-optimizing/)
})

test("shows one reload line when both bundles report the same file", () => {
    const state = { seenWarnings: new Set(), verbose: false }
    const ssr = formatDevLine("2:00:01 pm [vite] (ssr) page reload src/js/Home.js", state)
    const client = formatDevLine("2:00:01 pm [vite] (client) page reload src/js/Home.js", state)
    assert.match(plain(ssr), /↻ src\/js\/Home\.js/)
    assert.equal(client, null)
})

test("drops Node's typeless-package warning unless verbose", () => {
    const line =
        "(node:123) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///app/server/index.js is not specified"
    assert.equal(formatDevLine(line, { seenWarnings: new Set(), verbose: false }), null)
})

test("points a runtime error at the app's own frame, not the library's", () => {
    const cwd = "/app"
    const error = new Error("boom")
    error.stack = [
        "Error: boom",
        "    at renderWithHooks (/app/node_modules/react-dom/cjs/server.js:10:5)",
        "    at Home (/app/src/js/Home.js:7:9)",
    ].join("\n")

    const out = plain(runtimeFailure({ error, code: "RUNTIME-WEB-001", scope: "GET /", cwd }))
    assert.match(out, /error RUNTIME-WEB-001 {2}GET \//)
    assert.match(out, /at src\/js\/Home\.js:7:9/)
    assert.doesNotMatch(out, /react-dom/)
})

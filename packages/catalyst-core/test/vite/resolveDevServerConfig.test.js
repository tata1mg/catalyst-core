import { test } from "node:test"
import assert from "node:assert/strict"

import {
    resolveDevBase,
    toMountPathPrefix,
    resolveDevFsAllow,
    buildDevServer,
} from "../../src/vite/resolveDevServerConfig.js"

// ─── resolveDevBase ───────────────────────────────────────────────────────────

test("resolveDevBase: resolves from devServer.base", () => {
    assert.equal(resolveDevBase({ base: "/o-mweb" }), "/o-mweb")
})

test("resolveDevBase: defaults to '/' when base is unset", () => {
    assert.equal(resolveDevBase({}), "/")
    assert.equal(resolveDevBase(undefined), "/")
    assert.equal(resolveDevBase({ base: "/" }), "/")
})

test("resolveDevBase: normalizes to a leading slash, no trailing slash", () => {
    assert.equal(resolveDevBase({ base: "o-mweb" }), "/o-mweb")
    assert.equal(resolveDevBase({ base: "/o-mweb/" }), "/o-mweb")
    assert.equal(resolveDevBase({ base: "  /o-mweb//  " }), "/o-mweb")
})

// ─── toMountPathPrefix ────────────────────────────────────────────────────────

test("toMountPathPrefix: root maps to empty string for clean URL joins", () => {
    assert.equal(toMountPathPrefix("/"), "")
    assert.equal(toMountPathPrefix(""), "")
    assert.equal(toMountPathPrefix(undefined), "")
})

test("toMountPathPrefix: trims Vite's trailing slash", () => {
    assert.equal(toMountPathPrefix("/o-mweb/"), "/o-mweb")
    assert.equal(toMountPathPrefix("/o-mweb"), "/o-mweb")
    // The joined result stays single-slashed.
    assert.equal(`${toMountPathPrefix("/o-mweb/")}/client/index.js`, "/o-mweb/client/index.js")
    assert.equal(`${toMountPathPrefix("/")}/client/index.js`, "/client/index.js")
})

// ─── resolveDevFsAllow: security-sensitive allowlist merge ─────────────────────

const FRAMEWORK = ["/app/src", "/framework/dist/vite"]

test("resolveDevFsAllow: framework paths always present, none provided", () => {
    assert.deepEqual(resolveDevFsAllow(undefined, FRAMEWORK), FRAMEWORK)
    assert.deepEqual(resolveDevFsAllow({}, FRAMEWORK), FRAMEWORK)
})

test("resolveDevFsAllow: apps may EXTEND but never drop framework paths", () => {
    const result = resolveDevFsAllow({ allow: ["/extra/pkg"] }, FRAMEWORK)
    assert.deepEqual(result, ["/app/src", "/framework/dist/vite", "/extra/pkg"])
})

test("resolveDevFsAllow: non-array allow is ignored (no widening via bad input)", () => {
    assert.deepEqual(resolveDevFsAllow({ allow: "/" }, FRAMEWORK), FRAMEWORK)
    assert.deepEqual(resolveDevFsAllow({ allow: null }, FRAMEWORK), FRAMEWORK)
})

// ─── buildDevServer: precedence + security ────────────────────────────────────

test("buildDevServer: hmr defaults to true in dev", () => {
    const server = buildDevServer({}, { frameworkPaths: FRAMEWORK, isProduction: false })
    assert.equal(server.hmr, true)
})

test("buildDevServer: hmr is false in production", () => {
    const server = buildDevServer({ hmr: { clientPort: 443 } }, { frameworkPaths: FRAMEWORK, isProduction: true })
    assert.equal(server.hmr, false)
})

test("buildDevServer: app hmr overrides are honored in dev", () => {
    const hmr = { clientPort: 443, path: "__vite_hmr" }
    const server = buildDevServer({ hmr }, { frameworkPaths: FRAMEWORK, isProduction: false })
    assert.deepEqual(server.hmr, hmr)
})

test("buildDevServer: passthrough keys (proxy/allowedHosts) are forwarded", () => {
    const server = buildDevServer(
        { allowedHosts: ["local.example.com"], proxy: { "/api": "http://localhost:9000" } },
        { frameworkPaths: FRAMEWORK, isProduction: false }
    )
    assert.deepEqual(server.allowedHosts, ["local.example.com"])
    assert.deepEqual(server.proxy, { "/api": "http://localhost:9000" })
})

test("buildDevServer: app fs cannot replace the allowlist, only extend it", () => {
    const server = buildDevServer(
        { fs: { allow: ["/extra"] } },
        { frameworkPaths: FRAMEWORK, isProduction: false }
    )
    assert.deepEqual(server.fs.allow, ["/app/src", "/framework/dist/vite", "/extra"])
})

test("buildDevServer: app cannot relax fs.strict or clobber fs via overrides", () => {
    const server = buildDevServer(
        { fs: { allow: ["/"], strict: false } },
        { frameworkPaths: FRAMEWORK, isProduction: false }
    )
    // strict is dropped entirely (framework keeps Vite's secure default), and
    // the framework paths remain — "/" is merely appended, not a replacement.
    assert.equal(server.fs.strict, undefined)
    assert.ok(server.fs.allow.includes("/app/src"))
})

test("buildDevServer: 'base' is not leaked into the server block", () => {
    const server = buildDevServer({ base: "/o-mweb" }, { frameworkPaths: FRAMEWORK, isProduction: false })
    assert.equal(server.base, undefined)
})

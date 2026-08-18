import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseAst } from "rollup/parseAst"
import { stripServerOnlyPlugin } from "../../src/vite/strip-server-only-plugin.js"

// Rollup's real acorn-based parser (the same one Vite passes as `this.parse` at
// build time) — not a hand-rolled mock, so a plugin bug in real AST shapes shows
// up here instead of only at an actual build.
const makePluginContext = () => ({
    parse: (code) => parseAst(code),
})

const withTempFile = (contents, fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strip-server-only-test-"))
    const filePath = path.join(dir, "example.server.js")
    fs.writeFileSync(filePath, contents)
    try {
        return fn(filePath)
    } finally {
        fs.rmSync(dir, { recursive: true, force: true })
    }
}

test("resolveId stubs an import ending .server.js, leaves everything else alone", async () => {
    const plugin = stripServerOnlyPlugin()
    const fakeContext = {
        resolve: async (source) => ({ id: `/resolved/${source}` }),
    }

    const stubbed = await plugin.resolveId.call(fakeContext, "./page.server.js", "/app/routes.js", {})
    assert.equal(stubbed, "\0catalyst-server-only-stub:/resolved/./page.server.js")

    const untouched = await plugin.resolveId.call(fakeContext, "./page.js", "/app/routes.js", {})
    assert.equal(untouched, null)
})

test("resolveId returns null when the real resolver can't find the module", async () => {
    const plugin = stripServerOnlyPlugin()
    const fakeContext = { resolve: async () => null }
    const result = await plugin.resolveId.call(fakeContext, "./missing.server.js", "/app/routes.js", {})
    assert.equal(result, null)
})

test("load returns null for an id it didn't stub", () => {
    const plugin = stripServerOnlyPlugin()
    assert.equal(plugin.load.call(makePluginContext(), "/some/normal/file.js"), null)
})

test("load builds a stub with a throwing function for each named export", () => {
    withTempFile(
        `export const loader = async () => ({ secret: "db-password-123" })\nexport function helper() {}\n`,
        (filePath) => {
            const plugin = stripServerOnlyPlugin()
            const stubId = `\0catalyst-server-only-stub:${filePath}`
            const source = plugin.load.call(makePluginContext(), stubId)

            assert.ok(source.includes("export const loader ="))
            assert.ok(source.includes("export const helper ="))
            // The real secret value must never appear in the stub source.
            assert.ok(!source.includes("db-password-123"))
        }
    )
})

test("load's stub throws a clear error when a stripped export is actually called", () => {
    withTempFile(`export const loader = async () => ({})\n`, (filePath) => {
        const plugin = stripServerOnlyPlugin()
        const stubId = `\0catalyst-server-only-stub:${filePath}`
        const source = plugin.load.call(makePluginContext(), stubId)

        // Evaluate the generated stub source for real, as a module, and confirm
        // calling the stubbed export throws with a useful message.
        const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
        return import(moduleUrl).then((mod) => {
            assert.throws(() => mod.loader(), /is server-only.*cannot run in the browser/)
        })
    })
})

test("load handles a default export", () => {
    withTempFile(`export default async function loader() { return {} }\n`, (filePath) => {
        const plugin = stripServerOnlyPlugin()
        const stubId = `\0catalyst-server-only-stub:${filePath}`
        const source = plugin.load.call(makePluginContext(), stubId)
        assert.ok(source.includes("export default"))
    })
})

test("load falls back to an inert stub if the real file can't be read", () => {
    const plugin = stripServerOnlyPlugin()
    const stubId = "\0catalyst-server-only-stub:/does/not/exist.server.js"
    const source = plugin.load.call(makePluginContext(), stubId)
    assert.equal(source, "export default undefined")
})

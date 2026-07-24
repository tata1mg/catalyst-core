import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep as pathSeparator } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"

import { load } from "../src/vite/node-loader.mjs"

const loadSource = async (source) => {
    const directory = mkdtempSync(join(tmpdir(), "catalyst-node-loader-"))
    const inputPath = join(directory, "input.jsx")
    writeFileSync(inputPath, source)

    return load(pathToFileURL(inputPath).href, {}, () => {
        throw new Error("Unexpected defaultLoad call")
    })
}

const importTransformed = async (source) => {
    const directory = mkdtempSync(join(tmpdir(), "catalyst-node-loader-output-"))
    const outputPath = join(directory, "output.mjs")
    writeFileSync(outputPath, source)
    return import(`${pathToFileURL(outputPath).href}?test=${Date.now()}-${Math.random()}`)
}

test("keeps ESM code samples containing module.exports as ESM", async () => {
    const result = await loadSource(`
        const sample = "module.exports = { plugins: [] }"
        export default sample
    `)
    const loaded = await importTransformed(result.source)

    assert.equal(loaded.default, "module.exports = { plugins: [] }")
})

test("lowers CommonJS application modules to an ESM default export", async () => {
    const result = await loadSource(`
        const path = require("node:path")
        module.exports = { separator: path.sep }
    `)
    const loaded = await importTransformed(result.source)

    assert.deepEqual(loaded.default, { separator: pathSeparator })
})

test("handles computed CommonJS exports without source-format guessing", async () => {
    const result = await loadSource(`exports["answer"] = 42`)
    const loaded = await importTransformed(result.source)

    assert.deepEqual(loaded.default, { answer: 42 })
})

test("transforms JSX inside CommonJS application modules", async () => {
    const result = await loadSource(`
        const Component = () => <main>Companion</main>
        module.exports = Component
    `)
    const loaded = await importTransformed(result.source)

    assert.equal(typeof loaded.default, "function")
})

test("preserves Node globals for transformed CommonJS modules", async () => {
    const result = await loadSource(`
        module.exports = {
            hasDirname: typeof __dirname === "string",
            hasFilename: typeof __filename === "string",
        }
    `)
    const loaded = await importTransformed(result.source)

    assert.deepEqual(loaded.default, { hasDirname: true, hasFilename: true })
})

test("does not treat a locally scoped module binding as CommonJS", async () => {
    const result = await loadSource(`
        const module = { exports: "local" }
        export default module.exports
    `)
    const loaded = await importTransformed(result.source)

    assert.equal(loaded.default, "local")
})

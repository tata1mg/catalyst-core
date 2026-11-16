import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { load } from "../../src/vite/node-loader.mjs"

// node-loader.mjs lets Node run app code that Vite never sees (the production
// server bundle, catalyst-core's own .jsx files). It transforms through Vite's
// Oxc, so esbuild is not needed at runtime. These cases pin the behaviour
// esbuild used to give: which files count as CommonJS, and classic-runtime JSX.

let dir: string

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-node-loader-"))
})

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
})

const defaultLoad = async () => ({ format: "module", source: "", shortCircuit: true })

async function loadFile(relativePath: string, source: string) {
    const filePath = path.join(dir, relativePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, source)
    const result = await load(pathToFileURL(filePath).href, {}, defaultLoad)
    return String(result.source)
}

const CJS_SHIM = "export default module.exports"

describe("node-loader CommonJS detection", () => {
    it("wraps a file that assigns module.exports", async () => {
        expect(await loadFile("cjs.js", "const x = 1\nmodule.exports = { x }\n")).toContain(CJS_SHIM)
    })

    it("wraps a file that assigns to exports", async () => {
        expect(await loadFile("exports.js", "exports.a = 1\n")).toContain(CJS_SHIM)
    })

    it("wraps a file that reads module behind a typeof guard", async () => {
        const source = 'if (typeof module !== "undefined") module.exports = 1\n'
        expect(await loadFile("guarded.js", source)).toContain(CJS_SHIM)
    })

    it("leaves ESM alone even when a string mentions module.exports", async () => {
        const source = 'const doc = "module.exports = {}"\nexport default doc\n'
        expect(await loadFile("esm.js", source)).not.toContain(CJS_SHIM)
    })

    it("leaves a script alone when module or exports only appear in a comment or string", async () => {
        const source = '// this module is loaded early\nglobalThis.msg = "see exports docs"\n'
        expect(await loadFile("script.js", source)).not.toContain(CJS_SHIM)
    })

    it("leaves a script alone when module and exports are only property names", async () => {
        const source = "globalThis.config.module = 1\nglobalThis.o = { exports: 1, module: 2 }\n"
        expect(await loadFile("props.js", source)).not.toContain(CJS_SHIM)
    })
})

describe("node-loader JSX transform", () => {
    it("compiles JSX in an app .js file to classic React.createElement calls", async () => {
        const source =
            'import React from "react"\nexport const A = () => <div className="x"><Foo bar /></div>\n'
        const code = await loadFile("component.js", source)
        expect(code).toContain('React.createElement("div", { className: "x" }')
        expect(code).toContain("React.createElement(Foo, { bar: true })")
        expect(code).not.toContain("<div")
    })

    it("compiles JSX in a CommonJS file and still wraps it", async () => {
        const source = 'const React = require("react")\nmodule.exports = () => <div />\n'
        const code = await loadFile("cjs-jsx.js", source)
        expect(code).toContain(CJS_SHIM)
        expect(code).toContain('React.createElement("div"')
    })

    it("compiles a .jsx file inside an ESM package in node_modules", async () => {
        // Like catalyst-core itself: "type": "module", shipping raw .jsx.
        fs.mkdirSync(path.join(dir, "node_modules/pkg"), { recursive: true })
        fs.writeFileSync(path.join(dir, "node_modules/pkg/package.json"), '{"type":"module"}')
        const source = 'import React from "react"\nexport const B = () => <span />\n'
        const code = await loadFile("node_modules/pkg/b.jsx", source)
        expect(code).toContain('React.createElement("span"')
    })
})

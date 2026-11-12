// Client bundles import the package entry (src/index.jsx). Catalyst's own modules in it must load
// in a browser, without Node globals such as Buffer. npm run test:client
import { test } from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

test("Catalyst's own modules in the package entry load without Node globals", async () => {
    const { outputFiles } = await build({
        entryPoints: [fileURLToPath(new URL("../src/index.jsx", import.meta.url))],
        bundle: true,
        write: false,
        platform: "browser",
        format: "cjs",
        jsx: "automatic",
        packages: "external",
        logLevel: "silent",
    })
    // Every npm package (and node: builtin) stays external and a stub stands in for it, so only
    // Catalyst's own top-level code runs here.
    // esbuild copies a CommonJS module's exports onto an object that inherits from its prototype,
    // so the prototype answers every named export too.
    const anyExport = new Proxy({}, { get: (_target, key) => (key === Symbol.toPrimitive ? () => "" : stub) })
    const stub = new Proxy(function () {}, {
        get: (_target, key) => (key === "__esModule" ? true : key === Symbol.toPrimitive ? () => "" : stub),
        getPrototypeOf: () => anyExport,
        apply: () => stub,
        construct: () => stub,
    })
    const module = { exports: {} }
    const context = vm.createContext({
        module,
        require: () => stub,
        window: {},
        document: {},
        navigator: {},
        console,
    })
    vm.runInContext(
        `(function (module, exports, require) {${outputFiles[0].text}\n})(module, module.exports, require)`,
        context
    )
    assert.ok("Deferred" in module.exports && "Body" in module.exports)
})

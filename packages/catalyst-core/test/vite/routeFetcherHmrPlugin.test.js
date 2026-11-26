import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { fetcherFingerprints, routeFetcherHmrPlugin } from "../../src/vite/routeFetcherHmrPlugin.js"

// A tiny app: a page whose clientFetcher uses a page constant and a helper,
// whose component uses another helper, plus a stylesheet import.
function makeApp() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fetcher-hmr-"))
    const write = (file, text) => fs.writeFileSync(path.join(dir, file), text)
    write("fetchHelper.js", `export const prefix = "client"\nexport const unused = "u1"\n`)
    write("uiHelper.js", `export const label = "ui1"\n`)
    write("page.css", `h1 { color: red }\n`)
    write(
        "Page.js",
        `import React from "react"
import "./page.css"
import { prefix } from "./fetchHelper"
import { label } from "./uiHelper"

const SUFFIX = "s1"

const Page = () => <h1>PAGE_V1 {label}</h1>

Page.clientFetcher = async () => ({ stamp: prefix + SUFFIX })
Page.serverFetcher = async () => ({ stamp: "server" })

export default Page
`
    )
    // Resolves relative imports like Vite would, adding the .js extension.
    const resolve = async (spec, importer) => {
        if (!spec.startsWith(".")) return { id: spec, external: true }
        const base = path.resolve(path.dirname(importer), spec)
        return { id: fs.existsSync(base) ? base : `${base}.js` }
    }
    const page = path.join(dir, "Page.js")
    const fingerprint = async () =>
        (await fetcherFingerprints(page, fs.readFileSync(page, "utf8"), resolve)).fingerprints
    const edit = (file, from, to) => {
        const full = path.join(dir, file)
        const text = fs.readFileSync(full, "utf8")
        assert.ok(text.includes(from), `${file} contains ${from}`)
        fs.writeFileSync(full, text.replace(from, to))
    }
    return { dir, write, edit, fingerprint, resolve, page }
}

const cases = [
    ["JSX edit", "Page.js", "PAGE_V1", "PAGE_V2", { client: false, server: false }],
    ["helper used only by the component", "uiHelper.js", "ui1", "ui2", { client: false, server: false }],
    ["stylesheet edit", "page.css", "red", "blue", { client: false, server: false }],
    [
        "unused export of the fetcher's helper",
        "fetchHelper.js",
        '"u1"',
        '"u2"',
        { client: false, server: false },
    ],
    ["serverFetcher edit", "Page.js", '"server"', '"server2"', { client: false, server: true }],
    ["page constant the fetcher reads", "Page.js", '"s1"', '"s2"', { client: true, server: false }],
    ["helper the fetcher uses", "fetchHelper.js", '"client"', '"client2"', { client: true, server: false }],
    ["fetcher body edit", "Page.js", "stamp: prefix", "stamp: 'x' + prefix", { client: true, server: false }],
]

for (const [name, file, from, to, expected] of cases) {
    test(`fetcherFingerprints: ${name}`, async () => {
        const app = makeApp()
        try {
            const before = await app.fingerprint()
            app.edit(file, from, to)
            const after = await app.fingerprint()
            assert.deepEqual(
                {
                    client: before.clientFetcher !== after.clientFetcher,
                    server: before.serverFetcher !== after.serverFetcher,
                },
                expected
            )
        } finally {
            fs.rmSync(app.dir, { recursive: true, force: true })
        }
    })
}

test("fetcherFingerprints: memo-wrapped and TypeScript pages ignore JSX edits", async () => {
    const app = makeApp()
    try {
        const page = path.join(app.dir, "MemoPage.tsx")
        const source = (text) => `import React, { memo } from "react"
const LIMIT: number = 10
const Page = memo(() => <h1>${text}</h1>) as any
Page.clientFetcher = async () => ({ limit: LIMIT })
export default Page
`
        const fp = async (text) =>
            (await fetcherFingerprints(page, source(text), app.resolve)).fingerprints.clientFetcher
        assert.equal(await fp("A"), await fp("B"))
        assert.notEqual(
            await fp("A"),
            (await fetcherFingerprints(page, source("A").replace("10", "20"), app.resolve)).fingerprints
                .clientFetcher
        )
    } finally {
        fs.rmSync(app.dir, { recursive: true, force: true })
    }
})

test("fetcherFingerprints: class pages count as changed on every edit", async () => {
    // Class statics aren't followed, so these pages refetch on any edit rather than go stale.
    const app = makeApp()
    const page = path.join(app.dir, "ClassPage.js")
    const source = (heading, value) => `import React from "react"
export default class Page extends React.Component {
    static async clientFetcher() { return { value: ${value} } }
    render() { return <h1>${heading}</h1> }
}
`
    const fp = async (heading, value) =>
        (await fetcherFingerprints(page, source(heading, value), app.resolve)).fingerprints
    try {
        const base = await fp("A", 1)
        assert.equal(base.clientFetcher, "unknown")
        assert.equal(base.serverFetcher, "none")
    } finally {
        fs.rmSync(app.dir, { recursive: true, force: true })
    }
})

test("fetcherFingerprints: a page it can't analyse is unknown", async () => {
    const page = path.join(os.tmpdir(), "Broken.js")
    const result = await fetcherFingerprints(page, "Page.clientFetcher = () => {", async () => null)
    assert.ok(result.error)
    assert.equal(result.fingerprints.clientFetcher, "unknown")
})

test("routeFetcherHmrPlugin: instruments only client modules that define a fetcher", async () => {
    const app = makeApp()
    const plugin = routeFetcherHmrPlugin()
    const ctx = { resolve: app.resolve, warn: () => {} }
    try {
        const code = fs.readFileSync(app.page, "utf8")
        const out = await plugin.transform.call(ctx, code, app.page, {})
        assert.match(out.code, /catalyst:route-module-updated/)
        assert.equal(await plugin.transform.call(ctx, code, app.page, { ssr: true }), null)
        const helper = path.join(app.dir, "uiHelper.js")
        assert.equal(await plugin.transform.call(ctx, fs.readFileSync(helper, "utf8"), helper, {}), null)
    } finally {
        fs.rmSync(app.dir, { recursive: true, force: true })
    }
})

test("routeFetcherHmrPlugin: reloads once when a loaded module gains its first fetcher", async () => {
    const app = makeApp()
    const plugin = routeFetcherHmrPlugin()
    const sent = []
    plugin.configureServer({ ws: { send: (msg) => sent.push(msg) } })
    const ctx = { resolve: app.resolve, warn: () => {} }
    const file = path.join(app.dir, "Plain.js")
    try {
        app.write("Plain.js", `const Plain = () => null\nexport default Plain\n`)
        assert.equal(await plugin.transform.call(ctx, fs.readFileSync(file, "utf8"), file, {}), null)
        app.write(
            "Plain.js",
            `const Plain = () => null\nPlain.clientFetcher = async () => 1\nexport default Plain\n`
        )
        await plugin.transform.call(ctx, fs.readFileSync(file, "utf8"), file, {})
        await plugin.transform.call(ctx, fs.readFileSync(file, "utf8"), file, {})
        await new Promise((resolve) => setTimeout(resolve, 10))
        assert.deepEqual(sent, [{ type: "full-reload" }])
    } finally {
        fs.rmSync(app.dir, { recursive: true, force: true })
    }
})

test("fetcherFingerprints: follows named exports precisely and re-exports, export * and namespaces whole", async () => {
    const app = makeApp()
    try {
        app.write("api.js", `export const api = {}\napi.base = "/v1"\nexport const other = 1\n`)
        app.write("barrel.js", `export { limit } from "./more"\nexport * from "./more"\n`)
        app.write("more.js", `export const limit = 10\nexport const unrelated = "a"\n`)
        app.write("ns.js", `export const flag = true\n`)
        app.write(
            "ReexportPage.js",
            `import { api } from "./api"
import { limit } from "./barrel"
import * as ns from "./ns"
const Page = () => null
Page.clientFetcher = async () => [api.base, limit, ns.flag]
export default Page
`
        )
        const page = path.join(app.dir, "ReexportPage.js")
        const fp = async () =>
            (await fetcherFingerprints(page, fs.readFileSync(page, "utf8"), app.resolve)).fingerprints
                .clientFetcher
        const base = await fp()
        const changes = async (file, from, to) => {
            app.edit(file, from, to)
            const changed = (await fp()) !== base
            app.edit(file, to, from)
            return changed
        }
        assert.equal(
            await changes("api.js", '"/v1"', '"/v2"'),
            true,
            "top-level write to an imported binding"
        )
        assert.equal(await changes("api.js", "other = 1", "other = 2"), false, "unrelated named export")
        assert.equal(await changes("more.js", "limit = 10", "limit = 20"), true, "through a re-export")
        assert.equal(await changes("more.js", '"a"', '"b"'), true, "a re-exporting module is hashed whole")
        assert.equal(await changes("ns.js", "true", "false"), true, "namespace import")
    } finally {
        fs.rmSync(app.dir, { recursive: true, force: true })
    }
})

// Each case: page source with a placeholder, other files, and whether
// swapping the placeholder value changes the clientFetcher fingerprint.
async function changesFingerprint({ pageFile = "Case.js", page, files = {}, edit }) {
    const app = makeApp()
    try {
        for (const [name, text] of Object.entries(files)) app.write(name, text)
        app.write(pageFile, page)
        const file = path.join(app.dir, pageFile)
        const fp = async () =>
            (await fetcherFingerprints(file, fs.readFileSync(file, "utf8"), app.resolve)).fingerprints
                .clientFetcher
        const before = await fp()
        assert.notEqual(before, "none")
        app.edit(...edit)
        const after = await fp()
        // The footer treats "unknown" as changed on every update.
        return after === "unknown" || before !== after
    } finally {
        fs.rmSync(app.dir, { recursive: true, force: true })
    }
}

test("fetcherFingerprints: TypeScript static class fields", async () => {
    const page = `import React from "react"
export default class Page extends React.Component {
    static clientFetcher = () => 1
    render() { return null }
}
`
    assert.equal(
        await changesFingerprint({ pageFile: "Case.tsx", page, edit: ["Case.tsx", "=> 1", "=> 2"] }),
        true
    )
})

test("fetcherFingerprints: namespace imports of a barrel follow its re-exports", async () => {
    const page = `import * as api from "./barrel"
const Page = () => null
Page.clientFetcher = async () => api.value
export default Page
`
    const files = {
        "barrel.js": `export { value } from "./value"\nexport * from "./more"\n`,
        "value.js": `export const value = 1\n`,
        "more.js": `export const more = 1\n`,
    }
    assert.equal(await changesFingerprint({ page, files, edit: ["value.js", "= 1", "= 2"] }), true)
    assert.equal(await changesFingerprint({ page, files, edit: ["more.js", "= 1", "= 2"] }), true)
})

test("fetcherFingerprints: dynamic imports inside the fetcher", async () => {
    const page = `const Page = () => null
Page.clientFetcher = async () => (await import("./lazyHelper")).value
export default Page
`
    const files = { "lazyHelper.js": `export const value = 1\n` }
    assert.equal(await changesFingerprint({ page, files, edit: ["lazyHelper.js", "= 1", "= 2"] }), true)
    const computed = `const Page = () => null
const name = "./lazyHelper"
Page.clientFetcher = async () => (await import(name)).value
export default Page
`
    assert.equal(
        await changesFingerprint({ page: computed, files, edit: ["lazyHelper.js", "= 1", "= 2"] }),
        true
    )
})

test("fetcherFingerprints: a clientFetcher that calls the serverFetcher", async () => {
    const page = `const Page = () => null
Page.clientFetcher = () => Page.serverFetcher()
Page.serverFetcher = async () => ({ v: 1 })
export default Page
`
    assert.equal(await changesFingerprint({ page, edit: ["Case.js", "v: 1", "v: 2"] }), true)
})

test("fetcherFingerprints: only real fetcher definitions count", async () => {
    const app = makeApp()
    const page = path.join(app.dir, "Defs.js")
    const fp = async (source) =>
        (await fetcherFingerprints(page, source, app.resolve)).fingerprints.clientFetcher
    try {
        // A comment naming clientFetcher on a serverFetcher-only page isn't a clientFetcher.
        const serverOnly = `// no clientFetcher on this page\nconst Page = () => null\nPage.serverFetcher = async () => 1\nexport default Page\n`
        assert.equal(await fp(serverOnly), "none")
        // Object.assign isn't followed, so it counts as changed on every edit.
        const assigned = `const Page = () => null\nObject.assign(Page, { clientFetcher: async () => 1 })\nexport default Page\n`
        assert.equal(await fp(assigned), "unknown")
    } finally {
        fs.rmSync(app.dir, { recursive: true, force: true })
    }
})

test("fetcherFingerprints: top-level writes and TypeScript namespaces", async () => {
    const assigned = `let n
n = 1
const Page = () => null
Page.clientFetcher = () => n
export default Page
`
    assert.equal(await changesFingerprint({ page: assigned, edit: ["Case.js", "n = 1", "n = 2"] }), true)
    const namespaced = `namespace Config { export const limit = 1 }
const Page = () => null
;(Page as any).clientFetcher = () => Config.limit
export default Page
`
    assert.equal(
        await changesFingerprint({
            pageFile: "Case.ts",
            page: namespaced,
            edit: ["Case.ts", "limit = 1", "limit = 2"],
        }),
        true
    )
})

test("fetcherFingerprints: writes to globals inside the fetcher don't pull in the component", async () => {
    const page = `import React from "react"
const Page = () => <h1>V1</h1>
Page.clientFetcher = async () => {
    window.calls = (window.calls || 0) + 1
    return { at: Date.now() }
}
export default Page
`
    assert.equal(await changesFingerprint({ page, edit: ["Case.js", "<h1>V1</h1>", "<h1>V2</h1>"] }), false)
})

test("routeFetcherHmrPlugin: an edit to a file a fetcher reaches fully invalidates the page", async () => {
    const app = makeApp()
    const plugin = routeFetcherHmrPlugin()
    const ctx = { resolve: app.resolve, warn: () => {} }
    const pageModule = { id: app.page }
    const invalidated = []
    const server = {
        moduleGraph: {
            getModulesByFile: (file) => (file === app.page ? new Set([pageModule]) : undefined),
            invalidateModule: (mod) => invalidated.push(mod),
        },
    }
    try {
        await plugin.transform.call(ctx, fs.readFileSync(app.page, "utf8"), app.page, {})
        const helperModule = { id: "helper" }
        const update = plugin.handleHotUpdate({
            file: path.join(app.dir, "fetchHelper.js"),
            modules: [helperModule],
            server,
        })
        assert.deepEqual(update, [helperModule, pageModule])
        assert.deepEqual(invalidated, [pageModule])
        // A helper only the component uses is left to Vite's normal propagation.
        assert.equal(
            plugin.handleHotUpdate({ file: path.join(app.dir, "uiHelper.js"), modules: [], server }),
            undefined
        )
        assert.equal(invalidated.length, 1)
    } finally {
        fs.rmSync(app.dir, { recursive: true, force: true })
    }
})

test("fetcherFingerprints: control flow, side-effect imports and data files", async () => {
    const conditional = `let value = 0
if (true) { value = 1 }
for (let i = 0; i < 1; i++) value += 10
const Page = () => null
Page.clientFetcher = () => value
export default Page
`
    assert.equal(
        await changesFingerprint({ page: conditional, edit: ["Case.js", "value = 1", "value = 2"] }),
        true
    )
    assert.equal(await changesFingerprint({ page: conditional, edit: ["Case.js", "+= 10", "+= 20"] }), true)

    const files = {
        "setup.js": `globalThis.apiBase = "/v1"\n`,
        "page.css": `h1 { color: red }\n`,
        "data.json": `{ "limit": 10 }\n`,
    }
    const page = `import "./setup"
import "./page.css"
import data from "./data.json"
const Page = () => null
Page.clientFetcher = () => [globalThis.apiBase, data.limit]
export default Page
`
    assert.equal(
        await changesFingerprint({ page, files, edit: ["setup.js", "/v1", "/v2"] }),
        true,
        "side-effect script"
    )
    assert.equal(
        await changesFingerprint({ page, files, edit: ["data.json", "10", "20"] }),
        true,
        "JSON import"
    )
    assert.equal(
        await changesFingerprint({ page, files, edit: ["page.css", "red", "blue"] }),
        false,
        "stylesheet"
    )
})

test("routeFetcherHmrPlugin: discovers fetchers the same way it fingerprints them", async () => {
    const app = makeApp()
    const plugin = routeFetcherHmrPlugin()
    const sent = []
    plugin.configureServer({ ws: { send: (msg) => sent.push(msg) } })
    const ctx = { resolve: app.resolve, warn: () => {} }
    const file = path.join(app.dir, "Assigned.js")
    const transform = async () => plugin.transform.call(ctx, fs.readFileSync(file, "utf8"), file, {})
    try {
        // A comment naming a fetcher isn't a fetcher.
        app.write(
            "Assigned.js",
            `// clientFetcher comes later\nconst Page = () => null\nexport default Page\n`
        )
        assert.equal(await transform(), null)
        // Object.assign gets the footer, and gaining a first fetcher reloads once.
        app.write(
            "Assigned.js",
            `const Page = () => null\nObject.assign(Page, { clientFetcher: async () => 1 })\nexport default Page\n`
        )
        assert.match((await transform()).code, /"clientFetcher":"unknown"/)
        await new Promise((resolve) => setTimeout(resolve, 10))
        assert.deepEqual(sent, [{ type: "full-reload" }])
    } finally {
        fs.rmSync(app.dir, { recursive: true, force: true })
    }
})

// Runs the footer transform() appends, with import.meta.hot, import(self) and
// window stubbed the way Vite and the browser provide them. Returns the accept
// callback the footer registers.
async function runFooter(output, source, { data, window, self }) {
    let accept
    let invalidated = false
    const footer = output
        .slice(source.length)
        .replace("import(/* @vite-ignore */ import.meta.url)", "loadSelf()")
        .replaceAll("import.meta", "meta")
    const meta = {
        url: "page.js",
        hot: { data, accept: (cb) => (accept = cb), invalidate: () => (invalidated = true) },
    }
    new Function("meta", "loadSelf", "window", footer)(meta, async () => self, window)
    await new Promise((resolve) => setTimeout(resolve, 0))
    return { accept: (next) => accept(next), invalidated: () => invalidated }
}

test("routeFetcherHmrPlugin: the footer reports what changed and updates splits before announcing", async () => {
    const app = makeApp()
    const plugin = routeFetcherHmrPlugin()
    const ctx = { resolve: app.resolve, warn: () => {} }
    const transform = async (file) => {
        const source = fs.readFileSync(file, "utf8")
        return { source, output: (await plugin.transform.call(ctx, source, file, {})).code }
    }
    const events = []
    let reloads = 0
    const window = {
        dispatchEvent: (event) => events.push(event.detail),
        location: { reload: () => reloads++ },
    }
    const component = () => null
    // One update of `file`: run the old footer, then the new one (which Vite
    // evaluates first), then hand the new module to the old accept callback.
    const update = async (before, after, nextDefault = component) => {
        const data = {}
        const prev = { default: component }
        const next = { default: nextDefault }
        const old = await runFooter(before.output, before.source, { data, window, self: prev })
        await runFooter(after.output, after.source, { data, window, self: next })
        old.accept(next)
        return { detail: events.at(-1), invalidated: old.invalidated() }
    }
    try {
        const v1 = await transform(app.page)
        app.edit("Page.js", "PAGE_V1", "PAGE_V2")
        const jsx = await transform(app.page)
        app.edit("Page.js", "stamp: prefix", "stamp: 'x' + prefix")
        const fetcher = await transform(app.page)
        assert.equal((await update(v1, jsx)).detail.fetcherChanged, false)
        assert.equal((await update(jsx, fetcher)).detail.fetcherChanged, true)
        // Vite reuses a page's transform when only a dependency changed: same fingerprints.
        assert.equal((await update(fetcher, fetcher)).detail.fetcherChanged, false)

        const assignedFile = path.join(app.dir, "Assigned.js")
        app.write(
            "Assigned.js",
            `const Page = () => null\nObject.assign(Page, { clientFetcher: async () => 1 })\nexport default Page\n`
        )
        const assigned = await transform(assignedFile)
        assert.equal((await update(assigned, assigned)).detail.fetcherChanged, true, "unknown always changes")

        const count = events.length
        assert.equal((await update(v1, jsx, "not a component")).invalidated, true)
        assert.equal(events.length, count, "no event for a non-component module")

        // split()'s registered handlers run before the event; a listener can ask for a reload.
        const order = []
        window.__CATALYST_HMR__.splits.add((detail) => order.push("split") && detail.splits.push("page"))
        window.dispatchEvent = (event) => {
            order.push(`event:${event.detail.splits.length}`)
            event.detail.reload = true
        }
        await update(v1, jsx)
        assert.deepEqual(order, ["split", "event:1"])
        assert.equal(reloads, 1)
    } finally {
        fs.rmSync(app.dir, { recursive: true, force: true })
    }
})

// Fingerprints a page before and after an edit; returns whether the clientFetcher
// counts as changed and which files the walk recorded as dependencies.
async function probe({ pageFile = "Case.js", page, files = {}, edit }) {
    const app = makeApp()
    try {
        for (const [name, text] of Object.entries(files)) app.write(name, text)
        app.write(pageFile, page)
        const file = path.join(app.dir, pageFile)
        const run = async () => fetcherFingerprints(file, fs.readFileSync(file, "utf8"), app.resolve)
        const before = await run()
        app.edit(...edit)
        const after = (await run()).fingerprints.clientFetcher
        return {
            changed: after === "unknown" || after !== before.fingerprints.clientFetcher,
            dependencies: [...before.dependencies].map((dep) => path.basename(dep)).sort(),
        }
    } finally {
        fs.rmSync(app.dir, { recursive: true, force: true })
    }
}

test("fetcherFingerprints: an imported binding that is also changed on the page is still followed", async () => {
    const result = await probe({
        page: `import { api } from "./api"
api.flag = true
const Page = () => null
Page.clientFetcher = () => api.base
export default Page
`,
        files: { "api.js": `export const api = { base: "/v1" }\n` },
        edit: ["api.js", "/v1", "/v2"],
    })
    assert.deepEqual(result, { changed: true, dependencies: ["api.js"] })
})

test("fetcherFingerprints: whole modules follow their dynamic imports", async () => {
    const files = {
        "api.js": `export const load = async () => (await import("./data")).value\n`,
        "data.js": `export const value = 1\n`,
    }
    const page = `import * as api from "./api"
const Page = () => null
Page.clientFetcher = () => api.load()
export default Page
`
    assert.deepEqual(await probe({ page, files, edit: ["data.js", "= 1", "= 2"] }), {
        changed: true,
        dependencies: ["api.js", "data.js"],
    })
})

test("fetcherFingerprints: declaration initialisers that change a binding the fetcher reads", async () => {
    const page = `import React, { memo } from "react"
const LIMIT = 10
const config = {}
const setup = Object.assign(config, { base: "/v1" })
const Page = memo(() => <h1>V1 {String(LIMIT)}</h1>)
Page.clientFetcher = () => [config.base, LIMIT]
export default Page
`
    assert.equal((await probe({ page, edit: ["Case.js", "/v1", "/v2"] })).changed, true)
    // The component also uses LIMIT, but its JSX still isn't part of the fetcher.
    assert.equal((await probe({ page, edit: ["Case.js", "<h1>V1", "<h1>V2"] })).changed, false)
})

test("routeFetcherHmrPlugin: fetchers set in ways the walk can't follow are instrumented as unknown", async () => {
    const app = makeApp()
    const plugin = routeFetcherHmrPlugin()
    const ctx = { resolve: app.resolve, warn: () => {} }
    const file = path.join(app.dir, "Odd.js")
    const forms = {
        "inside an if": `if (true) { Page.clientFetcher = () => 1 }`,
        "computed key": `Page["clientFetcher"] = () => 1`,
        "quoted Object.assign key": `Object.assign(Page, { "clientFetcher": () => 1 })`,
        "serverFetcher computed key": `Page["serverFetcher"] = async () => 1`,
    }
    try {
        for (const [form, line] of Object.entries(forms)) {
            app.write("Odd.js", `const Page = () => null\n${line}\nexport default Page\n`)
            const out = await plugin.transform.call(ctx, fs.readFileSync(file, "utf8"), file, {})
            const name = form.startsWith("serverFetcher") ? "serverFetcher" : "clientFetcher"
            assert.ok(out, `${form}: instrumented`)
            assert.match(out.code, new RegExp(`"${name}":"unknown"`), form)
        }
    } finally {
        fs.rmSync(app.dir, { recursive: true, force: true })
    }
})

test("fetcherFingerprints: a clientFetcher that shares or calls the serverFetcher ignores JSX edits", async () => {
    for (const definition of [
        "Page.clientFetcher = Page.serverFetcher",
        "Page.clientFetcher = () => Page.serverFetcher()",
    ]) {
        const page = `import React from "react"
const Page = () => <h1>ONE</h1>
Page.serverFetcher = async () => ({ v: 1 })
${definition}
export default Page
`
        assert.equal(
            (await probe({ page, edit: ["Case.js", "<h1>ONE", "<h1>TWO"] })).changed,
            false,
            definition
        )
        assert.equal((await probe({ page, edit: ["Case.js", "v: 1", "v: 2"] })).changed, true, definition)
    }
})

test("fetcherFingerprints: writes through an alias and inside an immediately invoked function", async () => {
    const aliased = `const config = {}
const alias = config
alias.base = "/v1"
const Page = () => null
Page.clientFetcher = () => config.base
export default Page
`
    assert.equal((await probe({ page: aliased, edit: ["Case.js", "/v1", "/v2"] })).changed, true, "alias")
    const invoked = `const config = {}
const setup = (() => {
    config.base = "/v1"
})()
const Page = () => null
Page.clientFetcher = () => config.base
export default Page
`
    assert.equal((await probe({ page: invoked, edit: ["Case.js", "/v1", "/v2"] })).changed, true, "IIFE")
})

test("fetcherFingerprints: a fetcher of an imported component is followed into its file", async () => {
    const result = await probe({
        page: `import Other from "./Other"
const Page = () => null
Page.clientFetcher = () => Other.clientFetcher()
export default Page
`,
        files: {
            "Other.js": `const Other = () => null\nOther.clientFetcher = () => 1\nexport default Other\n`,
        },
        edit: ["Other.js", "=> 1", "=> 2"],
    })
    assert.deepEqual(result, { changed: true, dependencies: ["Other.js"] })
})

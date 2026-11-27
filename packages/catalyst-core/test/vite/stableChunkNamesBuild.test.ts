/**
 * End-to-end checks of the stable-chunk-names plugin on real Vite builds (the unit tests in
 * stableChunkNamesPlugin.test.ts use hand-written chunk graphs).
 *
 * The fixture app is shaped like a Catalyst app: an `app` chunk (the hub) that 23 chunks import statically and
 * that lazily imports 22 pages, pages with and without CSS, a widget with CSS shared by half the pages, and a
 * shared chunk reached through one of its exports. Output naming matches vite.config.client.js.
 *
 * Built code runs in a child Node process with a minimal `document`, so Vite's own preload helper runs and
 * every stylesheet it adds is recorded.
 */
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { build } from "vite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { stableChunkNamesPlugin } from "../../src/vite/stable-chunk-names-plugin.js"
import { scriptIntegrityPlugin } from "../../src/vite/script-integrity-plugin.js"

const PAGES = 22
const ASSETS = "client/assets"

type Edits = {
    page?: Record<number, string>
    pageCss?: Record<number, string>
    widget?: string
    app?: string
}

const write = (dir: string, file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), content)
}

const hasCss = (i: number) => i % 3 !== 2
const usesWidget = (i: number) => i % 2 === 1

function writeApp(dir: string, edits: Edits = {}) {
    write(dir, "client/index.js", `import { load } from "../src/app.js"\nglobalThis.__load = load\n`)
    const pages = Array.from({ length: PAGES }, (_, i) => `    p${i}: () => import("./pages/p${i}.js"),`)
    write(
        dir,
        "src/app.js",
        [
            `const pages = {\n${pages.join("\n")}\n}`,
            `export const util = (x) => "${edits.app || "u"}:" + x`,
            // imported both statically and lazily: Rollup inlines the lazy import inside Vite's preload call
            `import { inl } from "./lib/inline.js"`,
            `export const load = (n) =>`,
            `    n === "shared"`,
            `        ? import("./lib/shared.js").then((m) => m.s)`,
            `        : n === "inline"`,
            `          ? import("./lib/inline.js").then((m) => m.inl + inl)`,
            `          : pages[n]().then((m) => m.default())`,
        ].join("\n")
    )
    write(
        dir,
        "src/lib/shared.js",
        `import { util } from "../app.js"\nexport const s = util("shared")\nexport const t = 2\n`
    )
    write(dir, "src/lib/inline.js", `export const inl = "i"\n`)
    write(dir, "src/widgets/w.js", `import "./w.css"\nexport const w = "+w${edits.widget || ""}"\n`)
    write(dir, "src/widgets/w.css", `.w{color:red}\n`)
    for (let i = 0; i < PAGES; i++) {
        const lines = [`import { util } from "../app.js"`]
        if (hasCss(i)) lines.push(`import "./p${i}.css"`)
        lines.push(usesWidget(i) ? `import { w } from "../widgets/w.js"` : `const w = ""`)
        lines.push(`export default () => util("p${i}${edits.page?.[i] || ""}") + w`)
        write(dir, `src/pages/p${i}.js`, lines.join("\n") + "\n")
        if (hasCss(i)) write(dir, `src/pages/p${i}.css`, `.p${i}{margin:${i}px${edits.pageCss?.[i] || ""}}\n`)
    }
}

async function buildApp(
    dir: string,
    { on, extraPlugins = [] as any[] }: { on: boolean; extraPlugins?: any[] }
) {
    const warnings: string[] = []
    await build({
        root: dir,
        configFile: false,
        logLevel: "silent",
        mode: "production",
        base: "/static/",
        customLogger: {
            info: () => {},
            warn: (m: string) => warnings.push(m),
            warnOnce: (m: string) => warnings.push(m),
            error: (m: string) => warnings.push(m),
            clearScreen: () => {},
            hasErrorLogged: () => false,
            hasWarned: false,
        },
        plugins: [...(on ? [stableChunkNamesPlugin({ root: dir })] : []), ...extraPlugins],
        build: {
            outDir: path.join(dir, "build"),
            emptyOutDir: true,
            target: "esnext",
            minify: "esbuild",
            modulePreload: false,
            manifest: true,
            rollupOptions: {
                input: { main: path.join(dir, "client/index.js") },
                output: {
                    format: "es",
                    entryFileNames: `${ASSETS}/[name]-[hash].js`,
                    chunkFileNames: `${ASSETS}/[name]-[hash].js`,
                    assetFileNames: (a: { name?: string }) =>
                        a.name?.endsWith(".css")
                            ? `${ASSETS}/css/[name]-[hash][extname]`
                            : `${ASSETS}/[name]-[hash][extname]`,
                    // Catalyst puts catalyst-core into an `app` manual chunk; here the app's own hub module.
                    manualChunks: (id: string) => (id.endsWith("/src/app.js") ? "app" : undefined),
                },
            },
        },
    })
    return { files: listFiles(path.join(dir, "build")), warnings }
}

// file name -> sha256 of its bytes, for every JS and CSS file in the build
function listFiles(buildDir: string) {
    const out: Record<string, string> = {}
    const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name)
            if (e.isDirectory()) walk(p)
            else if (/\.(js|css)$/.test(e.name))
                out[path.relative(buildDir, p)] = crypto
                    .createHash("sha256")
                    .update(fs.readFileSync(p))
                    .digest("hex")
        }
    }
    walk(buildDir)
    return out
}

const RUNNER = `
const links = []
const el = () => {
    const l = { listeners: {}, relList: { supports: () => false }, setAttribute() {},
        addEventListener(t, f) { (l.listeners[t] ||= []).push(f) } }
    return l
}
globalThis.document = {
    createElement: el,
    getElementsByTagName: () => [],
    querySelector: () => null,
    head: { appendChild(l) { links.push(l.href); setTimeout(() => (l.listeners.load || []).forEach((f) => f())) } },
}
globalThis.window = globalThis
globalThis.dispatchEvent = () => true
const [buildDir, ...names] = process.argv.slice(2)
const fs = await import("node:fs")
const assets = buildDir + "/client/assets/"
const main = fs.readdirSync(assets).find((f) => /^main-.*\\.js$/.test(f))
await import("file://" + assets + main)
const results = {}
for (const n of names) {
    const before = links.length
    results[n] = { value: await globalThis.__load(n), css: links.slice(before).sort() }
}
console.log(JSON.stringify(results))
`

let tmp: string
let runner: string
const pageNames = [...Array.from({ length: PAGES }, (_, i) => `p${i}`), "shared", "inline"]

// Loads every page from a build (one fresh Node process per build) and returns what each page rendered and the
// stylesheets Vite's preload helper added for it.
function run(dir: string) {
    const r = spawnSync(process.execPath, [runner, path.join(dir, "build"), ...pageNames], {
        encoding: "utf8",
    })
    if (r.status !== 0) throw new Error(`built app failed to run: ${r.stderr}`)
    return JSON.parse(r.stdout)
}

const appDir = (name: string, edits: Edits = {}) => {
    const dir = path.join(tmp, name)
    writeApp(dir, edits)
    return dir
}

const baseNames = (files: Record<string, string>) => Object.keys(files).map((f) => path.basename(f))
const stem = (f: string) => path.basename(f).replace(/-[\w-]{8}\.(js|css)$/, "")
// Files of `b` whose name is not in `a`, as stems ("main", "p4", ...); CSS stems get a ".css" suffix.
const renamed = (a: Record<string, string>, b: Record<string, string>) =>
    Object.keys(b)
        .filter((f) => !(f in a))
        .map((f) => stem(f) + (f.endsWith(".css") ? ".css" : ""))
        .sort()

// A returning visitor keeps every file whose name did not change, so a file name must always mean the same bytes.
const expectSameNameSameBytes = (a: Record<string, string>, b: Record<string, string>) => {
    for (const f of Object.keys(b)) if (f in a) expect({ f, hash: b[f] }).toEqual({ f, hash: a[f] })
}

beforeAll(() => {
    // On macOS os.tmpdir() is behind a symlink, so every build here also covers a symlinked root.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stable-chunk-names-"))
    runner = path.join(tmp, "run.mjs")
    fs.writeFileSync(runner, RUNNER)
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe("stable-chunk-names plugin on a real Vite build", () => {
    let off: Record<string, string>
    let on: Record<string, string>
    let onDir: string

    beforeAll(async () => {
        const offDir = appDir("off")
        onDir = appDir("on")
        off = (await buildApp(offDir, { on: false })).files
        const onBuild = await buildApp(onDir, { on: true })
        on = onBuild.files
        expect(onBuild.warnings.filter((w) => w.includes("[stable-chunk-names]"))).toEqual([])
    }, 60_000)

    it("emits the same chunks and CSS files as a build without it", () => {
        expect(Object.keys(on).map(stem).sort()).toEqual(Object.keys(off).map(stem).sort())
        // CSS is untouched
        const css = (files: Record<string, string>) =>
            Object.entries(files).filter(([f]) => f.endsWith(".css"))
        expect(css(on)).toEqual(css(off))
    })

    it("removes every hashed file name from the hub", () => {
        const app = Object.keys(on).find((f) => stem(f) === "app")!
        const code = fs.readFileSync(path.join(onDir, "build", app), "utf8")
        const otherFiles = baseNames(on).filter((f) => !f.startsWith("app-"))
        for (const f of otherFiles) expect(code).not.toContain(f.replace(/\.(js|css)$/, ""))
        expect(code).not.toContain("__vite__mapDeps")
        expect(code).toContain(`__ccQ("src/pages/p0"`)
        // The inlined lazy import is left to Vite, which gives its marker no deps: `void 0`, or `[]` when it pairs
        // the marker with an import() that names no chunk (every import() left in the hub names none).
        expect(code).toMatch(/Promise\.resolve\(\)\.then\(\(\)=>\w+\),(void 0|\[\])\)/)
    })

    it("loads the same modules and the same CSS for every page", () => {
        const a = run(path.join(tmp, "off"))
        const b = run(onDir)
        expect(b).toEqual(a)
        // sanity: the fixture exercises CSS from the page, from a shared widget, and pages with no CSS
        expect(a.p1.css).toEqual(
            expect.arrayContaining([expect.stringMatching(/\/p1-/), expect.stringMatching(/\/w-/)])
        )
        expect(a.p2.css).toEqual([])
        expect(a.p1.value).toBe("u:p1+w")
        expect(a.shared.value).toBe("u:shared")
        expect(a.inline.value).toBe("ii")
    })
})

describe("stable-chunk-names plugin across releases", () => {
    // Each case builds release A (the base app) and release B (A plus one change), with the plugin off and on.
    // `expectedOn` is the set of renamed files with the plugin on.
    const cases: { name: string; edits: Edits; expectedOn: string[] | ((r: string[]) => void) }[] = [
        { name: "no change", edits: {}, expectedOn: [] },
        { name: "one page's code", edits: { page: { 4: "-b" } }, expectedOn: ["main", "p4"] },
        {
            name: "one page's CSS",
            edits: { pageCss: { 1: ";padding:1px" } },
            // the page chunk is renamed too, because Vite puts its CSS file names into the chunk's hash
            expectedOn: ["main", "p1", "p1.css"],
        },
        {
            name: "a widget that half the pages import",
            edits: { widget: "-b" },
            expectedOn: [
                "main",
                ...Array.from({ length: PAGES }, (_, i) => i)
                    .filter(usesWidget)
                    .map((i) => `p${i}`),
                "w",
            ].sort(),
        },
        {
            name: "the hub's own code (known limit: everything that imports it is renamed)",
            edits: { app: "v" },
            expectedOn: (r) => {
                expect(r).toContain("app")
                expect(r.length).toBeGreaterThan(PAGES)
            },
        },
    ]

    for (const { name, edits, expectedOn } of cases) {
        it(`${name}`, async () => {
            const slug = name.replace(/\W+/g, "-")
            const result: Record<
                string,
                { a: Record<string, string>; b: Record<string, string>; bDir: string }
            > = {}
            for (const arm of ["off", "on"]) {
                const aDir = appDir(`${slug}-${arm}-a`)
                const bDir = appDir(`${slug}-${arm}-b`, edits)
                const a = (await buildApp(aDir, { on: arm === "on" })).files
                const b = (await buildApp(bDir, { on: arm === "on" })).files
                expectSameNameSameBytes(a, b)
                result[arm] = { a, b, bDir }
            }
            const r = renamed(result.on.a, result.on.b)
            if (typeof expectedOn === "function") expectedOn(r)
            else expect(r).toEqual(expectedOn)
            // never more renames than without the plugin
            expect(r.length).toBeLessThanOrEqual(renamed(result.off.a, result.off.b).length)
            // release B still runs, and the same as without the plugin
            expect(run(result.on.bDir)).toEqual(run(result.off.bDir))
        }, 60_000)
    }

    it("renames every chunk that imports the hub when a page changes, without the plugin (the problem)", async () => {
        const a = (await buildApp(appDir("problem-a"), { on: false })).files
        const b = (await buildApp(appDir("problem-b", { page: { 4: "-b" } }), { on: false })).files
        // the 22 pages, the hub, the entry and the shared chunk
        expect(renamed(a, b).length).toBeGreaterThanOrEqual(PAGES + 2)
    }, 60_000)
})

describe("stable-chunk-names plugin build environment", () => {
    it("gives the same file names when the same source is built in another directory, or through a symlink", async () => {
        const a = (await buildApp(appDir("dir-a"), { on: true })).files
        const b = (await buildApp(appDir("dir-b"), { on: true })).files
        fs.symlinkSync(path.join(tmp, "dir-a"), path.join(tmp, "dir-link"))
        const c = (await buildApp(path.join(tmp, "dir-link"), { on: true })).files
        expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort())
        expect(Object.keys(c).sort()).toEqual(Object.keys(a).sort())
    }, 60_000)

    it("works with script integrity: the hashes match the files written to disk", async () => {
        const dir = appDir("sri")
        const saved = process.env
        process.env = { ...saved, src_path: dir, BUILD_OUTPUT_PATH: "build", SCRIPT_INTEGRITY_ENABLE: "true" }
        try {
            await buildApp(dir, { on: true, extraPlugins: [scriptIntegrityPlugin()] })
        } finally {
            process.env = saved
        }
        const integrity = JSON.parse(fs.readFileSync(path.join(dir, "build/.vite/integrity.json"), "utf8"))
        const main = Object.keys(integrity).find((f) => stem(f) === "main")!
        expect(main).toBeTruthy()
        for (const [file, hash] of Object.entries(integrity)) {
            const bytes = fs.readFileSync(path.join(dir, "build", file))
            expect(hash).toBe(`sha384-${crypto.createHash("sha384").update(bytes).digest("base64")}`)
        }
        // the table is in the hashed main
        expect(fs.readFileSync(path.join(dir, "build", main), "utf8")).toContain("__ccCM")
    }, 60_000)

    it("leaves an app with no hub (fewer than 20 importers) byte-identical", async () => {
        const dir = appDir("small")
        // only 2 pages import the hub
        for (let i = 2; i < PAGES; i++) write(dir, `src/pages/p${i}.js`, `export default () => "p${i}"\n`)
        write(dir, "src/lib/shared.js", `export const s = "u:shared"\n`)
        const offBuild = await buildApp(dir, { on: false })
        const onBuild = await buildApp(dir, { on: true })
        expect(onBuild.files).toEqual(offBuild.files)
    }, 60_000)
})

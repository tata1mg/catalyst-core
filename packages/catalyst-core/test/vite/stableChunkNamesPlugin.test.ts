import { parseAst } from "rollup/parseAst"
import type { Rollup } from "vite"
import { describe, expect, it, vi } from "vitest"
import {
    isStableChunkNamesEnabled,
    stableChunkNamesPlugin,
} from "../../src/vite/stable-chunk-names-plugin.js"

const ROOT = "/app"
const A = "client/assets"

// The parts of the bundler's chunk objects the plugin reads, so the fixtures are checked against the real types.
type ChunkFixture = Pick<
    Rollup.RenderedChunk,
    "name" | "isEntry" | "imports" | "dynamicImports" | "facadeModuleId" | "moduleIds"
> &
    Partial<Pick<Rollup.RenderedChunk, "fileName">> & { viteMetadata: { importedCss: Set<string> } }
type ChunkGraph = Record<string, ChunkFixture>
type BundleChunkFixture = Pick<
    Rollup.OutputChunk,
    "type" | "fileName" | "preliminaryFileName" | "isEntry" | "name" | "code" | "map"
>
type Plugin = ReturnType<typeof stableChunkNamesPlugin>

// A minimal Rollup "meta.chunks" graph: `app` is a hub (imported by 2 chunks with minImporters: 2),
// `pageA` is a leaf that imports `app`, and `main` is the entry.
const makeChunks = (): ChunkGraph => ({
    [`${A}/main-!~{001}~.js`]: chunk("main", { isEntry: true, imports: [`${A}/app-!~{002}~.js`] }),
    [`${A}/app-!~{002}~.js`]: chunk("app", {
        moduleIds: [`${ROOT}/node_modules/catalyst-core/dist/index.js`],
        dynamicImports: [
            `${A}/Home-!~{003}~.js`,
            `${A}/index-!~{004}~.js`,
            `${A}/Paytm-!~{005}~.js`,
            `${A}/pure-!~{006}~.js`,
        ],
        importedCss: [`${A}/css/app-1111.css`],
    }),
    [`${A}/Home-!~{003}~.js`]: chunk("Home", {
        facadeModuleId: `${ROOT}/src/js/pages/Home/index.js`,
        imports: [`${A}/app-!~{002}~.js`, `${A}/shared-!~{007}~.js`],
        importedCss: [`${A}/css/Home-2222.css`],
    }),
    // a shared chunk reached through one of its exports: no facade module
    [`${A}/index-!~{004}~.js`]: chunk("index", {
        moduleIds: [`${ROOT}/src/js/lib/z.js`, `${ROOT}/src/js/lib/a.js`],
        imports: [`${A}/app-!~{002}~.js`],
    }),
    [`${A}/Paytm-!~{005}~.js`]: chunk("Paytm", { facadeModuleId: `${ROOT}/src/js/lib/Paytm.js` }),
    [`${A}/pure-!~{006}~.js`]: chunk("pure", {
        facadeModuleId: `${ROOT}/src/js/widgets/Pure.js`,
        importedCss: [`${A}/css/Pure-3333.css`],
    }),
    [`${A}/shared-!~{007}~.js`]: chunk("shared", { importedCss: [`${A}/css/shared-4444.css`] }),
})

function chunk(
    name: string,
    {
        isEntry = false,
        imports = [] as string[],
        dynamicImports = [] as string[],
        facadeModuleId = null as string | null,
        moduleIds = undefined as string[] | undefined,
        importedCss = [] as string[],
    } = {}
): ChunkFixture {
    return {
        name,
        isEntry,
        imports,
        dynamicImports,
        facadeModuleId,
        moduleIds: moduleIds || (facadeModuleId ? [facadeModuleId] : [`${ROOT}/src/js/${name}.js`]),
        viteMetadata: { importedCss: new Set(importedCss) },
    }
}

const VITE_LINE = `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["x.css"])))=>i.map(i=>d[i]);\n`
const MAIN_MAP = { mappings: ";;AAAA" } as Rollup.SourceMap

// The three call shapes found in the real \`app\` chunk at renderChunk time (every import() there is wrapped in
// Vite's preload helper), plus the import.meta.url form Vite uses with a relative base.
const HUB_CODE = [
    `import{C}from"./vendor.js";`,
    `const a=R(()=>C(()=>import("./Home-!~{003}~.js"),__VITE_PRELOAD__),{},"../../src/js/pages/Home/index.js");`,
    `const b=R(()=>C(()=>import("./index-!~{004}~.js").then(e=>e.j),__VITE_PRELOAD__),{});`,
    `function p(){return C(async()=>{const{paytmLogin:P}=await import("./Paytm-!~{005}~.js");return{paytmLogin:P}},__VITE_PRELOAD__)}`,
    `const c=()=>C(()=>import("./pure-!~{006}~.js"),__VITE_PRELOAD__,import.meta.url);`,
    `export{a,b,p,c};`,
].join("\n")

const setup = ({ extraTargets = {} as ChunkGraph, sourcemap = false } = {}) => {
    const plugin: Plugin = stableChunkNamesPlugin({ minImporters: 2, root: ROOT })
    const warnings: string[] = []
    const ctx = {
        parse: (code: string) => parseAst(code),
        warn: (m: string) => warnings.push(m),
        error: (m: string) => {
            throw new Error(m)
        },
        info: vi.fn(),
    }
    const chunks = makeChunks()
    for (const [fileName, info] of Object.entries(extraTargets)) {
        chunks[fileName] = info
        chunks[`${A}/app-!~{002}~.js`].dynamicImports.push(fileName)
    }
    // `app` must have >= 2 static importers to be a hub
    chunks[`${A}/pageA-!~{008}~.js`] = chunk("pageA", { imports: [`${A}/app-!~{002}~.js`] })
    // Rollup's RenderedChunk carries its own (placeholder) file name
    for (const [fileName, info] of Object.entries(chunks)) info.fileName = fileName
    plugin.renderStart.call(ctx)
    const render = (fileName: string, code: string) =>
        plugin.renderChunk.handler.call(
            ctx,
            code,
            { ...chunks[fileName], fileName },
            { format: "es", sourcemap },
            { chunks }
        )
    return { plugin, ctx, chunks, render, warnings }
}

describe("stable-chunk-names plugin", () => {
    it("removes every hashed dynamic-import file name from a hub", () => {
        const { render } = setup()
        const out = render(`${A}/app-!~{002}~.js`, HUB_CODE).code
        expect(out).not.toMatch(/!~\{00[3-6]\}~/)
        expect(out).not.toContain("__VITE_PRELOAD__")
        expect(out).toContain(`__ccQ("src/js/pages/Home/index",C,0)`)
        // shared chunk without a facade: id from its first module in sorted order
        expect(out).toContain(`__ccI("src/js/lib/a").then(e=>e.j)`)
        expect(out).toContain(`await __ccI("src/js/lib/Paytm")`)
        expect(out).toContain(`const c=()=>__ccQ("src/js/widgets/Pure",C,1)`)
        expect(out).toContain("function __ccT(")
        // the helper is appended after the last call site, so Vite never pairs its import() with a marker
        expect(out.lastIndexOf('__ccP("')).toBeLessThan(out.indexOf("function __ccT("))
    })

    it("writes the table into main with placeholders, so main's hash covers every target", () => {
        const { render } = setup()
        render(`${A}/app-!~{002}~.js`, HUB_CODE)
        const out = render(`${A}/main-!~{001}~.js`, `import"./app-!~{002}~.js";`).code
        expect(out).toContain(
            `"src/js/pages/Home/index":["Home-!~{003}~","@@catalyst-css:src/js/pages/Home/index"]`
        )
        expect(out).toContain(`"src/js/widgets/Pure":["pure-!~{006}~","@@catalyst-css:src/js/widgets/Pure"]`)
    })

    it("fills CSS deps like Vite does (target + static imports, not the calling hub) and marks pure-CSS targets", () => {
        const { plugin, ctx, chunks, render } = setup()
        for (const fileName of Object.keys(chunks)) {
            if (fileName.includes("main-")) continue
            render(fileName, fileName.includes("app-") ? HUB_CODE : "export default 1")
        }
        const mainCode = render(`${A}/main-!~{001}~.js`, `import"./app-!~{002}~.js";`).code
        const final = (f: string) => f.replace(/!~\{0*(\w+)\}~/, "h$1")
        const bundle: Record<string, BundleChunkFixture> = {}
        for (const fileName of Object.keys(chunks)) {
            if (fileName.includes("pure-")) continue // Vite removed this pure-CSS chunk
            bundle[final(fileName)] = {
                type: "chunk",
                fileName: final(fileName),
                preliminaryFileName: fileName,
                isEntry: chunks[fileName].isEntry,
                name: chunks[fileName].name,
                code: fileName.includes("main-") ? VITE_LINE + mainCode : "",
                map: fileName.includes("main-") ? MAIN_MAP : null,
            } satisfies BundleChunkFixture
        }
        plugin.generateBundle.handler.call(ctx, { format: "es" }, bundle)
        const mainChunk = Object.values(bundle).find((c) => c.isEntry)!
        const main = mainChunk.code
        // Only the table line (which has no source mappings) changes, so main's sourcemap stays valid.
        const before = (VITE_LINE + mainCode).split("\n")
        const after = main.split("\n")
        expect(after).toHaveLength(before.length)
        expect(after.filter((l: string, i: number) => l !== before[i])).toHaveLength(1)
        expect(after[0]).toBe(VITE_LINE.trimEnd())
        expect(mainChunk.map).toBe(MAIN_MAP)
        // the build log names the emitted files, not Rollup's placeholders
        expect(ctx.info).toHaveBeenCalledWith(expect.stringContaining("hubs rewritten: app-h2.js;"))
        const table = new Function("g", `${after[1].replace("globalThis", "g")};return g.__ccCM`)({})
        return table.then((t: any) => {
            // app is the primary hub, so its CSS indexes live in the file table entries
            const css = (sid: string) =>
                (Array.isArray(t.j[sid]) ? t.j[sid].slice(1) : []).map((k: number) => t.p + t.s[k] + t.x)
            expect(css("src/js/pages/Home/index")).toEqual([
                `${A}/css/Home-2222.css`,
                `${A}/css/shared-4444.css`,
            ])
            expect(css("src/js/pages/Home/index")).not.toContain(`${A}/css/app-1111.css`)
            expect(css("src/js/widgets/Pure")).toEqual([`${A}/css/Pure-3333.css`])
            expect(t.e).toEqual({ "src/js/widgets/Pure": 1 })
            expect(t.j["src/js/lib/Paytm"]).toBe("Paytm-!~{005}~") // no CSS: a plain file name (Rollup fills the placeholder)
            expect(main).not.toContain("@@catalyst-css:")
        })
    })

    it("builds source maps only when the build asks for them", () => {
        for (const sourcemap of [false, true]) {
            const { render } = setup({ sourcemap })
            const hub = render(`${A}/app-!~{002}~.js`, HUB_CODE)
            const main = render(`${A}/main-!~{001}~.js`, `import"./app-!~{002}~.js";`)
            for (const out of [hub, main]) {
                if (sourcemap) expect(out.map.mappings).toBeTruthy()
                else expect(out).not.toHaveProperty("map")
            }
        }
    })

    it("rewrites nested preload calls, each with its own import", () => {
        const { render } = setup()
        const nested = `export const n=C(()=>import("./Home-!~{003}~.js").then(()=>C(()=>import("./Paytm-!~{005}~.js"),__VITE_PRELOAD__)),__VITE_PRELOAD__);`
        const out = render(`${A}/app-!~{002}~.js`, nested).code
        expect(out).toContain(
            `__ccP("src/js/pages/Home/index",C,()=>__ccI("src/js/pages/Home/index").then(()=>__ccQ("src/js/lib/Paytm",C,0)),0)`
        )
    })

    it("keeps preload calls around an inlined import (no import(), names no chunk) and rewrites the rest", () => {
        const { render, warnings } = setup()
        // what Rollup emits when the target module is in the hub itself (also imported statically)
        const inlined = [
            `const i=k(()=>C(()=>Promise.resolve().then(()=>g),__VITE_PRELOAD__),{},"../../src/js/x.js");`,
            `const j=()=>C(()=>Promise.resolve().then(()=>h),true?__VITE_PRELOAD__:void 0);`,
        ].join("\n")
        const out = render(`${A}/app-!~{002}~.js`, `${HUB_CODE}\n${inlined}`).code
        expect(out).toContain(inlined)
        expect(out).toContain(`__ccQ("src/js/pages/Home/index",C,0)`)
        expect(warnings).toEqual([])
    })

    it("leaves imports that name no chunk (computed, URL) as they are and rewrites the rest", () => {
        const { render, warnings } = setup()
        // e.g. react-router's own `import(route.module)` in vendor-router; Vite doesn't wrap these either
        const extra = `async function m(e){return import(e.module)}const u=()=>import("https://x.test/y.js");`
        const out = render(`${A}/app-!~{002}~.js`, `${HUB_CODE}\n${extra}`).code
        expect(out).toContain(`__ccQ("src/js/pages/Home/index",C,0)`)
        expect(out).toContain(extra)
        expect(warnings).toEqual([])
    })

    it("does nothing, quietly, to a hub whose only imports name no chunk", () => {
        const { render, warnings } = setup()
        expect(
            render(`${A}/app-!~{002}~.js`, `export async function m(e){return import(e.module)}`)
        ).toBeNull()
        expect(warnings).toEqual([])
    })

    // Every import() that names another chunk must be the single import inside a Vite preload call, so each
    // rewritten import still loads its CSS through Vite's helper. Otherwise the whole hub stays as Vite emitted it.
    it.each([
        [
            "a preload call around a computed specifier",
            `const d=C(()=>import(someVar),__VITE_PRELOAD__);`,
            /preload call around an import that names no chunk/,
        ],
        [
            "a parent-directory specifier",
            `const d=C(()=>import("../x.js"),__VITE_PRELOAD__);`,
            /not a plain "\.\/" path/,
        ],
        [
            "an import outside a preload call",
            `const d=()=>import("./pure-!~{006}~.js");`,
            /outside a Vite preload call/,
        ],
        [
            "a preload callback with two imports",
            `const d=C(()=>Promise.all([import("./Home-!~{003}~.js"),import("./Paytm-!~{005}~.js")]),__VITE_PRELOAD__);`,
            /preload callback with 2 dynamic imports/,
        ],
        [
            "a preload call with no import and two markers",
            `const d=C(()=>Promise.resolve(__VITE_PRELOAD__),__VITE_PRELOAD__);`,
            /no import and more than one marker/,
        ],
        [
            "a preload marker next to an inlined import",
            `const d=C(()=>Promise.resolve().then(()=>g),__VITE_PRELOAD__);const m=__VITE_PRELOAD__;`,
            /preload marker outside a preload call/,
        ],
        [
            "a preload marker outside a preload call",
            `const m=__VITE_PRELOAD__;`,
            /preload marker outside a preload call/,
        ],
        [
            "an unknown chunk",
            `const d=C(()=>import("./nope.js"),__VITE_PRELOAD__);`,
            /no chunk for \.\/nope\.js/,
        ],
        [
            "an unexpected third argument",
            `const d=C(()=>import("./pure-!~{006}~.js"),__VITE_PRELOAD__,x);`,
            /3rd argument/,
        ],
        ["code Rollup can't parse", `const (`, /parse error/],
    ])("leaves a hub unchanged and says why: %s", (_, extra, reason) => {
        const { render, warnings } = setup()
        expect(render(`${A}/app-!~{002}~.js`, `${HUB_CODE}\n${extra}`)).toBeNull()
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toMatch(/left .*app.* unchanged: /)
        expect(warnings[0]).toMatch(reason)
    })

    it("gives clashing or Object.prototype-named ids a hash of the full module path", () => {
        const { render } = setup({
            extraTargets: {
                [`${A}/Paytm-!~{009}~.js`]: chunk("Paytm", { facadeModuleId: `${ROOT}/src/js/lib/Paytm.ts` }),
                [`${A}/constructor-!~{010}~.js`]: chunk("constructor", {
                    facadeModuleId: `${ROOT}/constructor.js`,
                }),
            },
        })
        render(`${A}/app-!~{002}~.js`, HUB_CODE)
        const out = render(`${A}/main-!~{001}~.js`, `import"./app-!~{002}~.js";`).code
        const ids = [...out.matchAll(/"([^"]+)":\["(Paytm-!~\{00[59]\}~|constructor-!~\{010\}~)"/g)]
        expect(ids).toHaveLength(3)
        for (const [, id] of ids) expect(id).toMatch(/^#[0-9a-f]{12}$/)
        expect(new Set(ids.map(([, id]) => id)).size).toBe(3)
        // ids that don't clash keep their readable form
        expect(out).toContain(`"src/js/pages/Home/index":[`)
    })

    it('treats only true and "true" as enabled', () => {
        expect(isStableChunkNamesEnabled(true)).toBe(true)
        expect(isStableChunkNamesEnabled("true")).toBe(true)
        expect(isStableChunkNamesEnabled(undefined)).toBe(false)
        expect(isStableChunkNamesEnabled(false)).toBe(false)
        expect(isStableChunkNamesEnabled("false")).toBe(false)
    })
})

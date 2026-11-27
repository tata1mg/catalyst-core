import { describe, expect, it } from "vitest"
import { hoistImportsPlugin } from "../../src/vite/hoist-imports-plugin.js"

// Rolldown does not hoist transitive imports the way Rollup did, so the plugin
// adds them to entry and dynamic-entry chunks after the bundle is generated.

type Chunk = {
    type: "chunk"
    fileName: string
    imports: string[]
    isEntry: boolean
    isDynamicEntry: boolean
    code: string
}

const chunk = (fileName: string, imports: string[], extra: Partial<Chunk> = {}): Chunk => ({
    type: "chunk",
    fileName,
    imports,
    isEntry: false,
    isDynamicEntry: false,
    code: `/* ${fileName} */\n`,
    ...extra,
})

function run(chunks: Chunk[]) {
    const bundle: Record<string, unknown> = Object.fromEntries(chunks.map((c) => [c.fileName, c]))
    bundle["client/assets/css/a.css"] = { type: "asset", fileName: "client/assets/css/a.css", source: "" }
    const plugin = hoistImportsPlugin() as unknown as { generateBundle: (o: object, b: object) => void }
    plugin.generateBundle({}, bundle)
    return bundle as Record<string, Chunk>
}

describe("hoistImportsPlugin", () => {
    it("adds the transitive closure an entry does not already import", () => {
        const bundle = run([
            chunk("client/assets/main-a.js", ["client/assets/app-b.js"], { isEntry: true }),
            chunk("client/assets/app-b.js", ["client/assets/vendor-react-c.js"]),
            chunk("client/assets/vendor-react-c.js", []),
        ])
        expect(bundle["client/assets/main-a.js"].code).toBe(
            '/* client/assets/main-a.js */\n\nimport"./vendor-react-c.js";'
        )
    })

    it("records the hoisted chunks in chunk.imports", () => {
        const bundle = run([
            chunk("client/assets/main-a.js", ["client/assets/app-b.js"], { isEntry: true }),
            chunk("client/assets/app-b.js", ["client/assets/vendor-network-c.js"]),
            chunk("client/assets/vendor-network-c.js", []),
        ])
        expect(bundle["client/assets/main-a.js"].imports).toEqual([
            "client/assets/app-b.js",
            "client/assets/vendor-network-c.js",
        ])
        expect(bundle["client/assets/app-b.js"].imports).toEqual(["client/assets/vendor-network-c.js"])
    })

    it("does the same for dynamic entries and keeps the sourcemap comment last", () => {
        const bundle = run([
            chunk("client/assets/Page-d.js", ["client/assets/app-b.js"], {
                isDynamicEntry: true,
                code: "page()\n//# sourceMappingURL=Page-d.js.map",
            }),
            chunk("client/assets/app-b.js", ["client/assets/vendor-c.js"]),
            chunk("client/assets/vendor-c.js", []),
        ])
        expect(bundle["client/assets/Page-d.js"].code).toBe(
            'page()\nimport"./vendor-c.js";\n//# sourceMappingURL=Page-d.js.map'
        )
    })

    it("leaves shared chunks, already-flat entries and chunk cycles untouched", () => {
        const bundle = run([
            chunk("client/assets/flat-e.js", ["client/assets/leaf-f.js"], { isEntry: true }),
            chunk("client/assets/leaf-f.js", []),
            chunk("client/assets/shared-g.js", ["client/assets/leaf-f.js"]),
            chunk("client/assets/Cycle-h.js", ["client/assets/back-i.js"], { isDynamicEntry: true }),
            chunk("client/assets/back-i.js", ["client/assets/Cycle-h.js", "client/assets/leaf-f.js"]),
        ])
        for (const name of ["flat-e", "shared-g", "Cycle-h"]) {
            const fileName = Object.keys(bundle).find((key) => key.includes(name)) as string
            expect(bundle[fileName].code).toBe(`/* ${fileName} */\n`)
        }
    })
})

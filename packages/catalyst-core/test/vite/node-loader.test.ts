import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { load } from "../../src/vite/node-loader.mjs"

// The loader decides between "dependency, leave it to Node" and "app file,
// transform it" from the file's path. Getting that wrong on Windows, where the
// separators are backslashes, made `catalyst build` run out of memory: esbuild
// was started for every dependency and its workers re-registered this loader.
describe("node-loader load()", () => {
    let dir: string
    const defaultLoad = vi.fn(async () => ({ format: "module", source: "from Node" }))

    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "catalyst-loader-"))
        defaultLoad.mockClear()
    })
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    const write = (relative: string, source: string) => {
        const file = path.join(dir, relative)
        mkdirSync(path.dirname(file), { recursive: true })
        writeFileSync(file, source)
        return pathToFileURL(file).href
    }

    it("leaves an ESM dependency to Node, on every path separator", async () => {
        write("node_modules/dep/package.json", JSON.stringify({ type: "module" }))
        const url = write("node_modules/dep/index.js", "#!/usr/bin/env node\nexport const value = 1\n")

        const result = await load(url, {}, defaultLoad)

        expect(defaultLoad).toHaveBeenCalledTimes(1)
        expect(result.source).toBe("from Node")
    })

    it("still transforms an app file", async () => {
        write("package.json", JSON.stringify({ type: "module" }))
        const url = write("src/App.js", "export const App = () => <div />\n")

        const result = await load(url, {}, defaultLoad)

        expect(defaultLoad).not.toHaveBeenCalled()
        expect(result.source).not.toContain("<div")
    })
})

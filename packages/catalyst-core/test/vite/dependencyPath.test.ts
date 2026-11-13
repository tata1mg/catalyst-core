import { describe, expect, it } from "vitest"

import { isDependencyPath } from "../../src/vite/dependencyPath.mjs"

// The loader decides between "dependency, leave it to Node" and "app file,
// transform it" from the file's path. Getting that wrong on Windows, where the
// separators are backslashes, made `catalyst build` run out of memory: esbuild
// was started for every dependency and its workers re-registered the loader.
// Literal paths, so the Windows case is checked on every OS.
describe("isDependencyPath", () => {
    it("knows a dependency on every path separator", () => {
        expect(isDependencyPath("/app/node_modules/vite/bin/vite.js")).toBe(true)
        expect(isDependencyPath("C:\\Users\\me\\app\\node_modules\\vite\\bin\\vite.js")).toBe(true)
        expect(isDependencyPath("C:\\Users\\me\\app\\node_modules/vite/bin/vite.js")).toBe(true)
    })

    it("treats app files as app files", () => {
        expect(isDependencyPath("/app/src/App.js")).toBe(false)
        expect(isDependencyPath("C:\\Users\\me\\app\\src\\App.js")).toBe(false)
        // A folder merely named like it is not node_modules.
        expect(isDependencyPath("C:\\Users\\me\\my_node_modules_notes\\App.js")).toBe(false)
    })
})

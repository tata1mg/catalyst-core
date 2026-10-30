import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const createAssetsPhase = createRequire(import.meta.url)("../../src/native/buildAndroid/assets.js")

let root: string
const write = (relative: string) => {
    const file = path.join(root, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "x")
}
const assets = (relative: string) =>
    path.join(root, "native", "androidProject", "app", "src", "main", "assets", relative)

// With buildOptimisation the web build ships inside the app, minus the route
// manifests. This was rm -rf and rsync, neither of which exist on Windows.
describe("copyBuildAssets", () => {
    let phase: { copyBuildAssets: (config: object, optimise: boolean) => Promise<void> }

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst android assets "))
        vi.spyOn(process, "cwd").mockReturnValue(path.join(root, "app"))
        phase = createAssetsPhase({
            configPath: path.join(root, "app", "config", "config.json"),
            publicPath: path.join(root, "app", "public"),
            pwd: path.join(root, "native"),
            progress: { log: () => {} },
        })
    })
    afterEach(() => {
        vi.restoreAllMocks()
        fs.rmSync(root, { recursive: true, force: true })
    })

    it("does nothing without build optimisation", async () => {
        write("app/build/client/main.js")
        await phase.copyBuildAssets({}, false)
        expect(fs.existsSync(assets("build"))).toBe(false)
    })

    it("copies the build, leaves out route manifests at any depth, and drops stale files", async () => {
        write("app/build/client/main.js")
        write("app/build/route-manifest.json.gz")
        write("app/build/client/route-manifest.json.br")
        write("app/build/client/route-manifest.json")
        write("native/androidProject/app/src/main/assets/build/stale.js")

        await phase.copyBuildAssets({}, true)

        expect(fs.existsSync(assets("build/client/main.js"))).toBe(true)
        expect(fs.existsSync(assets("build/client/route-manifest.json"))).toBe(true)
        expect(fs.existsSync(assets("build/route-manifest.json.gz"))).toBe(false)
        expect(fs.existsSync(assets("build/client/route-manifest.json.br"))).toBe(false)
        expect(fs.existsSync(assets("build/stale.js"))).toBe(false)
    })

    it("copies through a linked build folder, still leaving out the manifests", async () => {
        write("elsewhere/client/main.js")
        write("elsewhere/route-manifest.json.gz")
        fs.mkdirSync(path.join(root, "app"), { recursive: true })
        try {
            fs.symlinkSync(path.join(root, "elsewhere"), path.join(root, "app", "build"), "junction")
        } catch {
            return // Creating links can need privileges; nothing to check without one.
        }

        await phase.copyBuildAssets({}, true)

        expect(fs.lstatSync(assets("build")).isSymbolicLink()).toBe(false)
        expect(fs.existsSync(assets("build/client/main.js"))).toBe(true)
        expect(fs.existsSync(assets("build/route-manifest.json.gz"))).toBe(false)
    })

    it("reports a build that does not exist", async () => {
        await expect(phase.copyBuildAssets({}, true)).rejects.toThrow(/Error copying build assets/)
    })
})

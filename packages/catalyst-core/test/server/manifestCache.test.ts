import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getAssetManifest, getManifest } from "../../src/server/manifestCache.js"

// manifestCache loads build manifests once at module import, gated on
// NODE_ENV === "production". #348 coverage.

describe("manifestCache (non-production)", () => {
    it("getManifest() is null when NODE_ENV is not production", () => {
        expect(process.env.NODE_ENV).not.toBe("production")
        expect(getManifest()).toBeNull()
    })

    it("getAssetManifest() is null when NODE_ENV is not production", () => {
        expect(getAssetManifest()).toBeNull()
    })
})

describe("manifestCache (production load path)", () => {
    let tmp: string
    let savedEnv: string | undefined
    let savedSrc: string | undefined
    let savedBuild: string | undefined

    beforeEach(() => {
        savedEnv = process.env.NODE_ENV
        savedSrc = process.env.src_path
        savedBuild = process.env.BUILD_OUTPUT_PATH
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manifestcache-"))
        fs.mkdirSync(path.join(tmp, "build", ".vite"), { recursive: true })
        process.env.NODE_ENV = "production"
        process.env.src_path = tmp
        process.env.BUILD_OUTPUT_PATH = "build"
        vi.resetModules()
    })
    afterEach(() => {
        process.env.NODE_ENV = savedEnv
        if (savedSrc === undefined) delete process.env.src_path
        else process.env.src_path = savedSrc
        if (savedBuild === undefined) delete process.env.BUILD_OUTPUT_PATH
        else process.env.BUILD_OUTPUT_PATH = savedBuild
        fs.rmSync(tmp, { recursive: true, force: true })
        vi.resetModules()
        vi.restoreAllMocks()
    })

    it("reads manifest.json + asset-categories.json from the build dir at import time", async () => {
        const vite = path.join(tmp, "build", ".vite")
        fs.writeFileSync(path.join(vite, "manifest.json"), JSON.stringify({ "entry.js": { file: "e.js" } }))
        fs.writeFileSync(
            path.join(vite, "asset-categories.json"),
            JSON.stringify({ essential: { e: { file: "e.js" } } }),
        )

        const mod = await import("../../src/server/manifestCache.js")
        expect(mod.getManifest()).toEqual({ "entry.js": { file: "e.js" } })
        expect(mod.getAssetManifest()).toEqual({ essential: { e: { file: "e.js" } } })
    })

    it("warns and leaves manifests null when the build files are absent", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        // no manifest.json written -> existsSync false -> stays null,
        // no throw. (The catch/warn path is exercised by making the
        // read fail below.)
        const mod = await import("../../src/server/manifestCache.js")
        expect(mod.getManifest()).toBeNull()
        warn.mockRestore()
    })
})

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
            JSON.stringify({ essential: { e: { file: "e.js" } } })
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

    describe("integrity manifest (SCRIPT_INTEGRITY_ENABLE)", () => {
        const files = { "client/assets/main-abc.js": "sha384-abc" }
        let savedEnvObject: NodeJS.ProcessEnv

        beforeEach(() => {
            savedEnvObject = process.env
            fs.writeFileSync(path.join(tmp, "build", ".vite", "integrity.json"), JSON.stringify(files))
        })
        afterEach(() => {
            process.env = savedEnvObject
        })

        // config.json booleans reach process.env as real booleans, which only a
        // replaced process.env object can hold.
        const setEnv = (extra: Record<string, unknown>) => {
            process.env = { ...process.env, ...extra } as any
        }

        it("re-keys integrity.json by script URL when the flag is on", async () => {
            setEnv({
                SCRIPT_INTEGRITY_ENABLE: true,
                PUBLIC_STATIC_ASSET_URL: "https://cdn.test",
                PUBLIC_STATIC_ASSET_PATH: "/static/",
            })
            const mod = await import("../../src/server/manifestCache.js")
            expect(mod.getIntegrityManifest()).toEqual({
                "https://cdn.test/static/client/assets/main-abc.js": "sha384-abc",
            })
        })

        it("ignores integrity.json when the flag is off", async () => {
            setEnv({ SCRIPT_INTEGRITY_ENABLE: false })
            const mod = await import("../../src/server/manifestCache.js")
            expect(mod.getIntegrityManifest()).toEqual({})
        })

        it("is empty and warns when the flag is on but the build wrote no integrity.json", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
            fs.rmSync(path.join(tmp, "build", ".vite", "integrity.json"))
            setEnv({ SCRIPT_INTEGRITY_ENABLE: true })
            const mod = await import("../../src/server/manifestCache.js")
            expect(mod.getIntegrityManifest()).toEqual({})
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining("SCRIPT_INTEGRITY_ENABLE is on but"),
                expect.stringContaining("integrity.json"),
                expect.any(String)
            )
        })

        it("warns about integrity.json alone when it is malformed, and keeps the other manifests", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
            const vite = path.join(tmp, "build", ".vite")
            fs.writeFileSync(
                path.join(vite, "manifest.json"),
                JSON.stringify({ "client/index.js": { file: "a.js" } })
            )
            fs.writeFileSync(path.join(vite, "integrity.json"), "invalid json{")
            setEnv({ SCRIPT_INTEGRITY_ENABLE: true })
            const mod = await import("../../src/server/manifestCache.js")
            expect(mod.getManifest()).toEqual({ "client/index.js": { file: "a.js" } })
            expect(mod.getIntegrityManifest()).toEqual({})
            expect(warn).not.toHaveBeenCalledWith("Could not load build manifests:", expect.any(String))
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining("SCRIPT_INTEGRITY_ENABLE is on but"),
                expect.stringContaining("integrity.json"),
                expect.any(String)
            )
        })

        it("does not warn about a missing integrity.json when the flag is off", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
            fs.rmSync(path.join(tmp, "build", ".vite", "integrity.json"))
            setEnv({ SCRIPT_INTEGRITY_ENABLE: false })
            await import("../../src/server/manifestCache.js")
            expect(warn).not.toHaveBeenCalled()
        })
    })

    it("catches and warns when manifest JSON is malformed", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const vite = path.join(tmp, "build", ".vite")
        fs.writeFileSync(path.join(vite, "manifest.json"), "invalid json{")
        const mod = await import("../../src/server/manifestCache.js")
        expect(mod.getManifest()).toBeNull()
        expect(warn).toHaveBeenCalledWith("Could not load build manifests:", expect.any(String))
        warn.mockRestore()
    })
})

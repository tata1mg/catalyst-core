import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
    collectScriptIntegrity,
    isScriptIntegrityEnabled,
    scriptIntegrityPlugin,
} from "../../src/vite/script-integrity-plugin.js"

const sha384 = (content: string) => `sha384-${crypto.createHash("sha384").update(content).digest("base64")}`

describe("script-integrity plugin", () => {
    let tmp: string
    let buildDir: string
    let integrityPath: string
    let savedEnv: NodeJS.ProcessEnv

    const viteManifest = {
        "client/index.js": {
            file: "client/assets/main-abc.js",
            isEntry: true,
            css: ["client/assets/css/main.css"],
        },
        "_vendor.js": { file: "client/assets/vendor-def.js" },
        "src/logo.svg": { file: "client/assets/logo.svg" },
    }

    beforeEach(() => {
        savedEnv = process.env
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "script-integrity-"))
        buildDir = path.join(tmp, "build")
        integrityPath = path.join(buildDir, ".vite", "integrity.json")
        fs.mkdirSync(path.join(buildDir, ".vite"), { recursive: true })
        fs.mkdirSync(path.join(buildDir, "client", "assets"), { recursive: true })
        fs.writeFileSync(path.join(buildDir, "client/assets/main-abc.js"), "console.log('main')")
        fs.writeFileSync(path.join(buildDir, "client/assets/vendor-def.js"), "console.log('vendor')")
        fs.writeFileSync(path.join(buildDir, "client/assets/logo.svg"), "<svg/>")
        fs.writeFileSync(path.join(buildDir, ".vite", "manifest.json"), JSON.stringify(viteManifest))
    })
    afterEach(() => {
        process.env = savedEnv
        fs.rmSync(tmp, { recursive: true, force: true })
    })

    const setEnv = (flag: unknown) => {
        process.env = {
            ...process.env,
            src_path: tmp,
            BUILD_OUTPUT_PATH: "build",
            SCRIPT_INTEGRITY_ENABLE: flag,
        } as any
    }

    it('treats only true and "true" as enabled', () => {
        expect(isScriptIntegrityEnabled(true)).toBe(true)
        expect(isScriptIntegrityEnabled("true")).toBe(true)
        expect(isScriptIntegrityEnabled(undefined)).toBe(false)
        expect(isScriptIntegrityEnabled(false)).toBe(false)
        expect(isScriptIntegrityEnabled("false")).toBe(false)
    })

    it("hashes the JS files in the manifest and skips non-JS files", () => {
        expect(collectScriptIntegrity(buildDir, viteManifest)).toEqual({
            "client/assets/main-abc.js": sha384("console.log('main')"),
            "client/assets/vendor-def.js": sha384("console.log('vendor')"),
        })
    })

    it("warns and skips a JS file the manifest lists that is not on disk", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const manifest = { ...viteManifest, "_gone.js": { file: "client/assets/gone.js" } }
        expect(collectScriptIntegrity(buildDir, manifest)).toEqual({
            "client/assets/main-abc.js": sha384("console.log('main')"),
            "client/assets/vendor-def.js": sha384("console.log('vendor')"),
        })
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("client/assets/gone.js"))
        warn.mockRestore()
    })

    it("runs last and waits for the other plugins' closeBundle hooks", () => {
        const plugin = scriptIntegrityPlugin()
        expect(plugin.enforce).toBe("post")
        expect(plugin.closeBundle.order).toBe("post")
        expect(plugin.closeBundle.sequential).toBe(true)
    })

    it("writes .vite/integrity.json on closeBundle when the flag is on", () => {
        setEnv(true)
        scriptIntegrityPlugin().closeBundle.handler()
        expect(JSON.parse(fs.readFileSync(integrityPath, "utf8"))).toEqual({
            "client/assets/main-abc.js": sha384("console.log('main')"),
            "client/assets/vendor-def.js": sha384("console.log('vendor')"),
        })
    })

    it("writes nothing when the flag is off, and removes a file left by an earlier build", () => {
        fs.writeFileSync(integrityPath, JSON.stringify({ "client/assets/old.js": "sha384-old" }))
        setEnv(false)
        scriptIntegrityPlugin().closeBundle.handler()
        expect(fs.existsSync(integrityPath)).toBe(false)
    })

    it("does nothing when the build produced no manifest", () => {
        fs.rmSync(path.join(buildDir, ".vite", "manifest.json"))
        setEnv(true)
        expect(() => scriptIntegrityPlugin().closeBundle.handler()).not.toThrow()
        expect(fs.existsSync(integrityPath)).toBe(false)
    })
})

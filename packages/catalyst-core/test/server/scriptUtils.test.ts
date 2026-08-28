import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
    arrayToObject,
    getDebugEnvInfo,
    printBundleInformation,
    resolveOutputMode,
} from "../../src/scripts/scriptUtils.js"

// Small helpers consumed by validator.js / handler.jsx at module load
// (resolveOutputMode picks the error-formatting mode; getDebugEnvInfo
// feeds debug-mode error boxes). #348 coverage.

describe("arrayToObject", () => {
    it("parses KEY=VALUE entries and drops valueless ones", () => {
        expect(arrayToObject(["A=1", "B=2", "C", "D="])).toEqual({ A: "1", B: "2" })
    })
    it("returns {} for an empty array", () => {
        expect(arrayToObject([])).toEqual({})
    })
})

describe("resolveOutputMode", () => {
    it("prefers an explicit --debug flag over everything", () => {
        expect(resolveOutputMode(["node", "x", "--debug"], { CATALYST_OUTPUT_MODE: "verbose" })).toBe(
            "debug",
        )
    })
    it("honors --verbose", () => {
        expect(resolveOutputMode(["--verbose"], {})).toBe("verbose")
    })
    it("falls back to an inherited CATALYST_OUTPUT_MODE env value", () => {
        expect(resolveOutputMode([], { CATALYST_OUTPUT_MODE: "debug" })).toBe("debug")
        expect(resolveOutputMode([], { CATALYST_OUTPUT_MODE: "verbose" })).toBe("verbose")
    })
    it("ignores an unrecognized env value", () => {
        expect(resolveOutputMode([], { CATALYST_OUTPUT_MODE: "loud" })).toBe("default")
    })
    it("defaults to 'default' with no flags and no env", () => {
        expect(resolveOutputMode([], {})).toBe("default")
    })
})

describe("printBundleInformation", () => {
    let tmp: string
    let savedSrcPath: string | undefined
    let logSpy: ReturnType<typeof vi.spyOn>
    let errSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        savedSrcPath = process.env.src_path
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bundleinfo-"))
        fs.mkdirSync(path.join(tmp, "build", "public"), { recursive: true })
        logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
        errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    })
    afterEach(() => {
        if (savedSrcPath === undefined) delete process.env.src_path
        else process.env.src_path = savedSrcPath
        fs.rmSync(tmp, { recursive: true, force: true })
        vi.restoreAllMocks()
    })

    it("lists asset files by descending size, skipping .txt / .json", () => {
        const pub = path.join(tmp, "build", "public")
        fs.writeFileSync(path.join(pub, "small.js"), "x".repeat(100))
        fs.writeFileSync(path.join(pub, "big.js"), "x".repeat(5000))
        fs.writeFileSync(path.join(pub, "manifest.json"), "{}")
        fs.writeFileSync(path.join(pub, "notes.txt"), "skip me")
        process.env.src_path = tmp

        printBundleInformation()

        const printed = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n")
        expect(printed).toContain("big.js")
        expect(printed).toContain("small.js")
        expect(printed).not.toContain("manifest.json")
        expect(printed).not.toContain("notes.txt")
        // big.js is listed before small.js (sorted by size desc)
        expect(printed.indexOf("big.js")).toBeLessThan(printed.indexOf("small.js"))
    })

    it("logs a scan error and does not throw when build/public is missing", () => {
        process.env.src_path = path.join(tmp, "does-not-exist")
        expect(() => printBundleInformation()).not.toThrow()
        expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Unable to scan build folder"))
    })
})

describe("getDebugEnvInfo", () => {
    it("reports node version, platform, and a resolved catalyst-core version string", () => {
        const info = getDebugEnvInfo()
        expect(info.node).toBe(process.version)
        expect(info.platform).toBe(process.platform)
        expect(typeof info.catalystCore).toBe("string")
        expect(info.catalystCore.length).toBeGreaterThan(0)
    })
    it("is memoized (second call returns the same version)", () => {
        expect(getDebugEnvInfo().catalystCore).toBe(getDebugEnvInfo().catalystCore)
    })
})

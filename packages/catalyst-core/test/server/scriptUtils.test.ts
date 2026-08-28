import { describe, expect, it } from "vitest"
import {
    arrayToObject,
    getDebugEnvInfo,
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

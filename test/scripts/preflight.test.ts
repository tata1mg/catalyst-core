import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { runStaticPreflight, writeBuildInfo, checkBuildMatchesConfig } from "../../src/scripts/preflight.js"
import { ERROR_CODES } from "../../src/errors/registry.js"

// runStaticPreflight(appDir) reads config/config.json + package.json from a
// real directory and returns an array of CatalystError for every failure it
// finds (empty = the app would pass). These tests build throwaway app dirs
// and assert the codes.

const VALID_CONFIG = {
    NODE_SERVER_HOSTNAME: "localhost",
    NODE_SERVER_PORT: 3000,
    BUILD_OUTPUT_PATH: "build",
    PUBLIC_STATIC_ASSET_PATH: "/assets/",
    PUBLIC_STATIC_ASSET_URL: "http://localhost:3000",
    CLIENT_ENV_VARIABLES: [],
}
const VALID_PKG = {
    name: "fixture-app",
    _moduleAliases: {
        "@api": "api.js",
        "@containers": "src/js/containers",
        "@server": "server",
        "@config": "config",
        "@css": "src/static/css",
        "@routes": "src/js/routes/",
    },
}

let appDir: string

function writeApp({ config, pkg }: { config?: unknown; pkg?: unknown }) {
    if (config !== undefined) {
        mkdirSync(path.join(appDir, "config"), { recursive: true })
        writeFileSync(
            path.join(appDir, "config", "config.json"),
            typeof config === "string" ? config : JSON.stringify(config)
        )
    }
    if (pkg !== undefined) {
        writeFileSync(
            path.join(appDir, "package.json"),
            typeof pkg === "string" ? pkg : JSON.stringify(pkg)
        )
    }
}

const codes = (dir: string) => runStaticPreflight(dir).map((e) => e.code)

beforeEach(() => {
    appDir = mkdtempSync(path.join(tmpdir(), "preflight-test-"))
})
afterEach(() => {
    rmSync(appDir, { recursive: true, force: true })
})

describe("runStaticPreflight", () => {
    it("returns [] for a fully valid app", () => {
        writeApp({ config: VALID_CONFIG, pkg: VALID_PKG })
        expect(runStaticPreflight(appDir)).toEqual([])
    })

    it("PREFLIGHT-001 when config/config.json is absent", () => {
        writeApp({ pkg: VALID_PKG })
        expect(codes(appDir)).toContain(ERROR_CODES.PREFLIGHT_CONFIG_MISSING)
    })

    it("PREFLIGHT-001 when config/config.json is malformed JSON", () => {
        writeApp({ config: "{ not json", pkg: VALID_PKG })
        expect(codes(appDir)).toContain(ERROR_CODES.PREFLIGHT_CONFIG_MISSING)
    })

    it("PREFLIGHT-003 when a required config key is missing", () => {
        const { NODE_SERVER_PORT: _omit, ...partial } = VALID_CONFIG
        writeApp({ config: partial, pkg: VALID_PKG })
        expect(codes(appDir)).toContain(ERROR_CODES.PREFLIGHT_CONFIG_KEY_MISSING)
    })

    it("PREFLIGHT-004 when package.json is absent", () => {
        writeApp({ config: VALID_CONFIG })
        expect(codes(appDir)).toContain(ERROR_CODES.PREFLIGHT_PACKAGE_JSON_MISSING)
    })

    it("PREFLIGHT-005 when package.json is malformed JSON", () => {
        writeApp({ config: VALID_CONFIG, pkg: "{ nope" })
        expect(codes(appDir)).toContain(ERROR_CODES.PREFLIGHT_PACKAGE_JSON_INVALID)
    })

    it("PREFLIGHT-006 when _moduleAliases is absent", () => {
        writeApp({ config: VALID_CONFIG, pkg: { name: "x" } })
        expect(codes(appDir)).toContain(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_MISSING)
    })

    it("PREFLIGHT-009 when a required alias is missing", () => {
        const { "@containers": _drop, ...aliases } = VALID_PKG._moduleAliases
        writeApp({ config: VALID_CONFIG, pkg: { name: "x", _moduleAliases: aliases } })
        expect(codes(appDir)).toContain(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_KEY_MISSING)
    })

    it("collects MULTIPLE failures in one pass (config + package.json both broken)", () => {
        writeApp({}) // neither file written
        const found = codes(appDir)
        expect(found).toContain(ERROR_CODES.PREFLIGHT_CONFIG_MISSING)
        expect(found).toContain(ERROR_CODES.PREFLIGHT_PACKAGE_JSON_MISSING)
        expect(found.length).toBeGreaterThanOrEqual(2)
    })

    it("every returned item is a CatalystError with a docUrl", () => {
        writeApp({})
        for (const err of runStaticPreflight(appDir)) {
            expect(err.name).toBe("CatalystError")
            expect(err.docUrl).toMatch(/\/errors\/PREFLIGHT\/PREFLIGHT-\d{3}\.md$/)
        }
    })
})

describe("checkBuildMatchesConfig", () => {
    const CONFIG = {
        ...VALID_CONFIG,
        API_URL: "https://api.example.com",
        CLIENT_ENV_VARIABLES: ["API_URL"],
    }
    const SKIPPED = expect.stringContaining("Skipping the build/config check")

    function buildWith(config: Record<string, unknown>, args = {}) {
        mkdirSync(path.join(appDir, "build"), { recursive: true })
        writeBuildInfo(appDir, config, args)
    }

    beforeEach(() => {
        vi.spyOn(console, "warn").mockImplementation(() => {})
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("returns null when config.json is unchanged since the build", () => {
        writeApp({ config: CONFIG })
        buildWith(CONFIG)
        expect(checkBuildMatchesConfig(appDir)).toBeNull()
        expect(console.warn).not.toHaveBeenCalledWith(SKIPPED)
    })

    it("ignores config keys that are not inlined into the build", () => {
        writeApp({ config: { ...CONFIG, NODE_SERVER_PORT: 4000 } })
        buildWith(CONFIG)
        expect(checkBuildMatchesConfig(appDir)).toBeNull()
    })

    it("PREFLIGHT-022 when PUBLIC_STATIC_ASSET_URL changed", () => {
        writeApp({ config: { ...CONFIG, PUBLIC_STATIC_ASSET_URL: "http://192.168.1.5:3000" } })
        buildWith(CONFIG)
        const err = checkBuildMatchesConfig(appDir)
        expect(err?.code).toBe(ERROR_CODES.PREFLIGHT_BUILD_STALE)
        expect(err?.details).toContain(
            'PUBLIC_STATIC_ASSET_URL: built with "http://localhost:3000", now "http://192.168.1.5:3000"'
        )
    })

    it("PREFLIGHT-022 when a CLIENT_ENV_VARIABLES value changed", () => {
        writeApp({ config: { ...CONFIG, API_URL: "https://staging.example.com" } })
        buildWith(CONFIG)
        expect(checkBuildMatchesConfig(appDir)?.details).toContain(
            'API_URL: built with "https://api.example.com", now "https://staging.example.com"'
        )
    })

    it("PREFLIGHT-022 when a variable is added to CLIENT_ENV_VARIABLES", () => {
        writeApp({ config: { ...CONFIG, CUSTOM_VAR: "x", CLIENT_ENV_VARIABLES: ["API_URL", "CUSTOM_VAR"] } })
        buildWith(CONFIG)
        expect(checkBuildMatchesConfig(appDir)?.details).toContain('CUSTOM_VAR: built with unset, now "x"')
    })

    it("compares against KEY=value CLI arguments, which win over config.json", () => {
        const args = { PUBLIC_STATIC_ASSET_URL: "http://cdn.example.com" }
        writeApp({ config: CONFIG })
        buildWith(CONFIG, args)
        expect(checkBuildMatchesConfig(appDir, args)).toBeNull()
        expect(checkBuildMatchesConfig(appDir)?.code).toBe(ERROR_CODES.PREFLIGHT_BUILD_STALE)
    })

    it("treats a CLI argument equal to the config.json object as unchanged", () => {
        const config = { ...CONFIG, OPTIONS: { enabled: true }, CLIENT_ENV_VARIABLES: ["OPTIONS"] }
        writeApp({ config })
        buildWith(config)
        expect(checkBuildMatchesConfig(appDir, { OPTIONS: '{"enabled":true}' })).toBeNull()
        expect(checkBuildMatchesConfig(appDir, { CLIENT_ENV_VARIABLES: '["OPTIONS"]' })).toBeNull()
    })

    it("warns and passes when the build has no build info file", () => {
        writeApp({ config: CONFIG })
        expect(checkBuildMatchesConfig(appDir)).toBeNull()
        expect(console.warn).toHaveBeenCalledWith(SKIPPED)
    })

    it.each([["{ not json"], ["null"], ["[]"]])(
        "warns and passes when the build info file is %s",
        (contents) => {
            writeApp({ config: CONFIG })
            mkdirSync(path.join(appDir, "build"), { recursive: true })
            writeFileSync(path.join(appDir, "build", ".catalyst-build.json"), contents)
            expect(checkBuildMatchesConfig(appDir)).toBeNull()
            expect(console.warn).toHaveBeenCalledWith(SKIPPED)
        }
    )

    it("warns and passes when CLIENT_ENV_VARIABLES cannot be parsed", () => {
        writeApp({ config: CONFIG })
        buildWith(CONFIG)
        expect(checkBuildMatchesConfig(appDir, { CLIENT_ENV_VARIABLES: "not-json" })).toBeNull()
        expect(console.warn).toHaveBeenCalledWith(SKIPPED)
    })
})

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { runStaticPreflight } from "../../src/scripts/preflight.js"
import { ERROR_CODES } from "../../src/errors/registry.js"

// runStaticPreflight(appDir) reads config/config.json + package.json from a
// real directory and returns an array of CatalystError for every failure it
// finds (empty = the app would pass). These tests build throwaway app dirs
// and assert the codes.

const VALID_CONFIG = {
    NODE_SERVER_HOSTNAME: "localhost",
    NODE_SERVER_PORT: 3000,
    WEBPACK_DEV_SERVER_HOSTNAME: "localhost",
    WEBPACK_DEV_SERVER_PORT: 3001,
    BUILD_OUTPUT_PATH: "build",
    PUBLIC_STATIC_ASSET_PATH: "/assets/",
    PUBLIC_STATIC_ASSET_URL: "http://localhost:3000",
    CLIENT_ENV_VARIABLES: [],
    ANALYZE_BUNDLE: false,
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

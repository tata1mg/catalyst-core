import { describe, it, expect } from "vitest"
import {
    validateConfigFile,
    validatePackageJson,
    validateModuleAlias,
    validatePreInitServer,
    validateMiddleware,
    validateReducerFunction,
    validateConfigureStore,
    validateGetRoutes,
    validateCustomDocument,
} from "../../src/server/utils/validator.js"
import { ERROR_CODES } from "../../src/errors/registry.js"

// Contract for the pure validate* functions: return `null` when valid, a
// CatalystError (never thrown, never logged) when not. scripts/preflight.js
// and the in-server call sites both depend on this exact shape.

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

const VALID_ALIASES = {
    "@api": "api.js",
    "@containers": "src/js/containers",
    "@server": "server",
    "@config": "config",
    "@css": "src/static/css",
    "@routes": "src/js/routes/",
}

describe("validateConfigFile", () => {
    it("returns null for a complete config", () => {
        expect(validateConfigFile(VALID_CONFIG)).toBeNull()
    })
    it("PREFLIGHT-001 when falsy", () => {
        expect(validateConfigFile(null)?.code).toBe(ERROR_CODES.PREFLIGHT_CONFIG_MISSING)
    })
    it("PREFLIGHT-002 when not an object", () => {
        expect(validateConfigFile("nope" as unknown as object)?.code).toBe(
            ERROR_CODES.PREFLIGHT_CONFIG_NOT_OBJECT
        )
    })
    it("PREFLIGHT-003 when a required key is missing, naming the key", () => {
        const { NODE_SERVER_PORT: _omit, ...rest } = VALID_CONFIG
        const err = validateConfigFile(rest)
        expect(err?.code).toBe(ERROR_CODES.PREFLIGHT_CONFIG_KEY_MISSING)
        expect(err?.details).toContain("NODE_SERVER_PORT")
    })
})

describe("validatePackageJson", () => {
    it("returns null for an object", () => {
        expect(validatePackageJson({ name: "x" })).toBeNull()
    })
    it("PREFLIGHT-004 when falsy", () => {
        expect(validatePackageJson(null)?.code).toBe(ERROR_CODES.PREFLIGHT_PACKAGE_JSON_MISSING)
    })
    it("PREFLIGHT-005 when not an object", () => {
        expect(validatePackageJson("x" as unknown as object)?.code).toBe(
            ERROR_CODES.PREFLIGHT_PACKAGE_JSON_INVALID
        )
    })
})

describe("validateModuleAlias", () => {
    it("returns null for the full required set", () => {
        expect(validateModuleAlias(VALID_ALIASES)).toBeNull()
    })
    it("PREFLIGHT-006 when falsy", () => {
        expect(validateModuleAlias(null)?.code).toBe(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_MISSING)
    })
    it("PREFLIGHT-007 when not an object", () => {
        expect(validateModuleAlias("x" as unknown as object)?.code).toBe(
            ERROR_CODES.PREFLIGHT_MODULE_ALIAS_NOT_OBJECT
        )
    })
    it("PREFLIGHT-008 when a key shadows a catalyst alias (checks the INPUT keys)", () => {
        const err = validateModuleAlias({ ...VALID_ALIASES, "@catalyst/thing": "x" })
        expect(err?.code).toBe(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_RESTRICTED)
    })
    it("PREFLIGHT-009 when a required alias is missing, naming it", () => {
        const { "@containers": _omit, ...rest } = VALID_ALIASES
        const err = validateModuleAlias(rest)
        expect(err?.code).toBe(ERROR_CODES.PREFLIGHT_MODULE_ALIAS_KEY_MISSING)
        expect(err?.details).toContain("@containers")
    })
})

describe.each([
    ["validatePreInitServer", validatePreInitServer, ERROR_CODES.PREFLIGHT_PRE_SERVER_INIT_MISSING, ERROR_CODES.PREFLIGHT_PRE_SERVER_INIT_NOT_FUNCTION],
    ["validateMiddleware", validateMiddleware, ERROR_CODES.PREFLIGHT_MIDDLEWARE_MISSING, ERROR_CODES.PREFLIGHT_MIDDLEWARE_NOT_FUNCTION],
    ["validateReducerFunction", validateReducerFunction, ERROR_CODES.PREFLIGHT_REDUCER_MISSING, ERROR_CODES.PREFLIGHT_REDUCER_NOT_FUNCTION],
    ["validateConfigureStore", validateConfigureStore, ERROR_CODES.PREFLIGHT_CONFIGURE_STORE_MISSING, ERROR_CODES.PREFLIGHT_CONFIGURE_STORE_NOT_FUNCTION],
    ["validateGetRoutes", validateGetRoutes, ERROR_CODES.PREFLIGHT_GET_ROUTES_MISSING, ERROR_CODES.PREFLIGHT_GET_ROUTES_NOT_FUNCTION],
    ["validateCustomDocument", validateCustomDocument, ERROR_CODES.PREFLIGHT_CUSTOM_DOCUMENT_MISSING, ERROR_CODES.PREFLIGHT_CUSTOM_DOCUMENT_NOT_FUNCTION],
] as const)("%s (function validator)", (_name, fn, missingCode, notFnCode) => {
    it("returns null for a function", () => {
        expect(fn(() => {})).toBeNull()
    })
    it(`${missingCode} when missing`, () => {
        expect(fn(undefined)?.code).toBe(missingCode)
    })
    it(`${notFnCode} when not a function`, () => {
        expect(fn(123 as unknown as () => void)?.code).toBe(notFnCode)
    })
})

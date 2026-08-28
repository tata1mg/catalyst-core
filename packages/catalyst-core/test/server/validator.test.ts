import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
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
    handleError,
    safeCall,
    safeCallNamed,
} from "../../src/server/utils/validator.js"
import { ERROR_CODES } from "../../src/errors/registry.js"
import { createError } from "../../src/errors/index.js"

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

// safeCall / safeCallNamed: the async hook-runners exported alongside the
// validators. They DO catch + log (via console.error) rather than return
// the error -- a different contract from the pure validate* functions
// above. Ported from #454's SSR-handler coverage.
describe("safeCall", () => {
    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => {})
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("returns the resolved value of a well-behaved fn", async () => {
        await expect(safeCall(async () => "ok", 1, 2)).resolves.toBe("ok")
    })
    it("swallows a throwing fn and logs a structured error", async () => {
        await expect(
            safeCall(() => {
                throw new Error("hook boom")
            })
        ).resolves.toBeUndefined()
        expect(console.error).toHaveBeenCalled()
    })
    it("swallows a rejected promise", async () => {
        await expect(safeCall(async () => Promise.reject(new Error("async boom")))).resolves.toBeUndefined()
        expect(console.error).toHaveBeenCalled()
    })
    it("is a no-op for a non-function", async () => {
        await expect(safeCall(undefined as never)).resolves.toBeUndefined()
        expect(console.error).not.toHaveBeenCalled()
    })
})

describe("safeCallNamed", () => {
    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => {})
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("returns the resolved value", async () => {
        await expect(safeCallNamed("onRouteMatch", async () => 7)).resolves.toBe(7)
    })
    it("names the hook in the logged error when it throws", async () => {
        await safeCallNamed("preServerInit", () => {
            throw new Error("x")
        })
        const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join("\n")
        expect(logged).toContain("preServerInit")
    })
    it("is a no-op for a non-function", async () => {
        await expect(safeCallNamed("x", null as never)).resolves.toBeUndefined()
    })
})

// handleError is the shared "log it in whatever output mode" helper the
// in-server call sites use with a validate* result. The validators
// themselves no longer call it (they return the error) -- exercise it
// directly. Ported + adapted from #454.
describe("handleError output mode", () => {
    afterEach(() => {
        vi.restoreAllMocks()
        vi.resetModules()
    })

    it("uses the non-'default' formatter branch when CATALYST_OUTPUT_MODE is verbose", async () => {
        const saved = process.env.CATALYST_OUTPUT_MODE
        process.env.CATALYST_OUTPUT_MODE = "verbose"
        vi.resetModules()
        vi.spyOn(console, "log").mockImplementation(() => {})
        try {
            // outputMode is resolved at module load -> "verbose" -> the
            // else branch of handleError runs (no "Failed to start
            // server:" prefix).
            const mod = await import("../../src/server/utils/validator.js")
            mod.handleError(createError(ERROR_CODES.PREFLIGHT_GET_ROUTES_MISSING))
            const logged = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join("\n")
            expect(logged).not.toContain("Failed to start server:")
        } finally {
            if (saved === undefined) delete process.env.CATALYST_OUTPUT_MODE
            else process.env.CATALYST_OUTPUT_MODE = saved
        }
    })

    it("uses the 'default' branch (with prefix) otherwise", () => {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
        handleError(createError(ERROR_CODES.PREFLIGHT_GET_ROUTES_MISSING))
        const logged = logSpy.mock.calls.flat().join("\n")
        expect(logged).toContain("Failed to start server:")
    })
})

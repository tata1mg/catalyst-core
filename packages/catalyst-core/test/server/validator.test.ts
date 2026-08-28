import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
    safeCall,
    safeCallNamed,
    validateConfigFile,
    validateConfigureStore,
    validateCustomDocument,
    validateGetRoutes,
    validateMiddleware,
    validateModuleAlias,
    validatePackageJson,
    validatePreInitServer,
    validateReducerFunction,
} from "../../src/server/utils/validator.js"

// Preflight validators + safeCall/safeCallNamed, pulled in by handler.jsx
// (validateConfigureStore / validateGetRoutes) and the wider server
// bootstrap. Each validator returns true for valid input and returns
// undefined after logging for invalid input (it never rethrows — the
// server bootstrap decides what to do with a falsy result). #348 coverage.

beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
    vi.restoreAllMocks()
})

describe("function validators (fn => true | logs+undefined)", () => {
    const fnValidators: Array<[string, (v: unknown) => unknown]> = [
        ["validatePreInitServer", validatePreInitServer],
        ["validateMiddleware", validateMiddleware],
        ["validateReducerFunction", validateReducerFunction],
        ["validateConfigureStore", validateConfigureStore],
        ["validateGetRoutes", validateGetRoutes],
        ["validateCustomDocument", validateCustomDocument],
    ]

    it.each(fnValidators)("%s returns true for a function", (_name, fn) => {
        expect(fn(() => {})).toBe(true)
    })

    it.each(fnValidators)("%s returns undefined + logs for a missing value", (_name, fn) => {
        expect(fn(undefined)).toBeUndefined()
        expect(console.log).toHaveBeenCalled()
    })

    it.each(fnValidators)("%s returns undefined + logs for a non-function value", (_name, fn) => {
        expect(fn(42)).toBeUndefined()
        expect(console.log).toHaveBeenCalled()
    })
})

describe("validatePackageJson", () => {
    it("accepts any object", () => {
        expect(validatePackageJson({ name: "x" })).toBe(true)
    })
    it("rejects a missing / non-object value", () => {
        expect(validatePackageJson(undefined)).toBeUndefined()
        expect(validatePackageJson("nope")).toBeUndefined()
    })
})

describe("validateConfigFile", () => {
    const fullConfig = {
        NODE_SERVER_HOSTNAME: "",
        NODE_SERVER_PORT: "",
        WEBPACK_DEV_SERVER_HOSTNAME: "",
        WEBPACK_DEV_SERVER_PORT: "",
        BUILD_OUTPUT_PATH: "",
        PUBLIC_STATIC_ASSET_PATH: "",
        PUBLIC_STATIC_ASSET_URL: "",
        CLIENT_ENV_VARIABLES: [],
        ANALYZE_BUNDLE: "",
    }

    it("accepts a config with every required key", () => {
        expect(validateConfigFile(fullConfig)).toBe(true)
    })
    it("rejects when a required key is missing", () => {
        const { ANALYZE_BUNDLE, ...missingOne } = fullConfig
        expect(validateConfigFile(missingOne)).toBeUndefined()
        expect(console.log).toHaveBeenCalled()
    })
    it("rejects a missing config entirely", () => {
        expect(validateConfigFile(undefined)).toBeUndefined()
    })
})

describe("validateModuleAlias", () => {
    const fullAliases = {
        "@api": "api.js",
        "@containers": "src/js/containers",
        "@server": "server",
        "@config": "config",
        "@css": "src/static/css",
        "@routes": "src/js/routes/",
    }

    it("accepts an alias map with every required alias", () => {
        expect(validateModuleAlias(fullAliases)).toBe(true)
    })
    it("rejects when a required alias is missing", () => {
        const { "@api": _api, ...missingOne } = fullAliases
        expect(validateModuleAlias(missingOne)).toBeUndefined()
        expect(console.log).toHaveBeenCalled()
    })
    it("rejects a missing alias map entirely", () => {
        expect(validateModuleAlias(undefined)).toBeUndefined()
    })
})

describe("safeCall", () => {
    it("returns the resolved value of a well-behaved fn", async () => {
        await expect(safeCall(async () => "ok", 1, 2)).resolves.toBe("ok")
    })
    it("swallows a throwing fn and logs a structured error", async () => {
        await expect(
            safeCall(() => {
                throw new Error("hook boom")
            }),
        ).resolves.toBeUndefined()
        expect(console.error).toHaveBeenCalled()
    })
    it("swallows a rejected promise", async () => {
        await expect(safeCall(async () => Promise.reject(new Error("async boom")))).resolves.toBeUndefined()
        expect(console.error).toHaveBeenCalled()
    })
    it("is a no-op for a non-function", async () => {
        await expect(safeCall(undefined as any)).resolves.toBeUndefined()
        expect(console.error).not.toHaveBeenCalled()
    })
})

describe("safeCallNamed", () => {
    it("returns the resolved value", async () => {
        await expect(safeCallNamed("onRouteMatch", async () => 7)).resolves.toBe(7)
    })
    it("names the hook in the logged error when it throws", async () => {
        await safeCallNamed("preServerInit", () => {
            throw new Error("x")
        })
        const logged = (console.error as any).mock.calls.flat().join("\n")
        expect(logged).toContain("preServerInit")
    })
    it("is a no-op for a non-function", async () => {
        await expect(safeCallNamed("x", null as any)).resolves.toBeUndefined()
    })
})

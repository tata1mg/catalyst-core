import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { renderEnd, renderStart } from "../../src/server/renderer/render.js"

// Pure prop-shaping helpers pulled in by handler.jsx (#348 coverage).

const ENV_KEYS = [
    "IS_DEV_COMMAND",
    "WEBPACK_DEV_SERVER_HOSTNAME",
    "WEBPACK_DEV_SERVER_PORT",
    "PUBLIC_STATIC_ASSET_URL",
    "PUBLIC_STATIC_ASSET_PATH",
]
let saved: Record<string, string | undefined>

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
})
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
    }
})

describe("renderStart", () => {
    const baseArgs = {
        inlineCss: "a{}",
        deferredRouteInlineCss: "b{}",
        jsScripts: ["s1"],
        criticalPreloadLinks: ["l1"],
        deferredPreloadLinks: ["l2"],
        metaTags: ["<meta>"],
        isBot: false,
        fetcherData: { "/": { data: 1 } },
    }

    it("passes props through and builds publicAssetPath from the PUBLIC_STATIC_ASSET_* env (prod branch)", () => {
        process.env.IS_DEV_COMMAND = "false"
        process.env.PUBLIC_STATIC_ASSET_URL = "https://cdn.example.com"
        process.env.PUBLIC_STATIC_ASSET_PATH = "/static/"

        const out = renderStart(baseArgs)

        expect(out.publicAssetPath).toBe("https://cdn.example.com/static/")
        expect(out.inlineCss).toBe("a{}")
        expect(out.deferredRouteInlineCss).toBe("b{}")
        expect(out.jsScripts).toEqual(["s1"])
        expect(out.metaTags).toEqual(["<meta>"])
        expect(out.isBot).toBe(false)
        expect(out.fetcherData).toEqual({ "/": { data: 1 } })
    })

    it("uses the webpack dev-server host/port for publicAssetPath when IS_DEV_COMMAND is true", () => {
        process.env.IS_DEV_COMMAND = "true"
        process.env.WEBPACK_DEV_SERVER_HOSTNAME = "localhost"
        process.env.WEBPACK_DEV_SERVER_PORT = "8081"
        process.env.PUBLIC_STATIC_ASSET_URL = "https://cdn.example.com"
        process.env.PUBLIC_STATIC_ASSET_PATH = "/static/"

        const out = renderStart(baseArgs)

        expect(out.publicAssetPath).toBe("http://localhost:8081/assets/")
    })
})

describe("renderEnd", () => {
    it("returns the document-body props with empty first-fold placeholders", () => {
        const jsx = { type: "div" }
        const out = renderEnd({ k: 1 }, {} as any, jsx, 404, { "/": {} })

        expect(out).toEqual({
            initialState: { k: 1 },
            firstFoldCss: "",
            firstFoldJS: "",
            jsx,
            errorCode: 404,
            fetcherData: { "/": {} },
        })
    })

    it("defaults initialState to an empty object", () => {
        const out = renderEnd(undefined, {} as any, null, null, {})
        expect(out.initialState).toEqual({})
    })
})

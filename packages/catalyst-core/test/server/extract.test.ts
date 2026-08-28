import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
    generateCssLinkStrings,
    generateModulePreloadLinkElements,
    generateScriptElements,
    generateScriptStrings,
    getCachedDeferredCssPathsForRoute,
    getDeferredPreloadScriptUrls,
    getDeferredRouteKey,
    readCssFromDisk,
    registerDeferredAssetsForRoute,
} from "../../src/server/renderer/extract.js"


// Pure asset-string / deferred-route-registry helpers pulled in by
// handler.jsx and _renderMarkUp (#348 coverage). The registry lives on
// process.deferredAssetsByRoute (module-level Map) — cleared between
// tests so cases don't leak.

beforeEach(() => {
    (process as any).deferredAssetsByRoute = new Map()
})
afterEach(() => {
    (process as any).deferredAssetsByRoute = new Map()
})

describe("getDeferredRouteKey", () => {
    it("returns the last matched route's path", () => {
        const matches = [{ route: { path: "/" } }, { route: { path: "/product/:id" } }]
        expect(getDeferredRouteKey({}, matches)).toBe("/product/:id")
    })
    it("returns null for no matches", () => {
        expect(getDeferredRouteKey({}, [])).toBeNull()
        expect(getDeferredRouteKey({})).toBeNull()
    })
})

describe("registerDeferredAssetsForRoute / getCachedDeferredCssPathsForRoute", () => {
    it("records new CSS paths once and reports only the not-yet-seen ones", () => {
        const first = registerDeferredAssetsForRoute("/r", { css: ["a.css", "b.css"] } as any)
        expect(first.newCssPaths).toEqual(["a.css", "b.css"])

        const second = registerDeferredAssetsForRoute("/r", { css: ["b.css", "c.css"] } as any)
        expect(second.newCssPaths).toEqual(["c.css"])

        expect(getCachedDeferredCssPathsForRoute("/r").sort()).toEqual(["a.css", "b.css", "c.css"])
    })

    it("skips JS URLs for bot requests but still records CSS", () => {
        registerDeferredAssetsForRoute("/r", { css: ["x.css"], js: ["x.js"] } as any, true)
        expect(getCachedDeferredCssPathsForRoute("/r")).toEqual(["x.css"])
        expect(getDeferredPreloadScriptUrls("/r")).toEqual([])
    })

    it("records JS URLs for non-bot requests", () => {
        registerDeferredAssetsForRoute("/r", { js: ["a.js", "b.js"] } as any, false)
        expect(getDeferredPreloadScriptUrls("/r").sort()).toEqual(["a.js", "b.js"])
    })

    it("no-ops for a falsy routeKey", () => {
        expect(registerDeferredAssetsForRoute(null, { css: ["a.css"] } as any)).toEqual({ newCssPaths: [] })
        expect(getCachedDeferredCssPathsForRoute(null)).toEqual([])
    })
})

describe("getDeferredPreloadScriptUrls", () => {
    it("excludes URLs already loaded as critical scripts", () => {
        registerDeferredAssetsForRoute("/r", { js: ["keep.js", "crit.js"] } as any, false)
        expect(getDeferredPreloadScriptUrls("/r", ["crit.js"])).toEqual(["keep.js"])
    })
    it("returns [] when the route has no record", () => {
        expect(getDeferredPreloadScriptUrls("/never")).toEqual([])
    })
})

describe("HTML / React element generators", () => {
    it("generateScriptElements dedupes and emits module <script> elements", () => {
        const els = generateScriptElements(["a.js", "a.js", "b.js"])
        expect(els).toHaveLength(2)
        expect(els[0].props).toMatchObject({ type: "module", src: "a.js" })
    })

    it("generateModulePreloadLinkElements dedupes and honors the key prefix", () => {
        const els = generateModulePreloadLinkElements(["a.js", "a.js"], "crit")
        expect(els).toHaveLength(1)
        expect(els[0].key).toBe("crit-0")
        expect(els[0].props).toMatchObject({ rel: "modulepreload", href: "a.js" })
    })

    it("generateCssLinkStrings builds deduped <link rel=stylesheet> strings", () => {
        expect(generateCssLinkStrings(["a.css", "a.css", "b.css"])).toBe(
            '<link rel="stylesheet" href="a.css"><link rel="stylesheet" href="b.css">',
        )
    })

    it("generateScriptStrings builds deduped module <script> strings", () => {
        expect(generateScriptStrings(["a.js", "a.js"])).toBe(
            '<script type="module" src="a.js"></script>',
        )
    })
})

describe("readCssFromDisk", () => {
    it("returns an empty string when given no paths", () => {
        expect(readCssFromDisk([], "/whatever")).toBe("")
    })

    it("returns an empty string (not a throw) when the CSS files do not exist on disk", () => {
        const out = readCssFromDisk(["does-not-exist.css"], "/tmp/nonexistent-build-dir")
        expect(out).toBe("")
    })
})

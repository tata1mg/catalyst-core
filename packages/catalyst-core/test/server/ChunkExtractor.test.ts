import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ChunkExtractor } from "../../src/server/renderer/ChunkExtractor.js"

// Asset bucketing used by handler.jsx's collectAssets / _renderMarkUp
// (#348 coverage). Critical = <head>, deferred = after </body>.

let savedUrl: string | undefined
let savedPath: string | undefined
beforeEach(() => {
    savedUrl = process.env.PUBLIC_STATIC_ASSET_URL
    savedPath = process.env.PUBLIC_STATIC_ASSET_PATH
    process.env.PUBLIC_STATIC_ASSET_URL = "https://cdn.example.com"
    process.env.PUBLIC_STATIC_ASSET_PATH = "/static/"
})
afterEach(() => {
    if (savedUrl === undefined) delete process.env.PUBLIC_STATIC_ASSET_URL
    else process.env.PUBLIC_STATIC_ASSET_URL = savedUrl
    if (savedPath === undefined) delete process.env.PUBLIC_STATIC_ASSET_PATH
    else process.env.PUBLIC_STATIC_ASSET_PATH = savedPath
})

describe("ChunkExtractor", () => {
    it("constructs with empty manifests and yields empty buckets", () => {
        const ce = new ChunkExtractor()
        expect(ce.getCriticalAssets()).toEqual({ js: [], css: [] })
        expect(ce.getDeferredAssets()).toEqual({ js: [], css: [] })
        expect(ce.getRenderedComponentKeys()).toEqual([])
    })

    it("loads essential entrypoints from assetManifest into the critical bucket as public URLs", () => {
        const ce = new ChunkExtractor({
            assetManifest: {
                essential: {
                    entry: { file: "assets/entry-abc.js", css: ["assets/entry-abc.css"] },
                },
            },
        })
        const critical = ce.getCriticalAssets()
        expect(critical.js).toEqual(["https://cdn.example.com/static/assets/entry-abc.js"])
        // CSS stays a relative path (read from disk later, not linked)
        expect(critical.css).toEqual(["assets/entry-abc.css"])
    })

    it("preloadRouteCss adds a matched route component's chunk to the critical bucket", () => {
        const ce = new ChunkExtractor({
            manifest: { "pages/Home": { file: "assets/home-xyz.js", css: ["assets/home-xyz.css"] } },
        })
        ce.preloadRouteCss([
            { route: { component: { __cacheKey: "pages/Home" } } },
            { route: {} }, // no component -> skipped, no throw
            null, // -> skipped
        ])
        const critical = ce.getCriticalAssets()
        expect(critical.js).toEqual(["https://cdn.example.com/static/assets/home-xyz.js"])
        expect(critical.css).toEqual(["assets/home-xyz.css"])
    })

    it("addComponent puts discovered chunks in the deferred bucket and tracks the key", () => {
        const ce = new ChunkExtractor({
            manifest: { "widgets/Cart": { file: "assets/cart-123.js", css: ["assets/cart-123.css"] } },
        })
        ce.addComponent("widgets/Cart")
        expect(ce.getRenderedComponentKeys()).toEqual(["widgets/Cart"])
        expect(ce.getDeferredAssets().js).toEqual(["https://cdn.example.com/static/assets/cart-123.js"])
    })

    it("addComponent falls back to a prefix (hashed) manifest key when the raw key is absent", () => {
        const ce = new ChunkExtractor({
            manifest: {
                "widgets/Modal.a1b2c3.js": { file: "assets/modal-a1b2c3.js", css: ["assets/modal.css"] },
            },
        })
        // raw "widgets/Modal.a1b2c3.js" isn't a key; "widgets/Modal" +
        // "." prefix-matches it.
        ce.addComponent("widgets/Modal")
        expect(ce.getDeferredAssets().js).toEqual([
            "https://cdn.example.com/static/assets/modal-a1b2c3.js",
        ])
    })

    it("addComponent is a no-op (but still tracks the key) when no manifest entry matches at all", () => {
        const ce = new ChunkExtractor({ manifest: {} })
        ce.addComponent("widgets/Unknown")
        expect(ce.getRenderedComponentKeys()).toEqual(["widgets/Unknown"])
        expect(ce.getDeferredAssets()).toEqual({ js: [], css: [] })
    })

    it("does not double-count a JS URL already tracked as critical", () => {
        const ce = new ChunkExtractor({
            assetManifest: { essential: { e: { file: "assets/shared.js" } } },
            manifest: { "widgets/Shared": { file: "assets/shared.js" } },
        })
        ce.addComponent("widgets/Shared")
        expect(ce.getDeferredAssets().js).toEqual([])
        expect(ce.getCriticalAssets().js).toEqual(["https://cdn.example.com/static/assets/shared.js"])
    })
})

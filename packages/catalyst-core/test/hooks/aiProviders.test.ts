import { describe, expect, it } from "vitest"
import { allowCloudMedia, isMobileWeb, resolveMode, resolveNativeEngine, resolvePlatform, resolveRoutingPlatform } from "../../src/native/bridge/hooks/aiProviders"

describe("useAI provider resolution", () => {
    it("maps on-device provider names to native mode", () => {
        for (const provider of ["native", "litert", "foundation-models"]) {
            expect(resolveMode(provider)).toBe("native")
        }
    })

    it("keeps the other modes unchanged", () => {
        expect(resolveMode("transformers")).toBe("local")
        expect(resolveMode("openai")).toBe("cloud")
        expect(resolveMode("gemini")).toBe("cloud")
        expect(resolveMode(undefined)).toBe("cloud")
    })

    it("does not treat Object prototype keys as providers", () => {
        expect(resolveMode("toString")).toBe("cloud")
        expect(resolveMode("constructor")).toBe("cloud")
    })

    it("pins the engine from the provider alias", () => {
        expect(resolveNativeEngine("litert", undefined, undefined)).toBe("litert")
        expect(resolveNativeEngine("foundation-models", undefined, undefined)).toBe("foundation-models")
    })

    it("'native' leaves the choice to the platform unless config or an option names an engine", () => {
        expect(resolveNativeEngine("native", undefined, undefined)).toBeUndefined()
        expect(resolveNativeEngine("native", undefined, { engine: "foundation-models" })).toBe("foundation-models")
        expect(resolveNativeEngine("native", "litert", { engine: "foundation-models" })).toBe("litert")
    })
})


describe("allowCloudMedia", () => {
    it("allows media only for an explicit cloud choice, never for a fallback from native or web", () => {
        expect(allowCloudMedia("cloud")).toBe(true)
        expect(allowCloudMedia("native")).toBe(false)
        expect(allowCloudMedia("local")).toBe(false)
    })
})

describe("resolvePlatform", () => {
    it("is the native app's platform inside a WebView build", () => {
        expect(resolvePlatform({ android: true, ios: false })).toBe("android")
        expect(resolvePlatform({ android: false, ios: true })).toBe("ios")
    })
    it("is web in any browser, including a phone's: there is no native module there", () => {
        expect(resolvePlatform({ android: false, ios: false })).toBe("web")
    })
})

describe("isMobileWeb / resolveRoutingPlatform", () => {
    it("trusts Client Hints when the browser sends them", () => {
        expect(isMobileWeb({ uaMobile: true, userAgent: "Macintosh" })).toBe(true)
        expect(isMobileWeb({ uaMobile: false, userAgent: "iPhone" })).toBe(false)
    })
    it("falls back to the user agent, including iPadOS posing as a Mac", () => {
        expect(isMobileWeb({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari" })).toBe(true)
        expect(isMobileWeb({ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel) Chrome Mobile" })).toBe(true)
        expect(isMobileWeb({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari", platform: "MacIntel", maxTouchPoints: 5 })).toBe(true)
        expect(isMobileWeb({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari", platform: "MacIntel", maxTouchPoints: 0 })).toBe(false)
        expect(isMobileWeb({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome" })).toBe(false)
    })
    it("only a plain browser is split; a native shell stays ios/android even on a phone", () => {
        expect(resolveRoutingPlatform({ android: false, ios: false }, true)).toBe("web-mobile")
        expect(resolveRoutingPlatform({ android: false, ios: false }, false)).toBe("web-desktop")
        expect(resolveRoutingPlatform({ android: false, ios: true }, true)).toBe("ios")
        expect(resolveRoutingPlatform({ android: true, ios: false }, true)).toBe("android")
    })
})

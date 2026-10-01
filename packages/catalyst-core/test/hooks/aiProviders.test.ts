import { describe, expect, it } from "vitest"
import { resolveMode, resolveNativeEngine } from "../../src/native/bridge/hooks/aiProviders"

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

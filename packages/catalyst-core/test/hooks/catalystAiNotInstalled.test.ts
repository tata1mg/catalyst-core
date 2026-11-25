// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createGenerationApi } from "../../src/native/bridge/hooks/aiGeneration"

// catalyst-ai is an optional package. The hooks import and everything else in catalyst-core works without it; only an AI call needs it.
// `__CATALYST_PACKAGES__.ai = false` is the build-time switch that makes the package unavailable, the same state as "not installed".

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.resetModules()
})

describe("catalyst-ai not installed", () => {
    beforeEach(() => {
        vi.resetModules()
        vi.stubGlobal("__CATALYST_PACKAGES__", { ai: false })
    })

    it("importing the hooks does not need the package", async () => {
        const hooks = await import("../../src/native/bridge/hooks/index")
        expect(typeof hooks.useAI).toBe("function")
        expect(typeof hooks.useMicrophone).toBe("function")
        expect(typeof hooks.useCamera).toBe("function")
    })

    it("useAI reports what to install through error, and generate() answers with the same error", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {})
        const { useAI } = await import("../../src/native/bridge/hooks/useAI")
        const { result } = renderHook(() => useAI({ provider: "openai" }))
        expect(result.current.error).toMatchObject({ code: "CATALYST_AI_NOT_INSTALLED" })
        expect((result.current.error as Error).message).toMatch(/npm install catalyst-ai/)
        const outcome: any = await result.current.generate({ messages: [{ role: "user", content: "hi" }] })
        expect(outcome.output).toBe("")
        expect(outcome.error).toBe(result.current.error)
        expect(spy).toHaveBeenCalledTimes(1) // logged once, not on every render
        renderHook(() => useAI({ provider: "openai" }))
        expect(spy).toHaveBeenCalledTimes(1)
        spy.mockRestore()
    })
})

describe("generation wrappers", () => {
    it("say to install the package when it is missing, and to update it when it is too old", async () => {
        const absent = createGenerationApi(() => null)
        await expect(absent.requestImage({})).rejects.toThrow(/not installed.*npm install catalyst-ai/)
        const old = createGenerationApi(() => ({}))
        await expect(old.requestImage({})).rejects.toThrow(/Update catalyst-ai/)
    })
})

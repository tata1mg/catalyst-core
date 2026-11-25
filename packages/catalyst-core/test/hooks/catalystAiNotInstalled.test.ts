// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
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

    it("importing the AI hook modules does not need the package", async () => {
        // (Not the whole index: it also loads the legacy native hooks, which no other test imports, and the coverage gate would count them.)
        const ai = await import("../../src/native/bridge/hooks/useAI")
        const generation = await import("../../src/native/bridge/hooks/aiGeneration")
        const microphone = await import("../../src/native/bridge/hooks/useMicrophone")
        expect(typeof ai.useAI).toBe("function")
        expect(typeof generation.useImageGen).toBe("function")
        expect(typeof microphone.useMicrophone).toBe("function")
    })

    it("useAI reports what to install through error, and generate() answers with the same error", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {})
        const { useAI } = await import("../../src/native/bridge/hooks/useAI")
        const { result } = renderHook(() => useAI({ provider: "openai" }))
        expect(result.current.error).toMatchObject({ code: "AI-010" })
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

describe("the hooks built on useAI, without catalyst-ai", () => {
    const INSTALL = /npm install catalyst-ai/
    const dir = "../../src/native/bridge/hooks/"
    beforeEach(() => {
        vi.resetModules()
        vi.stubGlobal("__CATALYST_PACKAGES__", { ai: false })
        vi.spyOn(console, "error").mockImplementation(() => {})
    })

    it("useTranscribe ends in an error that says what to install", async () => {
        const { useTranscribe } = await import("../../src/native/bridge/hooks/useTranscribe")
        const { result } = renderHook(() => useTranscribe({}))
        await act(async () => { await result.current.transcribe("data:audio/wav;base64,AAAA") })
        expect(result.current.status).toBe("error")
        expect(String(result.current.error?.message)).toMatch(INSTALL)
    })

    it("useVision ends in an error that says what to install", async () => {
        const { useVision } = await import("../../src/native/bridge/hooks/useVision")
        const { result } = renderHook(() => useVision({ schema: { type: "object", properties: { a: { type: "string" } } } } as any))
        await act(async () => { await result.current.scan("data:image/png;base64,iVBORw0KGgo=") })
        expect(result.current.status).toBe("error")
        expect(String(result.current.error?.message)).toMatch(INSTALL)
    })

    it("useAgent returns an error result that says what to install, before any step runs", async () => {
        const { useAgent } = await import("../../src/native/bridge/hooks/useAgent")
        const { result } = renderHook(() => useAgent({ tools: [] } as any))
        let outcome: any
        await act(async () => { outcome = await result.current.run("do it") })
        expect(outcome.status).toBe("error")
        expect(outcome.steps).toEqual([])
        expect(String(outcome.error?.message ?? outcome.error)).toMatch(INSTALL)
    })

    it("useImageGen and useSpeech answer with the install message", async () => {
        const generation = await import("../../src/native/bridge/hooks/aiGeneration")
        const image = renderHook(() => generation.useImageGen({}))
        let result: any
        await act(async () => { result = await image.result.current.generate("a boat") })
        expect(result.error).toMatch(INSTALL)
        const speech = renderHook(() => generation.useSpeech({}))
        await act(async () => { result = await speech.result.current.speak("hi") })
        expect(result.error).toMatch(INSTALL)
    })

    it("hooks that do not use AI are not affected", async () => {
        const { useMicrophone } = await import("../../src/native/bridge/hooks/useMicrophone")
        const { result } = renderHook(() => useMicrophone({}))
        expect(typeof result.current.start).toBe("function")
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

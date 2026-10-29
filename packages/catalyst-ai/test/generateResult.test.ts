// @vitest-environment jsdom
// generate() resolves with { output, error } so callers (useVision, agents) can await a result instead of watching state.
import { renderHook, act } from "@testing-library/react"

const cloudMod = import("../src/useCloudAI.js")
const webMod = import("../src/useWebAI.js")
const nativeMod = import("../src/useNativeAI.js")

const sse = (...frames: string[]) =>
    new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(frames.join("")))
        c.close() } }), { status: 200 })
const msgs = [{ role: "user", content: "hello" }]

describe("useCloudAI generate() result", () => {
    afterEach(() => vi.unstubAllGlobals())

    it("resolves with the streamed text", async () => {
        const { useCloudAI } = await cloudMod
        vi.stubGlobal("fetch", vi.fn(async () => sse('data: {"token":"hel"}\n\n', 'data: {"token":"lo"}\n\n', "data: [DONE]\n\n")))
        const { result } = renderHook(() => useCloudAI({ provider: "gemini" }))
        let outcome: any
        await act(async () => { outcome = await result.current.generate({ messages: msgs }) })
        expect(outcome).toEqual({ output: "hello", error: null })
        expect(result.current.output).toBe("hello")
    })

    it("resolves with the text in non-stream mode even though loading ends before the body is read", async () => {
        const { useCloudAI } = await cloudMod
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ output: "whole answer" }), { status: 200 })))
        const { result } = renderHook(() => useCloudAI({ provider: "gemini" }))
        let outcome: any
        await act(async () => { outcome = await result.current.generate({ messages: msgs, genConfig: { stream: false } }) })
        expect(outcome).toEqual({ output: "whole answer", error: null })
    })

    it("resolves with the error on an HTTP failure, with no output", async () => {
        const { useCloudAI } = await cloudMod
        vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })))
        const { result } = renderHook(() => useCloudAI({ provider: "gemini" }))
        let outcome: any
        await act(async () => { outcome = await result.current.generate({ messages: msgs }) })
        expect(outcome.output).toBe("")
        expect(outcome.error).toBeInstanceOf(Error)
        expect(String(outcome.error.message)).toContain("500")
    })

    it("resolves with the input error when media is not allowed", async () => {
        const { useCloudAI } = await cloudMod
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        const { result } = renderHook(() => useCloudAI({ provider: "gemini", allowMedia: false } as any))
        const image = [{ role: "user", content: [{ type: "image", data: "data:image/png;base64,iVBORw0KGgo=" }, { type: "text", text: "x" }] }]
        let outcome: any
        await act(async () => { outcome = await result.current.generate({ messages: image }) })
        expect(outcome.output).toBe("")
        expect(outcome.error?.reason).toBe("cloud-media-not-allowed")
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("each call gets its own result", async () => {
        const { useCloudAI } = await cloudMod
        let n = 0
        vi.stubGlobal("fetch", vi.fn(async () => sse(`data: {"token":"call${++n}"}\n\n`, "data: [DONE]\n\n")))
        const { result } = renderHook(() => useCloudAI({ provider: "gemini" }))
        let a: any, b: any
        await act(async () => { a = await result.current.generate({ messages: msgs }) })
        await act(async () => { b = await result.current.generate({ messages: msgs }) })
        expect([a.output, b.output]).toEqual(["call1", "call2"])
    })
})

describe("useNativeAI generate() result", () => {
    it("resolves with the not-ready error when the native stream is not up", async () => {
        const { useNativeAI } = await nativeMod
        const { result } = renderHook(() => useNativeAI({ enabled: false }))
        let outcome: any
        await act(async () => { outcome = await result.current.generate({ messages: msgs }) })
        expect(outcome.output).toBe("")
        expect(outcome.error).toBeTruthy()
    })
})

describe("useWebAI generate() result", () => {
    class FakeWorker {
        static last: FakeWorker
        onmessage: ((e: any) => void) | null = null
        onerror: ((e: any) => void) | null = null
        terminated = false
        constructor() { FakeWorker.last = this }
        postMessage() {}
        terminate() { this.terminated = true }
        emit(data: any) { this.onmessage?.({ data }) }
    }
    beforeEach(() => {
        vi.stubGlobal("Worker", FakeWorker)
        vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:fake" }))
    })
    afterEach(() => vi.unstubAllGlobals())

    const start = async (result: any) => {
        let promise!: Promise<any>
        await act(async () => { promise = result.current.generate({ messages: msgs }); await Promise.resolve() })
        return { promise } // wrapped: returning the promise itself would make `await start()` wait for it
    }

    it("resolves with the text when the worker reports done", async () => {
        const { useWebAI } = await webMod
        const { result } = renderHook(() => useWebAI({ model: "onnx-community/Qwen2.5-0.5B-Instruct" } as any))
        const { promise: pending } = await start(result)
        await act(async () => {
            FakeWorker.last.emit({ type: "token", text: "he" })
            FakeWorker.last.emit({ type: "token", text: "llo" })
            FakeWorker.last.emit({ type: "done", tps: 1, totalTokens: 2, genMs: 3 })
        })
        expect(await pending).toEqual({ output: "hello", error: null })
    })

    it("resolves with the error when the worker reports one", async () => {
        const { useWebAI } = await webMod
        vi.spyOn(console, "error").mockImplementation(() => {})
        const { result } = renderHook(() => useWebAI({ model: "onnx-community/Qwen2.5-0.5B-Instruct" } as any))
        const { promise: pending } = await start(result)
        await act(async () => { FakeWorker.last.emit({ type: "error", message: "out of memory" }) })
        const outcome = await pending
        expect(outcome.output).toBe("")
        expect(outcome.error).toBeTruthy()
    })

    it("does not hang when cancelled", async () => {
        const { useWebAI } = await webMod
        const { result } = renderHook(() => useWebAI({ model: "onnx-community/Qwen2.5-0.5B-Instruct" } as any))
        const { promise: pending } = await start(result)
        await act(async () => { result.current.cancel() })
        expect(await pending).toEqual({ output: "", error: null })
    })

    it("resolves at once when it is refused before a worker starts (no model)", async () => {
        const { useWebAI } = await webMod
        const { result } = renderHook(() => useWebAI({}))
        let outcome: any
        await act(async () => { outcome = await result.current.generate({ messages: msgs }) })
        expect(outcome.error).toBeTruthy()
        expect(outcome.output).toBe("")
    })
})

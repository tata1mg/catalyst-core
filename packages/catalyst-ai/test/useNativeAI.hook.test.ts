// @vitest-environment jsdom
// useNativeAI end to end against a fake native bridge: registration, readiness, progress/log/error callbacks, streamed
// and non-streamed generation, errors from every layer, cancel/reset and session metrics.
import { renderHook, act, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const transport = vi.hoisted(() => ({
    platform: "android" as string | null,
    initNativeAI: vi.fn(),
    clearNativeConversation: vi.fn(),
}))
vi.mock("../src/nativeTransport.js", async (importActual) => {
    const actual: any = await importActual()
    return {
        ...actual,
        getNativeAIPlatform: () => transport.platform,
        describeNativeAIUnavailable: () => "no native AI here",
        initNativeAI: transport.initNativeAI,
        clearNativeConversation: transport.clearNativeConversation,
    }
})
vi.mock("../src/nativeDownloadControl.js", () => ({ useNativeDownloadControl: vi.fn() }))

import { useNativeAI } from "../src/useNativeAI.js"
// Registry codes, written out so the test also pins them (catalyst-core/errors is ESM-only for this CJS test config).
const ERROR_CODES = { AI_NATIVE_BRIDGE_UNAVAILABLE: "AI-004", AI_NATIVE_STREAM_NOT_READY: "AI-005", AI_NATIVE_REQUEST_FAILED: "AI-006", AI_NATIVE_CALLBACK_ERROR: "AI-007" }
const win: any = globalThis

const STREAM_URL = "http://127.0.0.1:9/ai/stream"
const messages = [{ role: "user", content: "hi" }]

let callbacks: Record<string, (d: any) => void> = {}
let unregistered: string[] = []

function installBridge() {
    callbacks = {}
    unregistered = []
    ;win.WebBridge = {
        register: (name: string, fn: any) => { callbacks[name] = fn },
        unregister: (name: string) => { unregistered.push(name); delete callbacks[name] },
    }
}

const sse = (...events: any[]) => events.map((e) => (typeof e === "string" ? e : `data: ${JSON.stringify(e)}\n`)).join("")
function streamResponse(text: string, init: ResponseInit = {}) {
    const bytes = new TextEncoder().encode(text)
    const body = new ReadableStream({ start(c) { c.enqueue(bytes); c.close() } })
    return new Response(body, { status: 200, ...init })
}
const jsonResponse = (body: any, status = 200) => new Response(JSON.stringify(body), { status })

async function ready(result: any) {
    await act(async () => { callbacks.ON_AI_READY(JSON.stringify({ url: STREAM_URL })) })
    expect(result.current.modelReady).toBe(true)
}

beforeEach(() => {
    transport.platform = "android"
    transport.initNativeAI.mockClear()
    transport.clearNativeConversation.mockClear()
    installBridge()
})
afterEach(() => {
    vi.unstubAllGlobals()
})

describe("useNativeAI setup", () => {
    it("reports an error when there is no native platform or no WebBridge, and does nothing when disabled", () => {
        transport.platform = null
        expect((renderHook(() => useNativeAI() as any).result.current.error as any)?.code).toBe(ERROR_CODES.AI_NATIVE_BRIDGE_UNAVAILABLE)
        transport.platform = "android"
        delete win.WebBridge
        expect((renderHook(() => useNativeAI() as any).result.current.error as any)?.message).toMatch(/WebBridge not initialized/)
        installBridge()
        renderHook(() => useNativeAI({ enabled: false }))
        expect(Object.keys(callbacks)).toEqual([])
    })

    it("registers the four callbacks, initialises native with only the defined options, and unregisters on unmount", () => {
        const { unmount } = renderHook(() => useNativeAI({ engine: "litert", model: "m", systemPrompt: "sys", download: { windowSec: 5 } }))
        expect(Object.keys(callbacks).sort()).toEqual(["ON_AI_ERROR", "ON_AI_LOG", "ON_AI_PROGRESS", "ON_AI_READY"])
        expect(transport.initNativeAI).toHaveBeenCalledWith({ attachmentComponents: {}, systemPrompt: "sys", engine: "litert", model: "m", download: { windowSec: 5 } })
        unmount()
        expect(unregistered.sort()).toEqual(["ON_AI_ERROR", "ON_AI_LOG", "ON_AI_PROGRESS", "ON_AI_READY"])
    })

    it("passes modelPath through and omits undefined options", () => {
        renderHook(() => useNativeAI({ modelPath: "/models/x.litertlm" }))
        expect(transport.initNativeAI.mock.calls[0][0]).toEqual({ attachmentComponents: {}, systemPrompt: "", modelPath: "/models/x.litertlm" })
    })
})

describe("useNativeAI callbacks", () => {
    it("becomes ready on ON_AI_READY (string or object) and ignores a payload with no url or malformed JSON", async () => {
        const { result } = renderHook(() => useNativeAI() as any)
        await act(async () => { callbacks.ON_AI_READY("not json"); callbacks.ON_AI_READY({}) })
        expect(result.current.modelReady).toBe(false)
        await act(async () => { callbacks.ON_AI_READY({ url: STREAM_URL }) })
        expect(result.current.modelReady).toBe(true)
        expect(result.current.nativeDownloadProgress).toBeNull()
    })

    it("tracks download progress, exposes the paused reason, and ignores malformed progress", async () => {
        const { result } = renderHook(() => useNativeAI() as any)
        await act(async () => { callbacks.ON_AI_PROGRESS("garbage") })
        expect(result.current.nativeDownloadProgress).toBeNull()
        await act(async () => { callbacks.ON_AI_PROGRESS(JSON.stringify({ phase: "paused", detail: "offline,3s" })) })
        expect(result.current.downloadPaused).toBe(true)
        expect(result.current.downloadPauseReason).toBe("offline")
        await act(async () => { callbacks.ON_AI_PROGRESS({ phase: "downloading", percent: 10 }) })
        expect(result.current.downloadPaused).toBe(false)
        expect(result.current.downloadPauseReason).toBeNull()
    })

    it("keeps the last 100 native log lines", async () => {
        const { result } = renderHook(() => useNativeAI() as any)
        await act(async () => {
            for (let i = 0; i < 105; i++) callbacks.ON_AI_LOG(JSON.stringify({ message: `line ${i}` }))
            callbacks.ON_AI_LOG("raw text")
            callbacks.ON_AI_LOG("{bad")
        })
        // Payloads that are not valid JSON are skipped, not appended.
        expect(result.current.nativeLogs).toHaveLength(100)
        expect(result.current.nativeLogs.at(-1)).toBe("line 104")
    })

    it("turns ON_AI_ERROR into a coded error, falling back to the callback code for unknown codes", async () => {
        const { result } = renderHook(() => useNativeAI() as any)
        await act(async () => { callbacks.ON_AI_ERROR(JSON.stringify({ message: "boom", code: "NOT-A-CODE" })) })
        expect((result.current.error as any)?.message).toBe("boom")
        expect((result.current.error as any)?.code).toBe(ERROR_CODES.AI_NATIVE_CALLBACK_ERROR)
        await act(async () => { callbacks.ON_AI_ERROR("plain text failure") })
        expect((result.current.error as any)?.message).toBe("plain text failure")
        act(() => result.current.clearError())
        expect(result.current.error).toBeNull()
    })
})

describe("useNativeAI generate", () => {
    it("errors with STREAM_NOT_READY before the model is ready", async () => {
        const { result } = renderHook(() => useNativeAI() as any)
        let out: any
        await act(async () => { out = await result.current.generate({ messages }) })
        expect(out.error.code).toBe(ERROR_CODES.AI_NATIVE_STREAM_NOT_READY)
    })

    it("rejects an image sent to an engine that cannot read images", async () => {
        const { result } = renderHook(() => useNativeAI({ engine: "foundation-models" }))
        await ready(result)
        let out: any
        await act(async () => { out = await result.current.generate({ messages: [{ role: "user", content: [{ type: "image", data: "data:image/png;base64,AA" }] }] }) })
        expect(out.error).toBeTruthy()
    })

    it("streams tokens, rewrites attachment tags, and records metrics on done", async () => {
        const fetchMock: any = vi.fn(async () => streamResponse(sse(
            { token: "Hello " },
            "data: {not json\n",
            "ignored line\n",
            { token: "<tool:create_attachment component='Card' title='T'>body</tool:create_attachment>" },
            { done: true },
        )))
        vi.stubGlobal("fetch", fetchMock)
        const { result } = renderHook(() => useNativeAI() as any)
        await ready(result)
        await act(async () => { await result.current.generate({ messages }) })
        await waitFor(() => expect(result.current.metrics).not.toBeNull())
        await waitFor(() => expect(result.current.output).toContain("Hello "))
        expect(result.current.output).toContain("\u0000SATTACH:")
        expect(result.current.output).toContain('"component":"Card"')
        expect(result.current.streaming).toBe(false)
        expect(result.current.metrics).toMatchObject({ device: "native", totalTokens: 2 })
        expect(result.current.getSessionMetrics()).toMatchObject({ generationCount: 1, totalTokens: 2 })
        act(() => result.current.resetSessionMetrics())
        expect(result.current.getSessionMetrics()).toBeNull()
        expect(fetchMock.mock.calls[0][0]).toBe(STREAM_URL)
    })

    it("flushes pending output when the stream ends without a done event", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => streamResponse(sse({ token: "partial" }))))
        const { result } = renderHook(() => useNativeAI() as any)
        await ready(result)
        await act(async () => { await result.current.generate({ messages }) })
        expect(result.current.output).toBe("partial")
        expect(result.current.streaming).toBe(false)
    })

    it("surfaces an error event from the stream with its registry code", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => streamResponse(sse({ error: "model crashed", code: ERROR_CODES.AI_NATIVE_REQUEST_FAILED }))))
        const { result } = renderHook(() => useNativeAI() as any)
        await ready(result)
        let out: any
        await act(async () => { out = await result.current.generate({ messages }) })
        expect(out.error.message).toBe("model crashed")
        expect(out.error.code).toBe(ERROR_CODES.AI_NATIVE_REQUEST_FAILED)
        expect(result.current.loading).toBe(false)
    })

    it("turns an HTTP failure into a coded error using the JSON body, or the status when it is not JSON", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "busy", code: ERROR_CODES.AI_NATIVE_REQUEST_FAILED }, 503)))
        const { result } = renderHook(() => useNativeAI() as any)
        await ready(result)
        let out: any
        await act(async () => { out = await result.current.generate({ messages }) })
        expect(out.error.message).toBe("busy")
        vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })))
        await act(async () => { out = await result.current.generate({ messages }) })
        expect(out.error.message).toBe("Native AI HTTP error: 502")
    })

    it("non-streaming: posts to /ai/generate, sets output and metrics, and reuses the conversation id when stateful", async () => {
        const fetchMock: any = vi.fn(async () => jsonResponse({ output: "done", tokenCount: 4, conversationId: "c1" }))
        vi.stubGlobal("fetch", fetchMock)
        const { result } = renderHook(() => useNativeAI({ sessionMode: "stateful" }))
        await ready(result)
        let out: any
        await act(async () => { out = await result.current.generate({ messages, genConfig: { stream: false } }) })
        expect(out).toEqual({ output: "done", error: null })
        expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:9/ai/generate")
        expect(result.current.metrics).toMatchObject({ device: "native", totalTokens: 4 })
        expect(result.current.conversationId).toBe("c1")
        await act(async () => { await result.current.generate({ messages, genConfig: { stream: false } }) })
        expect(JSON.parse((fetchMock.mock.calls[1] as any)[1].body).conversationId).toBe("c1")
    })

    it("non-streaming: reports an error field in the JSON body and an HTTP failure", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "no memory" })))
        const { result } = renderHook(() => useNativeAI() as any)
        await ready(result)
        let out: any
        await act(async () => { out = await result.current.generate({ messages, genConfig: { stream: false } }) })
        expect(out.error.message).toBe("no memory")
        vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)))
        await act(async () => { out = await result.current.generate({ messages, genConfig: { stream: false } }) })
        expect(out.error.message).toBe("Native AI HTTP error: 500")
    })

    it("ignores an aborted request instead of reporting it", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }) }))
        const { result } = renderHook(() => useNativeAI() as any)
        await ready(result)
        let out: any
        await act(async () => { out = await result.current.generate({ messages }) })
        expect(out.error).toBeNull()
    })
})

describe("useNativeAI cancel and reset", () => {
    it("cancel() aborts an in-flight request and stops streaming", async () => {
        let signal: AbortSignal | undefined
        vi.stubGlobal("fetch", vi.fn((_u: string, init: any) => new Promise((_res, rej) => {
            signal = init.signal
            init.signal.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" })))
        })))
        const { result } = renderHook(() => useNativeAI() as any)
        await ready(result)
        let pending: Promise<any> = Promise.resolve()
        act(() => { pending = result.current.generate({ messages }) })
        await waitFor(() => expect(signal).toBeDefined())
        act(() => result.current.cancel())
        await act(async () => { await pending })
        expect(signal!.aborted).toBe(true)
        expect(result.current.streaming).toBe(false)
    })

    it("reset() clears output, error, metrics and the native conversation", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ output: "x", tokenCount: 1, conversationId: "c" })))
        const { result } = renderHook(() => useNativeAI({ sessionMode: "stateful" }))
        await ready(result)
        await act(async () => { await result.current.generate({ messages, genConfig: { stream: false } }) })
        act(() => result.current.reset())
        expect(transport.clearNativeConversation).toHaveBeenCalled()
        expect(result.current).toMatchObject({ output: "", error: null, metrics: null, conversationId: null })
    })

    it("unmounting aborts a request that is still running", async () => {
        let signal: AbortSignal | undefined
        vi.stubGlobal("fetch", vi.fn((_u: string, init: any) => new Promise(() => { signal = init.signal })))
        const { result, unmount } = renderHook(() => useNativeAI() as any)
        await ready(result)
        act(() => { void result.current.generate({ messages }) })
        await waitFor(() => expect(signal).toBeDefined())
        unmount()
        expect(signal!.aborted).toBe(true)
    })
})

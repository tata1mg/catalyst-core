// @vitest-environment jsdom
// useCloudAI against a faked fetch: streaming (SSE) and non-streaming generation, usage/metrics, stateful sessions,
// HTTP failures, cancellation and the session metrics helpers. Media consent has its own file (useCloudAI.media).
import { renderHook, act, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useCloudAI } from "../src/useCloudAI.js"

const messages = [{ role: "user", content: "hi" }]
const sse = (...events: any[]) => events.map((e) => (typeof e === "string" ? e : `data: ${JSON.stringify(e)}\n`)).join("")
const streamResponse = (text: string) => {
    const bytes = new TextEncoder().encode(text)
    return new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.close() } }), { status: 200 })
}
const jsonResponse = (body: any, status = 200) => new Response(JSON.stringify(body), { status })
const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }

afterEach(() => vi.unstubAllGlobals())

const gen = async (hook: any, args: any = {}) => {
    let out: any
    await act(async () => { out = await hook.result.current.generate({ messages, ...args }) })
    return out
}

describe("useCloudAI streaming", () => {
    it("streams tokens to the output, rewrites attachment tags and records usage metrics on [DONE]", async () => {
        const fetchMock: any = vi.fn(async () => streamResponse(sse(
            "event: ping\n",
            { token: "Hello " },
            "data: {bad json\n",
            { token: "<tool:create_attachment component='Card' title='T'>body</tool:create_attachment>" },
            { usage },
            "data: [DONE]\n",
        )))
        vi.stubGlobal("fetch", fetchMock)
        const hook = renderHook(() => useCloudAI({ provider: "openai", model: "gpt-x", systemPrompt: "Be brief." }))
        const out = await gen(hook)
        await waitFor(() => expect(hook.result.current.metrics).not.toBeNull())
        expect(out.error).toBeNull()
        // The counts come from the provider's usage frame (10/5/15), not from counting the two token events.
        expect(hook.result.current.metrics).toMatchObject({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
        expect(hook.result.current.output).toContain("Hello ")
        expect(hook.result.current.output).toContain("\u0000SATTACH:")
        expect(hook.result.current.streaming).toBe(false)
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe("/ai/openai/stream")
        const body = JSON.parse(init.body)
        expect(body.model).toBe("gpt-x")
        expect(body.messages[0]).toMatchObject({ role: "system" }) // the system prompt is prepended
        expect(hook.result.current.getSessionMetrics()).toMatchObject({ generationCount: 1 })
        act(() => hook.result.current.resetSessionMetrics())
        expect(hook.result.current.getSessionMetrics()).toBeNull()
    })

    it("falls back to token-count metrics when no usage frame arrives, and finalizes a stream that ends without [DONE]", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => streamResponse(sse({ token: "a" }, { token: "b" }))))
        const hook = renderHook(() => useCloudAI())
        await gen(hook)
        await waitFor(() => expect(hook.result.current.metrics).not.toBeNull())
        expect(hook.result.current.output).toBe("ab")
        expect(hook.result.current.metrics).toMatchObject({ provider: "openai", completionTokens: 2, totalTokens: 2, cost: null })
    })

    it("an error frame in the stream ends the generation with a coded error, not a short successful answer", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => streamResponse(sse({ token: "partial " }, { error: "Claude stream error", code: "AI-000" }))))
        const hook = renderHook(() => useCloudAI())
        const out = await gen(hook)
        expect(out.error).toBeTruthy()
        expect(out.error.message).toMatch(/Claude stream error/)
        expect(out.error.code).toBe("AI-000")
        expect(hook.result.current.streaming).toBe(false)
        expect(hook.result.current.metrics).toBeNull() // no metrics for a failed generation
    })

    it("an error frame with a code the registry does not know is reported as the upstream error", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => streamResponse(sse({ error: "boom", code: "NOT-A-CODE" }))))
        const hook = renderHook(() => useCloudAI())
        expect((await gen(hook)).error.code).toBe("AI-000")
    })

    it("sends and then reuses the conversation id in stateful mode", async () => {
        const fetchMock: any = vi.fn(async () => streamResponse(sse({ conversationId: "c9", token: "x" }, "data: [DONE]\n")))
        vi.stubGlobal("fetch", fetchMock)
        const hook = renderHook(() => useCloudAI({ sessionMode: "stateful" }))
        await gen(hook)
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).conversationId).toBeNull()
        expect(hook.result.current.conversationId).toBe("c9")
        await gen(hook)
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).conversationId).toBe("c9")
    })

    it("reports an HTTP failure with a truncated error body", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(800), { status: 500 })))
        const hook = renderHook(() => useCloudAI())
        const out = await gen(hook)
        expect(out.error.message).toMatch(/^HTTP error! Status: 500 — x{500}…$/)
        expect(hook.result.current.loading).toBe(false)
        expect(hook.result.current.streaming).toBe(false)
        act(() => hook.result.current.clearError())
        expect(hook.result.current.error).toBeNull()
    })

    it("reports a response with no body", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, body: null })))
        const hook = renderHook(() => useCloudAI())
        expect((await gen(hook)).error.message).toBe("Response has no body to stream")
    })

    it("ignores an aborted request", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }) }))
        const hook = renderHook(() => useCloudAI())
        expect((await gen(hook)).error).toBeNull()
    })
})

describe("useCloudAI non-streaming", () => {
    it("posts to /generate and records output, conversation id and usage metrics", async () => {
        const fetchMock: any = vi.fn(async () => jsonResponse({ output: "done", conversationId: "c1", usage }))
        vi.stubGlobal("fetch", fetchMock)
        const hook = renderHook(() => useCloudAI({ provider: "gemini", sessionMode: "stateful", model: "m" }))
        const out = await gen(hook, { genConfig: { stream: false } })
        expect(out).toEqual({ output: "done", error: null })
        expect(fetchMock.mock.calls[0][0]).toBe("/ai/gemini/generate")
        expect(hook.result.current.conversationId).toBe("c1")
        expect(hook.result.current.metrics).not.toBeNull()
        expect(hook.result.current.getSessionMetrics()?.generationCount).toBe(1)
    })

    it("works without usage and reports an HTTP failure", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ output: "ok" })))
        const hook = renderHook(() => useCloudAI())
        expect((await gen(hook, { genConfig: { stream: false } })).output).toBe("ok")
        vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })))
        expect((await gen(hook, { genConfig: { stream: false } })).error.message).toBe("HTTP error! Status: 429")
    })
})

describe("useCloudAI cancel and reset", () => {
    it("cancel() aborts the in-flight request", async () => {
        let signal: AbortSignal | undefined
        vi.stubGlobal("fetch", vi.fn((_u: string, init: any) => new Promise((_res, rej) => {
            signal = init.signal
            init.signal.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" })))
        })))
        const hook = renderHook(() => useCloudAI())
        let pending: Promise<any> = Promise.resolve()
        act(() => { pending = hook.result.current.generate({ messages }) })
        await waitFor(() => expect(signal).toBeDefined())
        act(() => hook.result.current.cancel())
        await act(async () => { await pending })
        expect(signal!.aborted).toBe(true)
        expect(hook.result.current.loading).toBe(false)
    })

    it("reset() clears output, error, metrics and the conversation id", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ output: "x", conversationId: "c", usage })))
        const hook = renderHook(() => useCloudAI({ sessionMode: "stateful" }))
        await gen(hook, { genConfig: { stream: false } })
        act(() => hook.result.current.reset())
        expect(hook.result.current).toMatchObject({ output: "", error: null, metrics: null, conversationId: null, streaming: false, loading: false })
    })
})

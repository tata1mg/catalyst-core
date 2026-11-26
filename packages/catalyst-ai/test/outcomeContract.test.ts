// @vitest-environment jsdom
// What generate() resolves with: the whole text when the stream ends in a burst, and nothing at all when the call was cancelled.
import { renderHook, act } from "@testing-library/react"
import { useCloudAI } from "../src/useCloudAI.js"

const messages = [{ role: "user", content: "hi" }]
afterEach(() => vi.unstubAllGlobals())

/** An SSE response that sends the given text and then stays open (a model still talking). */
function openStream(text: string, signal?: AbortSignal) {
    const bytes = new TextEncoder().encode(text)
    return new Response(new ReadableStream({
        start(c) {
            c.enqueue(bytes)
            // a real fetch body errors when the request is aborted
            signal?.addEventListener("abort", () => { try { c.error(new DOMException("Aborted", "AbortError")) } catch { /* already closed */ } })
        },
    }), { status: 200 })
}

describe("a cancelled call resolves empty", () => {
    it("cloud: text that had already streamed in is not the cancelled call's result", async () => {
        vi.stubGlobal("fetch", vi.fn(async (_u: string, init: any) => {
            return openStream(`data: ${JSON.stringify({ token: "partial answer" })}\n`, init.signal)
        }))
        const hook = renderHook(() => useCloudAI({ provider: "openai", model: "m" }))
        let pending!: Promise<any>
        act(() => { pending = hook.result.current.generate({ messages }) })
        await vi.waitFor(() => expect(hook.result.current.output).toContain("partial answer"))
        act(() => hook.result.current.cancel())
        const result = await pending
        expect(result).toEqual({ output: "", error: null })
    })
})

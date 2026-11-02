// @vitest-environment jsdom
// The in-browser media model (Gemma 4, ~3.4 GB) is meant to stay loaded between calls. cancel() on an IDLE hook used to
// terminate that worker anyway, so every new scan (useVision cancels any older scan first) reloaded the whole model.
import { renderHook, act, waitFor } from "@testing-library/react"

const mod = import("../src/useWebAI.js")
const GEMMA = "onnx-community/gemma-4-E2B-it-ONNX"
const ask = [{ role: "user", content: "hi" }]

let instances: FakeWorker[] = []
class FakeWorker {
    onmessage: ((e: { data: any }) => void) | null = null
    onerror: ((e: any) => void) | null = null
    terminated = false
    generations = 0
    static autoFinish = true
    constructor() { instances.push(this) }
    emit(data: any) { if (!this.terminated) this.onmessage?.({ data }) }
    postMessage(msg: any) {
        if (msg.type !== "generate") return
        this.generations++
        this.emit({ type: "model_ready", device: "webgpu", dtype: "q4f16", loadMs: 5 })
        this.emit({ type: "streaming_start" })
        if (FakeWorker.autoFinish) {
            this.emit({ type: "token", text: "ok" })
            this.emit({ type: "done", tps: 10, totalTokens: 1, genMs: 5 })
        }
    }
    terminate() { this.terminated = true }
}

describe("useWebAI keeps the media model loaded", () => {
    beforeEach(() => {
        instances = []
        FakeWorker.autoFinish = true
        vi.stubGlobal("Worker", FakeWorker)
        vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:fake" }))
    })
    afterEach(() => vi.unstubAllGlobals())

    it("a second generate reuses the worker", async () => {
        const { useWebAI } = await mod
        const { result } = renderHook(() => useWebAI({ model: GEMMA }))
        await act(async () => { await result.current.generate({ messages: ask }) })
        await act(async () => { await result.current.generate({ messages: ask }) })
        expect(instances).toHaveLength(1)
        expect(instances[0].generations).toBe(2)
    })

    it("cancel() while idle does not throw the loaded model away (useVision calls it before every scan)", async () => {
        const { useWebAI } = await mod
        const { result } = renderHook(() => useWebAI({ model: GEMMA }))
        await act(async () => { await result.current.generate({ messages: ask }) })
        act(() => result.current.cancel())
        expect(instances[0].terminated).toBe(false)
        await act(async () => { await result.current.generate({ messages: ask }) })
        expect(instances).toHaveLength(1) // no second worker, so no second model load
        expect(instances[0].generations).toBe(2)
    })

    it("cancel() during a generation still stops it (the worker is terminated, the next call starts a new one)", async () => {
        const { useWebAI } = await mod
        FakeWorker.autoFinish = false
        const { result } = renderHook(() => useWebAI({ model: GEMMA }))
        let pending: Promise<any>
        act(() => { pending = result.current.generate({ messages: ask }) })
        await waitFor(() => expect(instances).toHaveLength(1)) // the worker exists and is generating
        act(() => result.current.cancel())
        await act(async () => { await pending })
        expect(instances[0].terminated).toBe(true)
        FakeWorker.autoFinish = true
        await act(async () => { await result.current.generate({ messages: ask }) })
        expect(instances).toHaveLength(2)
    })

    it("a text-only model has no worker to keep: it is released after each call as before", async () => {
        const { useWebAI } = await mod
        const { result } = renderHook(() => useWebAI({ model: "onnx-community/Qwen2.5-0.5B-Instruct" }))
        await act(async () => { await result.current.generate({ messages: ask }) })
        expect(instances[0].terminated).toBe(true)
    })
})

// @vitest-environment jsdom
// The page's connection state reaches the worker, and the worker's download status reaches the hook result.
import { renderHook, act } from "@testing-library/react"

const webMod = import("../src/useWebAI.js")
const msgs = [{ role: "user", content: "hi" }]
const MODEL = "onnx-community/Qwen2.5-0.5B-Instruct"

class FakeWorker {
    static last: FakeWorker
    sent: any[] = []
    onmessage: ((e: any) => void) | null = null
    onerror: ((e: any) => void) | null = null
    constructor() { FakeWorker.last = this }
    postMessage(m: any) { this.sent.push(m) }
    terminate() {}
    emit(data: any) { this.onmessage?.({ data }) }
}

describe("useWebAI download plumbing", () => {
    beforeEach(() => {
        vi.stubGlobal("Worker", FakeWorker)
        vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:fake" }))
    })
    afterEach(() => vi.unstubAllGlobals())

    const start = async (result: any) => {
        await act(async () => { void result.current.generate({ messages: msgs }); await Promise.resolve() })
    }

    it("configures the worker with the policy and the page's online state before it loads anything", async () => {
        const { useWebAI } = await webMod
        const policy = { minBytesPerSec: 80000, windowSec: 10 }
        const { result } = renderHook(() => useWebAI({ model: MODEL, network: { online: false }, download: policy } as any))
        await start(result)
        expect(FakeWorker.last.sent[0]).toEqual({ type: "configure", policy, online: false })
        expect(FakeWorker.last.sent[1]).toMatchObject({ type: "generate", model: MODEL })
    })

    it("forwards online/offline changes to the worker while a model is loading", async () => {
        const { useWebAI } = await webMod
        const { result, rerender } = renderHook((p: { online: boolean }) => useWebAI({ model: MODEL, network: { online: p.online } } as any), { initialProps: { online: true } })
        await start(result)
        const worker = FakeWorker.last
        rerender({ online: false })
        rerender({ online: true })
        expect(worker.sent.filter((m) => m.type === "network")).toEqual([{ type: "network", online: false }, { type: "network", online: true }])
    })

    it("does nothing network-wise when the caller does not track it", async () => {
        const { useWebAI } = await webMod
        const { result } = renderHook(() => useWebAI({ model: MODEL } as any))
        await start(result)
        expect(FakeWorker.last.sent.some((m) => m.type === "network")).toBe(false)
        expect(FakeWorker.last.sent[0].online).toBeUndefined()
    })

    it("downloadPaused follows the worker's per-file status, with the reason", async () => {
        const { useWebAI } = await webMod
        const { result } = renderHook(() => useWebAI({ model: MODEL } as any))
        await start(result)
        expect(result.current.downloadPaused).toBe(false)
        expect(result.current.downloadPauseReason).toBeNull()
        await act(async () => { FakeWorker.last.emit({ type: "download_status", file: "onnx/model.onnx", state: "paused", reason: "offline", retryInSec: null }) })
        expect(result.current.downloadPaused).toBe(true)
        expect(result.current.downloadPauseReason).toBe("offline")
        await act(async () => { FakeWorker.last.emit({ type: "download_status", file: "onnx/other.onnx", state: "paused", reason: "weak", retryInSec: 5 }) })
        await act(async () => { FakeWorker.last.emit({ type: "download_status", file: "onnx/model.onnx", state: "resuming" }) })
        expect(result.current.downloadPaused).toBe(true) // the other file still waits
        await act(async () => { FakeWorker.last.emit({ type: "download_status", file: "onnx/other.onnx", state: "done" }) })
        expect(result.current.downloadPaused).toBe(false)
    })

    it("a new generate starts with a clean status", async () => {
        const { useWebAI } = await webMod
        const { result } = renderHook(() => useWebAI({ model: MODEL } as any))
        await start(result)
        await act(async () => { FakeWorker.last.emit({ type: "download_status", file: "a", state: "paused", reason: "error" }) })
        expect(result.current.downloadPaused).toBe(true)
        await act(async () => { FakeWorker.last.emit({ type: "error", message: "boom" }) })
        await start(result)
        expect(result.current.downloadPaused).toBe(false)
    })
})

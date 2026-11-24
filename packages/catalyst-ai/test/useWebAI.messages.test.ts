// @vitest-environment jsdom
// useWebAI's reaction to every worker message type, worker failures, stateful sessions, reset/unload, session metrics
// and the network relay. The worker is a fake the test drives by hand.
import { renderHook, act } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const prep = vi.hoisted(() => ({ gate: null as null | Promise<void> }))
vi.mock("../src/imagePrep.js", () => ({
    MAX_IMAGE_SIDE: 1536,
    RECODE_ABOVE_BYTES: 1024 * 1024,
    fitWithin: (w: number, h: number) => ({ width: w, height: h, scaled: false }),
    prepareImageParts: async (messages: any) => {
        if (prep.gate) await prep.gate
        return messages
    },
}))

import { useWebAI } from "../src/useWebAI.js"

const TEXT_MODEL = "onnx-community/Qwen2.5-0.5B-Instruct"
const GEMMA = "onnx-community/gemma-4-E2B-it-ONNX"
const ask = [{ role: "user", content: "hi" }]

/** Gives URL.createObjectURL/revokeObjectURL fakes and returns a function that puts the originals back exactly. */
function fakeObjectUrls(url: string) {
    const saved = ["createObjectURL", "revokeObjectURL"].map((name) => [name, Object.getOwnPropertyDescriptor(URL, name)] as const)
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: () => url })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: () => {} })
    return () => {
        for (const [name, descriptor] of saved) {
            if (descriptor) Object.defineProperty(URL, name, descriptor)
            else delete (URL as any)[name]
        }
    }
}
let restoreUrls: () => void = () => {}

let workers: FakeWorker[] = []
let failConstruct = false
class FakeWorker {
    onmessage: ((e: { data: any }) => void) | null = null
    onerror: ((e: any) => void) | null = null
    terminated = false
    sent: any[] = []
    constructor() {
        if (failConstruct) throw new Error("no workers here")
        workers.push(this)
    }
    postMessage(msg: any) { this.sent.push(msg) }
    emit(data: any) { this.onmessage?.({ data }) }
    terminate() { this.terminated = true }
}

beforeEach(() => {
    workers = []
    failConstruct = false
    vi.stubGlobal("Worker", FakeWorker)
    restoreUrls = fakeObjectUrls("blob:fake")
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
    restoreUrls()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

const generateCount = (w: FakeWorker) => w.sent.filter((m: any) => m.type === "generate").length

/** Starts a generation and returns the pending promise plus the worker whose "generate" request count went up. */
async function start(hook: any, args: any = {}) {
    const before = new Map(workers.map((w) => [w, generateCount(w)] as const))
    let pending: Promise<any> = Promise.resolve()
    act(() => { pending = hook.result.current.generate({ messages: ask, ...args }) })
    let worker!: FakeWorker
    await vi.waitFor(() => {
        const found = workers.find((w) => generateCount(w) > (before.get(w) ?? 0))
        expect(found).toBeDefined()
        worker = found!
    })
    return { pending, worker }
}
const finish = (worker: FakeWorker, text = "ok", extra: any = {}) => {
    worker.emit({ type: "model_ready", device: "webgpu", dtype: "q4", loadMs: 5, totalBytes: 100 })
    worker.emit({ type: "streaming_start" })
    worker.emit({ type: "token", text })
    worker.emit({ type: "done", tps: 10, totalTokens: 3, genMs: 30, ...extra })
}

describe("useWebAI worker messages", () => {
    it("tracks log, per-file status, progress, ttft and the final metrics, then terminates a text-model worker", async () => {
        const hook = renderHook(() => useWebAI({ model: TEXT_MODEL }))
        const { pending, worker } = await start(hook)
        expect(worker.sent[0]).toMatchObject({ type: "configure" })
        act(() => {
            worker.emit({ type: "log", msg: "[worker] gemma inputs: 1 image" })
            worker.emit({ type: "download_status", file: "a.onnx", state: "paused", reason: "offline", retryInSec: 5 })
            worker.emit({ type: "progress", file: "a.onnx", percent: 40, status: "progress", total: 500 })
            worker.emit({ type: "ttft", ms: 120 })
        })
        expect(hook.result.current.inputInfo).toBe("gemma inputs: 1 image")
        expect(hook.result.current.downloadPaused).toBe(true)
        expect(hook.result.current.downloadPauseReason).toBe("offline")
        expect(hook.result.current.downloadProgress).toMatchObject({ percent: 40 })
        await act(async () => { finish(worker, "hello", { promptTokens: 7 }); await pending })
        expect(hook.result.current.output).toBe("hello")
        expect(hook.result.current.metrics).toMatchObject({ device: "webgpu", dtype: "q4", ttftMs: 120, tps: 10, totalTokens: 3, downloadBytes: 100 })
        expect((hook.result.current.metrics as any)?.cloudEquivalent).not.toBeNull()
        expect(hook.result.current.modelReady).toBe(true)
        expect(worker.terminated).toBe(true) // text models free their worker after each answer
        expect(hook.result.current.getSessionMetrics()).toMatchObject({ generationCount: 1, device: "webgpu" })
        act(() => hook.result.current.resetSessionMetrics())
        expect(hook.result.current.getSessionMetrics()).toBeNull()
    })

    it("turns a worker 'error' message into a coded error and settles the call", async () => {
        const hook = renderHook(() => useWebAI({ model: TEXT_MODEL }))
        const { pending, worker } = await start(hook)
        await act(async () => { worker.emit({ type: "error", message: "out of memory" }); await pending })
        expect((hook.result.current.error as any)?.message).toBe("out of memory")
        expect(hook.result.current.loading).toBe(false)
        expect(worker.terminated).toBe(true)
        act(() => hook.result.current.clearError())
        expect(hook.result.current.error).toBeNull()
    })

    it("turns an uncaught worker error into a coded error", async () => {
        const hook = renderHook(() => useWebAI({ model: TEXT_MODEL }))
        const { pending, worker } = await start(hook)
        await act(async () => { worker.onerror?.({ message: "boom" }); await pending })
        expect((hook.result.current.error as any)?.message).toBe("boom")
        expect(worker.terminated).toBe(true)
    })

    it("falls back to a generic message when the uncaught error has none", async () => {
        const hook = renderHook(() => useWebAI({ model: TEXT_MODEL }))
        const { pending, worker } = await start(hook)
        await act(async () => { worker.onerror?.({}); await pending })
        expect((hook.result.current.error as any)?.message).toBe("Worker crashed")
    })

    it("reports when a worker cannot be created", async () => {
        failConstruct = true
        const hook = renderHook(() => useWebAI({ model: TEXT_MODEL }))
        let out: any
        await act(async () => { out = await hook.result.current.generate({ messages: ask }) })
        expect(out.error ?? hook.result.current.error).toBeTruthy()
        expect(hook.result.current.loading).toBe(false)
    })

    it("refuses an audio-only model when no audio is attached", async () => {
        const hook = renderHook(() => useWebAI({ model: "onnx-community/whisper-tiny" }))
        let out: any
        await act(async () => { out = await hook.result.current.generate({ messages: ask }) })
        expect((hook.result.current.error as any)?.message ?? out.error?.message).toMatch(/attach an audio clip|speech-to-text/)
    })
})

describe("useWebAI sessions and lifecycle", () => {
    it("stateful mode assigns a conversation id and replays history on the next call", async () => {
        const hook = renderHook(() => useWebAI({ model: TEXT_MODEL, sessionMode: "stateful" }))
        const first = await start(hook)
        await act(async () => { finish(first.worker, "first"); await first.pending })
        expect(hook.result.current.conversationId).toMatch(/.+/)
        const second = await start(hook, { messages: [{ role: "user", content: "again" }] })
        const gen = second.worker.sent.find((m: any) => m.type === "generate")
        expect(JSON.stringify(gen.messages)).toContain("first")
        await act(async () => { finish(second.worker, "second"); await second.pending })
    })

    it("reset() terminates the worker, clears state and the conversation", async () => {
        const hook = renderHook(() => useWebAI({ model: GEMMA, sessionMode: "stateful" }))
        const { pending, worker } = await start(hook)
        await act(async () => { finish(worker); await pending })
        act(() => hook.result.current.reset())
        expect(worker.terminated).toBe(true)
        expect(hook.result.current).toMatchObject({ output: "", error: null, metrics: null, modelReady: false, conversationId: null })
    })

    it("cancel() on a running generation terminates its worker and settles the call", async () => {
        const hook = renderHook(() => useWebAI({ model: GEMMA }))
        const { pending, worker } = await start(hook)
        await act(async () => { hook.result.current.cancel(); await pending })
        expect(worker.terminated).toBe(true)
        expect(hook.result.current.streaming).toBe(false)
    })

    it("unload() on a running generation stops it and frees the worker", async () => {
        const hook = renderHook(() => useWebAI({ model: GEMMA }))
        const { pending, worker } = await start(hook)
        await act(async () => { hook.result.current.unload(); await pending })
        expect(worker.terminated).toBe(true)
        expect(hook.result.current.modelReady).toBe(false)
    })

    it("relays the page's online state to a live worker", async () => {
        let online = true
        const hook = renderHook(() => useWebAI({ model: GEMMA, network: { online } }))
        const { pending, worker } = await start(hook)
        online = false
        hook.rerender()
        expect(worker.sent.some((m: any) => m.type === "network" && m.online === false)).toBe(true)
        await act(async () => { finish(worker); await pending })
    })

    it("passes the download policy to the worker's configure message", async () => {
        const hook = renderHook(() => useWebAI({ model: GEMMA, download: { windowSec: 7 } }))
        const { pending, worker } = await start(hook)
        expect(worker.sent[0]).toMatchObject({ type: "configure", policy: { windowSec: 7 } })
        await act(async () => { finish(worker); await pending })
    })
})

describe("useWebAI abandoned runs and stale download state", () => {
    const withImage = [{ role: "user", content: [{ type: "text", text: "what is this?" }, { type: "image", data: "data:image/png;base64,iVBORw0KGgo=" }] }]
    afterEach(() => { prep.gate = null })

    it("cancel() while the image is still being prepared: no worker is created and no request is posted", async () => {
        let open!: () => void
        prep.gate = new Promise<void>((resolve) => { open = resolve })
        const hook = renderHook(() => useWebAI({ model: GEMMA }))
        let pending: Promise<any> = Promise.resolve()
        act(() => { pending = hook.result.current.generate({ messages: withImage }) })
        act(() => hook.result.current.cancel())
        await act(async () => { open(); await pending })
        expect(workers).toHaveLength(0)
    })

    it("a newer generate() supersedes one that is still preparing: only the newer one starts a worker", async () => {
        let open!: () => void
        prep.gate = new Promise<void>((resolve) => { open = resolve })
        const hook = renderHook(() => useWebAI({ model: GEMMA }))
        let first: Promise<any> = Promise.resolve()
        let second: Promise<any> = Promise.resolve()
        act(() => { first = hook.result.current.generate({ messages: withImage }) })
        act(() => { second = hook.result.current.generate({ messages: withImage }) })
        await act(async () => { open(); await vi.waitFor(() => expect(workers.length).toBeGreaterThan(0)) })
        expect(workers).toHaveLength(1)
        const worker = workers[0]
        await act(async () => { finish(worker); await Promise.all([first, second]) })
    })

    it("unload() and reset() while preparing also stop the run", async () => {
        for (const stop of ["unload", "reset"] as const) {
            let open!: () => void
            prep.gate = new Promise<void>((resolve) => { open = resolve })
            const before = workers.length
            const hook = renderHook(() => useWebAI({ model: GEMMA }))
            let pending: Promise<any> = Promise.resolve()
            act(() => { pending = hook.result.current.generate({ messages: withImage }) })
            act(() => (hook.result.current as any)[stop]())
            await act(async () => { open(); await pending })
            expect(workers).toHaveLength(before)
            hook.unmount()
        }
    })

    it("cancel(), reset() and a worker error clear the paused-download state that no worker is left to update", async () => {
        const pausedThen = async (end: (h: any, w: FakeWorker) => Promise<void> | void) => {
            const hook = renderHook(() => useWebAI({ model: TEXT_MODEL }))
            const { pending, worker } = await start(hook)
            act(() => worker.emit({ type: "download_status", file: "a.onnx", state: "paused", reason: "offline", retryInSec: 5 }))
            expect(hook.result.current.downloadPaused).toBe(true)
            await act(async () => { await end(hook, worker); await pending })
            expect(hook.result.current.downloadPaused).toBe(false)
            expect(hook.result.current.downloadPauseReason).toBeNull()
            hook.unmount()
        }
        await pausedThen((h) => h.result.current.cancel())
        await pausedThen((h) => h.result.current.reset())
        await pausedThen((_h, w) => w.emit({ type: "error", message: "crashed" }))
        await pausedThen((_h, w) => w.onerror?.({ message: "boom" }))
    })

    it("a late download_status from a worker that was already terminated is ignored", async () => {
        const hook = renderHook(() => useWebAI({ model: TEXT_MODEL }))
        const { pending, worker } = await start(hook)
        await act(async () => { hook.result.current.cancel(); await pending })
        act(() => worker.emit({ type: "download_status", file: "a.onnx", state: "paused", reason: "offline", retryInSec: 5 }))
        expect(hook.result.current.downloadPaused).toBe(false)
    })
})

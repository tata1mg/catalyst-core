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
    static reply = "ok"
    constructor() { instances.push(this) }
    emit(data: any) { if (!this.terminated) this.onmessage?.({ data }) }
    sent: any[] = []
    postMessage(msg: any) {
        if (msg.type !== "generate") return
        this.sent.push(msg)
        this.generations++
        this.emit({ type: "model_ready", device: "webgpu", dtype: "q4f16", loadMs: 5 })
        this.emit({ type: "streaming_start" })
        if (FakeWorker.autoFinish) {
            this.emit({ type: "token", text: FakeWorker.reply })
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

describe("useWebAI applies systemPrompt and attachmentComponents like the cloud and native hooks", () => {
    beforeEach(() => {
        instances = []
        FakeWorker.autoFinish = true
        vi.stubGlobal("Worker", FakeWorker)
        vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:fake" }))
    })
    afterEach(() => vi.unstubAllGlobals())

    it("puts the protocol first for the model, on the text path", async () => {
        const { useWebAI } = await mod
        const options = { model: "onnx-community/Qwen2.5-0.5B-Instruct", systemPrompt: "Be brief.", attachmentComponents: { Header: { hint: "title" } } }
        const { result } = renderHook(() => useWebAI(options))
        await act(async () => { await result.current.generate({ messages: ask }) })
        const sent = instances[0].sent[0].messages
        expect(sent[0].role).toBe("system")
        expect(sent[0].content).toContain("Be brief.")
        expect(sent[0].content).toContain("create_attachment")
        expect(sent[1]).toEqual(ask[0])
    })

    it("puts it first on the media path too, and the user turn keeps its place", async () => {
        const { useWebAI } = await mod
        const { result } = renderHook(() => useWebAI({ model: GEMMA, systemPrompt: "Transcribe." }))
        await act(async () => { await result.current.generate({ messages: ask }) })
        const sent = instances[0].sent[0].messages
        expect(sent.map((m: any) => m.role)).toEqual(["system", "user"])
        expect(sent[0].content).toBe("Transcribe.") // a string: the chat template trims it, which fails on an array of parts
    })

    it("sends messages untouched when there is no systemPrompt or components", async () => {
        const { useWebAI } = await mod
        const { result } = renderHook(() => useWebAI({ model: "onnx-community/Qwen2.5-0.5B-Instruct" }))
        await act(async () => { await result.current.generate({ messages: ask }) })
        expect(instances[0].sent[0].messages).toEqual(ask)
    })

    it("does not add a second system message when the caller already supplied one", async () => {
        const { useWebAI } = await mod
        const own = [{ role: "system", content: "mine" }, ...ask]
        const { result } = renderHook(() => useWebAI({ model: "onnx-community/Qwen2.5-0.5B-Instruct", systemPrompt: "Be brief." }))
        await act(async () => { await result.current.generate({ messages: own }) })
        expect(instances[0].sent[0].messages).toEqual(own)
    })
})

describe("useWebAI turns attachment tags into renderable sentinels", () => {
    const TAG = "<tool:create_attachment component='Header' level='2'>Lab results</tool:create_attachment>"
    beforeEach(() => {
        instances = []
        FakeWorker.autoFinish = true
        FakeWorker.reply = `${TAG}\nplain`
        vi.stubGlobal("Worker", FakeWorker)
        vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:fake" }))
    })
    afterEach(() => { FakeWorker.reply = "ok"; vi.unstubAllGlobals() })

    it("converts a complete tag when attachmentComponents were requested", async () => {
        const { useWebAI } = await mod
        const { result } = renderHook(() => useWebAI({ model: "onnx-community/Qwen2.5-0.5B-Instruct", attachmentComponents: { Header: {} } }))
        await act(async () => { await result.current.generate({ messages: ask }) })
        const out = result.current.output
        expect(out).not.toContain("<tool:create_attachment")
        const json = /\x00SATTACH:([\s\S]*?)\x00/.exec(out)![1]
        expect(JSON.parse(json)).toEqual({ component: "Header", attrs: { level: "2" }, body: "Lab results" })
        expect(out).toContain("plain")
    })

    it("leaves the text alone when no attachmentComponents were requested (useVision and other callers)", async () => {
        const { useWebAI } = await mod
        const { result } = renderHook(() => useWebAI({ model: "onnx-community/Qwen2.5-0.5B-Instruct" }))
        await act(async () => { await result.current.generate({ messages: ask }) })
        expect(result.current.output).toContain("<tool:create_attachment")
    })
})

describe("useWebAI runs speech-to-text models (Whisper, Moonshine)", () => {
    const WHISPER = "onnx-community/whisper-base"
    // 44-byte WAV header with no samples: enough to be a well-formed audio data URL.
    const WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA="
    const clip = [{ role: "user", content: [{ type: "audio", data: WAV }, { type: "text", text: "Describe audio" }] }]
    beforeEach(() => {
        instances = []
        FakeWorker.autoFinish = true
        vi.stubGlobal("Worker", FakeWorker)
        vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:fake" }))
    })
    afterEach(() => vi.unstubAllGlobals())

    it("sends the clip, adds no system prompt, and keeps the worker loaded for the next clip", async () => {
        const { useWebAI } = await mod
        const { result } = renderHook(() => useWebAI({ model: WHISPER, systemPrompt: "Be brief.", attachmentComponents: { Header: {} } }))
        await act(async () => { await result.current.generate({ messages: clip }) })
        const sent = instances[0].sent[0]
        expect(sent.media.audios).toHaveLength(1)
        expect(sent.messages.map((m: any) => m.role)).toEqual(["user"])
        expect(instances[0].terminated).toBe(false)
        await act(async () => { await result.current.generate({ messages: clip }) })
        expect(instances).toHaveLength(1)
        expect(instances[0].generations).toBe(2)
    })

    it("refuses an image, and a request with no audio, before starting a worker", async () => {
        const { useWebAI } = await mod
        const { result } = renderHook(() => useWebAI({ model: WHISPER }))
        await act(async () => { await result.current.generate({ messages: ask }) })
        expect(result.current.error?.message).toMatch(/attach an audio clip/)
        const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        await act(async () => { await result.current.generate({ messages: [{ role: "user", content: [{ type: "image", data: png }, { type: "text", text: "x" }] }] }) })
        expect(result.current.error?.message).toMatch(/does not support image/)
        expect(instances).toHaveLength(0)
    })
})

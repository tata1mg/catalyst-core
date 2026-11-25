// @vitest-environment jsdom
// How useWebAI treats media before it reaches the worker: judged against the right limits, refused cheaply when it cannot be taken,
// never passed on unconverted when the worker could not read it, and kept out of a stateful chat's history.
import { renderHook, act } from "@testing-library/react"

const web = import("../src/useWebAI.js")
const parts = import("../src/contentParts.js")
const prep = import("../src/audioPrep.js")
const GEMMA = "onnx-community/gemma-4-E2B-it-ONNX"

let instances: FakeWorker[] = []
class FakeWorker {
    onmessage: ((e: { data: any }) => void) | null = null
    onerror: ((e: any) => void) | null = null
    sent: any[] = []
    terminated = false
    constructor() { instances.push(this) }
    emit(data: any) { if (!this.terminated) this.onmessage?.({ data }) }
    postMessage(msg: any) {
        if (msg.type !== "generate") return
        this.sent.push(msg)
        this.emit({ type: "model_ready", device: "webgpu", dtype: "q4f16", loadMs: 5 })
        this.emit({ type: "streaming_start" })
        this.emit({ type: "token", text: "ok" })
        this.emit({ type: "done", tps: 10, totalTokens: 1, genMs: 5 })
    }
    terminate() { this.terminated = true }
}
const dataUrl = (mime: string, bytes: number) => `data:${mime};base64,${"A".repeat(Math.ceil((bytes * 4) / 3))}`
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
// 16 kHz, mono, 16-bit PCM WAV header with no samples
const WAV16K = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA="
const user = (content: unknown) => ({ role: "user", content })

beforeEach(() => {
    instances = []
    vi.stubGlobal("Worker", FakeWorker)
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:fake" }))
})
afterEach(() => vi.unstubAllGlobals())

describe("limits before and after preparation", () => {
    it("a raw photo is judged against the looser pre-preparation limit, the prepared one against the strict one", async () => {
        const { getModalities, PRE_PREP_LIMITS, DEFAULT_LIMITS } = await parts
        const big = [user([{ type: "image", data: dataUrl("image/jpeg", 12 * 1024 * 1024) }])] // over the 8 MiB final cap
        expect(() => getModalities(big)).toThrow(/too large/)
        expect([...getModalities(big, PRE_PREP_LIMITS)]).toEqual(["image"])
        const huge = [user([{ type: "image", data: dataUrl("image/jpeg", 40 * 1024 * 1024) }])]
        expect(() => getModalities(huge, PRE_PREP_LIMITS)).toThrow(/too large/) // still bounded
        expect(DEFAULT_LIMITS.imageBytes).toBeLessThan(PRE_PREP_LIMITS.imageBytes)
    })
})

describe("the in-browser media model", () => {
    it("refuses two images before decoding or resizing anything, and starts no worker", async () => {
        const { useWebAI } = await web
        const { result } = renderHook(() => useWebAI({ model: GEMMA }))
        await act(async () => { await result.current.generate({ messages: [user([{ type: "image", data: PNG }, { type: "image", data: PNG }, { type: "text", text: "compare" }])] }) })
        expect((result.current.error as any)?.message).toMatch(/one image per request/)
        expect(instances).toHaveLength(0)
    })

    it("does not pass on audio it could not convert: that is an input error, not a worker crash", async () => {
        const { useWebAI } = await web
        const { result } = renderHook(() => useWebAI({ model: GEMMA }))
        const mp4 = dataUrl("audio/mp4", 2000) // not a 16 kHz WAV, and this environment has no AudioContext to convert it
        await act(async () => { await result.current.generate({ messages: [user([{ type: "audio", data: mp4 }, { type: "text", text: "transcribe" }])] }) })
        expect((result.current.error as any)?.message).toMatch(/audio could not be converted/)
        expect(instances).toHaveLength(0)
    })

    it("audio that already is 16 kHz mono WAV goes through even where nothing could convert it", async () => {
        const { useWebAI } = await web
        const { result } = renderHook(() => useWebAI({ model: GEMMA }))
        await act(async () => { await result.current.generate({ messages: [user([{ type: "audio", data: WAV16K }, { type: "text", text: "transcribe" }])] }) })
        expect(result.current.error).toBeNull()
        expect(instances[0].sent[0].media.audios).toHaveLength(1)
    })

    it("a stateful chat on a media model keeps the earlier turns' words, so the model has the context", async () => {
        const { useWebAI } = await web
        const { result } = renderHook(() => useWebAI({ model: GEMMA, sessionMode: "stateful" }))
        await act(async () => { await result.current.generate({ messages: [user("my name is Asha")] }) })
        await act(async () => { await result.current.generate({ messages: [user("what is my name?")] }) })
        const secondTurn = JSON.stringify(instances[0].sent[1].messages)
        expect(secondTurn).toContain("my name is Asha")
        expect(secondTurn).toContain("what is my name?")
        expect(secondTurn).toContain("ok") // the assistant's earlier reply
    })
})

describe("isWorkerReadyWav", () => {
    it("accepts a 16 kHz mono 16-bit WAV and nothing else", async () => {
        const { isWorkerReadyWav } = await prep
        expect(isWorkerReadyWav(WAV16K)).toBe(true)
        expect(isWorkerReadyWav("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAIAgD4AAAB9AAACABAAZGF0YQAAAAA=")).toBe(false) // 2 channels
        expect(isWorkerReadyWav(dataUrl("audio/mp4", 200))).toBe(false)
        expect(isWorkerReadyWav("data:audio/wav;base64,@@@")).toBe(false)
        expect(isWorkerReadyWav(undefined as any)).toBe(false)
        expect(isWorkerReadyWav("not a data url")).toBe(false)
    })
})

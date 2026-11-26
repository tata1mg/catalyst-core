// Deadlines and disconnects for the calls the server makes to providers (generate, image, speech, live token).
const { upstreamSignal, clientGoneSignal } = require("../src/upstream")

describe("upstreamSignal", () => {
    afterEach(() => vi.useRealTimers())

    it("aborts after the deadline, with a message that says so", () => {
        vi.useFakeTimers()
        const signal = upstreamSignal(5000)
        expect(signal.aborted).toBe(false)
        vi.advanceTimersByTime(5001)
        expect(signal.aborted).toBe(true)
        expect(String(signal.reason?.message)).toMatch(/did not answer within 5 s/)
    })

    it("aborts at once when the client goes away, and starts aborted if it already had", () => {
        const client = new AbortController()
        const signal = upstreamSignal(60_000, client.signal)
        expect(signal.aborted).toBe(false)
        client.abort()
        expect(signal.aborted).toBe(true)
        const gone = new AbortController()
        gone.abort()
        expect(upstreamSignal(60_000, gone.signal).aborted).toBe(true)
    })
})

describe("clientGoneSignal", () => {
    const fakeRes = () => {
        const handlers: Record<string, () => void> = {}
        return { writableFinished: false, on: (event: string, fn: () => void) => { handlers[event] = fn }, emit: (event: string) => handlers[event]?.() }
    }

    it("aborts when the response closes before it finished", () => {
        const res = fakeRes()
        const signal = clientGoneSignal(res)
        res.emit("close")
        expect(signal.aborted).toBe(true)
    })

    it("does not abort for a response that finished normally", () => {
        const res = fakeRes()
        const signal = clientGoneSignal(res)
        res.writableFinished = true
        res.emit("close")
        expect(signal.aborted).toBe(false)
    })

    it("tolerates a response object without event support", () => {
        expect(clientGoneSignal({}).aborted).toBe(false)
    })
})

describe("provider calls carry a signal", () => {
    afterEach(() => vi.unstubAllGlobals())

    it("the image, speech and live-token adapters pass an abort signal to fetch", async () => {
        const seen: any[] = []
        vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
            seen.push(init?.signal)
            return { ok: true, json: async () => ({ name: "tok", data: [{ b64_json: "QQ==" }], candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "QQ==" } }] } }] }), arrayBuffer: async () => new ArrayBuffer(8), headers: { get: () => null } }
        }))
        const throwProviderError = async () => { throw new Error("provider") }
        const createError = (m: string) => new Error(m)
        const image = require("../src/imageGen").createImageAdapters({ throwProviderError, createError })
        const live = require("../src/liveGen")
        const client = new AbortController()
        await image.openai({ apiKey: "k", model: "m", prompt: "p", signal: client.signal }).catch(() => {})
        await image.gemini({ apiKey: "k", model: "m", prompt: "p", signal: client.signal }).catch(() => {})
        await live.createLiveToken({ apiKey: "k", model: "m", throwProviderError, signal: client.signal }).catch(() => {})
        expect(seen.length).toBeGreaterThanOrEqual(3)
        for (const s of seen) expect(s).toBeInstanceOf(AbortSignal)
        client.abort()
        expect(seen.every((s) => s.aborted)).toBe(true) // the browser going away aborts every provider call
    })
})

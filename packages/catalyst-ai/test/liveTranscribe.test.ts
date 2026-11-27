import { floatToPcm16, pcm16ToBase64, parseLiveMessage, audioMessage, requestLiveToken, startLiveTranscription } from "../src/liveTranscribe.js"

describe("audio helpers", () => {
    it("converts floats to clamped 16-bit PCM at 16 kHz (no resampling when already 16 kHz)", () => {
        const out = floatToPcm16(new Float32Array([0, 0.5, -0.5, 2, -2]), 16000)
        expect(Array.from(out)).toEqual([0, 16383, -16384, 32767, -32768])
    })

    it("resamples 48 kHz to a third of the samples", () => {
        expect(floatToPcm16(new Float32Array(4800), 48000).length).toBe(1600)
    })

    it("base64-encodes the little-endian bytes and builds the realtimeInput message", () => {
        expect(pcm16ToBase64(new Int16Array([1, 256]))).toBe(Buffer.from([1, 0, 0, 1]).toString("base64"))
        const msg = audioMessage(new Int16Array(2))
        expect(msg.realtimeInput.audio.mimeType).toBe("audio/pcm;rate=16000")
    })
})

describe("parseLiveMessage", () => {
    it("classifies server messages and survives garbage", () => {
        expect(parseLiveMessage(JSON.stringify({ setupComplete: {} })).kind).toBe("ready")
        expect(parseLiveMessage(JSON.stringify({ serverContent: { interimInputTranscription: { text: "Draw a" } } }))).toEqual({ kind: "partial", text: "Draw a" })
        expect(parseLiveMessage(JSON.stringify({ serverContent: { inputTranscription: { text: "Draw a boat." } } }))).toEqual({ kind: "final", text: "Draw a boat." })
        expect(parseLiveMessage(JSON.stringify({ serverContent: { turnComplete: true } })).kind).toBe("done")
        expect(parseLiveMessage(JSON.stringify({ goAway: { timeLeft: "5s" } })).kind).toBe("goAway")
        expect(parseLiveMessage("not json").kind).toBe("other")
        expect(parseLiveMessage(new TextEncoder().encode(JSON.stringify({ setupComplete: {} })).buffer).kind).toBe("ready")
    })
})

describe("requestLiveToken", () => {
    afterEach(() => vi.unstubAllGlobals())
    it("posts to /gemini/live-token and surfaces the server error", async () => {
        const f = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ token: "t", url: "wss://x", setup: {} }), { status: 200 }))
        vi.stubGlobal("fetch", f)
        expect((await requestLiveToken({ model: "m" })).token).toBe("t")
        expect(f.mock.calls[0][0]).toBe("/ai/gemini/live-token")
        expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ model: "m" })
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "no liveModel" }), { status: 400 })))
        await expect(requestLiveToken()).rejects.toThrow("no liveModel")
    })
})

class FakeSocket {
    static last: FakeSocket
    readyState = 0
    sent: any[] = []
    onopen: any
    onmessage: any
    onclose: any
    onerror: any
    url: string
    constructor(url: string) {
        this.url = url
        FakeSocket.last = this
        queueMicrotask(() => {
            this.readyState = 1
            this.onopen?.()
        })
    }
    send(d: string) {
        this.sent.push(JSON.parse(d))
    }
    close() {
        this.readyState = 3
    }
    serve(obj: unknown) {
        return this.onmessage?.({ data: JSON.stringify(obj) })
    }
}

describe("startLiveTranscription", () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.useRealTimers()
    })

    it("sends setup, streams 100 ms chunks, ends the stream and returns the joined final text", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "tok en", url: "wss://live", setup: { model: "models/m" } }), { status: 200 })))
        let push: (s: Float32Array, rate: number) => void = () => {}
        const partials: string[] = []
        const started = startLiveTranscription({
            WebSocketImpl: FakeSocket as any,
            openMic: async (cb: any) => {
                push = cb
                return () => {}
            },
            onPartial: (t: string) => partials.push(t),
        })
        await vi.waitFor(() => expect(FakeSocket.last?.sent.length).toBe(1))
        expect(FakeSocket.last.url).toBe("wss://live?access_token=tok%20en")
        expect(FakeSocket.last.sent[0]).toEqual({ setup: { model: "models/m" } })
        await FakeSocket.last.serve({ setupComplete: {} })
        const session = await started

        push(new Float32Array(2400), 16000) // 1.5 chunks: one full chunk goes out, the rest waits
        expect(FakeSocket.last.sent.filter((m) => m.realtimeInput?.audio).length).toBe(1)
        await FakeSocket.last.serve({ serverContent: { interimInputTranscription: { text: "Draw a" } } })
        expect(partials).toEqual(["Draw a"])

        const finished = session.stop()
        const sent = FakeSocket.last.sent
        expect(sent.at(-1)).toEqual({ realtimeInput: { audioStreamEnd: true } })
        expect(sent.filter((m) => m.realtimeInput?.audio).length).toBe(2) // the leftover samples are flushed on stop
        await FakeSocket.last.serve({ serverContent: { inputTranscription: { text: "Draw a boat." } } })
        await FakeSocket.last.serve({ serverContent: { inputTranscription: { text: "At dawn." } } })
        expect(await finished).toBe("Draw a boat. At dawn.")
    })

    it("fails clearly when the socket errors before setup completes", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "t", url: "wss://live", setup: {} }), { status: 200 })))
        const p = startLiveTranscription({ WebSocketImpl: FakeSocket as any, openMic: async () => () => {} })
        await vi.waitFor(() => expect(FakeSocket.last?.sent.length).toBe(1))
        FakeSocket.last.onerror()
        await expect(p).rejects.toThrow(/Could not open the live connection/)
    })
})

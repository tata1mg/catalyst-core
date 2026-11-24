// @vitest-environment jsdom
// The live-transcription session lifecycle (finish timers, close/error paths, cancel), the real microphone capture path
// (AudioWorklet and ScriptProcessor flavours) and the React wrapper. The socket, microphone and audio APIs are fakes.
import { renderHook, act } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startLiveTranscription, useLiveTranscribe } from "../src/liveTranscribe.js"

class FakeSocket {
    static last: FakeSocket
    readyState = 0
    sent: any[] = []
    closed = false
    onopen: any
    onmessage: any
    onclose: any
    onerror: any
    constructor(public url: string) {
        FakeSocket.last = this
        queueMicrotask(() => {
            this.readyState = 1
            this.onopen?.()
        })
    }
    send(d: string) { this.sent.push(JSON.parse(d)) }
    close() { this.closed = true; this.readyState = 3 }
    serve(obj: unknown) { return this.onmessage?.({ data: JSON.stringify(obj) }) }
}
const TOKEN = { token: "t", url: "wss://live", setup: { model: "m" } }
const ready = { setupComplete: {} }
const finalText = (text: string) => ({ serverContent: { inputTranscription: { text } } })
const partialText = (text: string) => ({ serverContent: { interimInputTranscription: { text } } })

function stubNetwork() {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(TOKEN), { status: 200 })))
}

/** Starts a session with a fake mic and completes setup. Returns the session and the mic push function. */
async function open(options: any = {}) {
    stubNetwork()
    let push: (s: Float32Array, rate: number) => void = () => {}
    const closeMic = vi.fn()
    const started = startLiveTranscription({
        WebSocketImpl: FakeSocket as any,
        openMic: async (cb: any) => { push = cb; return closeMic },
        ...options,
    })
    await vi.waitFor(() => expect(FakeSocket.last?.sent.length).toBe(1))
    await FakeSocket.last.serve(ready)
    const session = await started
    return { session, push: (s: Float32Array, r = 16000) => push(s, r), closeMic }
}

beforeEach(() => {
    FakeSocket.last = undefined as any // a stale socket from the previous test must never satisfy a waitFor
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe("startLiveTranscription lifecycle", () => {
    it("reports status, level and final text through the callbacks", async () => {
        const onStatus = vi.fn(), onLevel = vi.fn(), onFinal = vi.fn()
        const { session, push } = await open({ onStatus, onLevel, onFinal })
        expect(onStatus.mock.calls.map((c) => c[0])).toEqual(["connecting", "listening"])
        push(new Float32Array(1600).fill(0.5))
        expect(onLevel).toHaveBeenCalledWith(1) // loud input clamps to 1
        await FakeSocket.last.serve(finalText(" Hello. "))
        expect(onFinal).toHaveBeenCalledWith("Hello.")
        session.cancel()
    })

    it("stop() settles after the server has been quiet, and a repeated stop() returns the text so far", async () => {
        const { session, closeMic } = await open()
        await FakeSocket.last.serve(finalText("One."))
        vi.useFakeTimers()
        const finished = session.stop()
        expect(closeMic).toHaveBeenCalled()
        expect(session.stop()).resolves.toBe("One.")
        await vi.advanceTimersByTimeAsync(2000)
        expect(await finished).toBe("One.")
        expect(FakeSocket.last.closed).toBe(true)
    })

    it("restarts the quiet timer when more text arrives while finishing", async () => {
        const { session } = await open()
        vi.useFakeTimers()
        const finished = session.stop()
        await FakeSocket.last.serve(finalText("First."))
        await vi.advanceTimersByTimeAsync(1000)
        await FakeSocket.last.serve(finalText("Second."))
        await vi.advanceTimersByTimeAsync(1000) // 1 s after the second final: still waiting
        let done = false
        finished.then(() => { done = true })
        await vi.advanceTimersByTimeAsync(0)
        expect(done).toBe(false)
        await vi.advanceTimersByTimeAsync(1000)
        expect(await finished).toBe("First. Second.")
    })

    it("falls back to the last partial when no final ever arrives (hard timeout)", async () => {
        const { session } = await open()
        await FakeSocket.last.serve(partialText("half a sent"))
        vi.useFakeTimers()
        const finished = session.stop()
        await vi.advanceTimersByTimeAsync(9000)
        expect(await finished).toBe("half a sent")
    })

    it("cancel() closes the socket and the mic and reports closed", async () => {
        const onStatus = vi.fn()
        const { session, closeMic } = await open({ onStatus })
        session.cancel()
        expect(closeMic).toHaveBeenCalled()
        expect(FakeSocket.last.closed).toBe(true)
        expect(onStatus).toHaveBeenLastCalledWith("closed")
    })

    it("reports an unexpected close while listening and ignores audio after the stream ended", async () => {
        const onError = vi.fn()
        const { push } = await open({ onError })
        FakeSocket.last.onclose()
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/closed unexpectedly/) }))
        const before = FakeSocket.last.sent.length
        push(new Float32Array(3200))
        expect(FakeSocket.last.sent.length).toBe(before)
    })

    it("reports a socket error after setup", async () => {
        const onError = vi.fn()
        await open({ onError })
        FakeSocket.last.onerror()
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/failed/) }))
    })

    it("rejects with the close reason when the socket closes before setup completes", async () => {
        stubNetwork()
        const p = startLiveTranscription({ WebSocketImpl: FakeSocket as any, openMic: async () => () => {} })
        await vi.waitFor(() => expect(FakeSocket.last?.sent.length).toBe(1))
        FakeSocket.last.onclose({ reason: "bad token" })
        await expect(p).rejects.toThrow("Live connection closed: bad token")
    })

    it("closes the socket and rethrows when the microphone cannot be opened", async () => {
        stubNetwork()
        const p = startLiveTranscription({ WebSocketImpl: FakeSocket as any, openMic: async () => { throw new Error("no mic") } })
        await vi.waitFor(() => expect(FakeSocket.last?.sent.length).toBe(1))
        await FakeSocket.last.serve(ready)
        await expect(p).rejects.toThrow("no mic")
        expect(FakeSocket.last.closed).toBe(true)
    })

    it("decodes binary (Blob) frames", async () => {
        stubNetwork()
        const onPartial = vi.fn()
        const started = startLiveTranscription({ WebSocketImpl: FakeSocket as any, openMic: async () => () => {}, onPartial })
        await vi.waitFor(() => expect(FakeSocket.last?.sent.length).toBe(1))
        const frame = (o: any) => ({ data: { arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(o)).buffer } })
        await FakeSocket.last.onmessage(frame(ready))
        await started
        await FakeSocket.last.onmessage(frame(partialText("from blob")))
        expect(onPartial).toHaveBeenCalledWith("from blob")
    })
})

/** Browser audio fakes for the default microphone implementation. */
function stubAudio({ worklet = true, rateThrows = false } = {}) {
    const stopTrack = vi.fn()
    const nodes: any[] = []
    const contexts: any[] = []
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) } })
    class FakeContext {
        sampleRate = 16000
        destination = {}
        audioWorklet = worklet ? { addModule: vi.fn(async () => {}) } : undefined
        close = vi.fn(async () => {})
        constructor(opts?: any) {
            if (rateThrows && opts) throw new Error("sampleRate unsupported")
            contexts.push(this)
        }
        createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() } }
        createScriptProcessor() {
            const n: any = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null }
            nodes.push(n)
            return n
        }
    }
    class FakeWorkletNode {
        port: any = { onmessage: null }
        connect = vi.fn()
        disconnect = vi.fn()
        constructor() { nodes.push(this) }
    }
    vi.stubGlobal("AudioContext", FakeContext)
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode)
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }))
    return { stopTrack, nodes, contexts }
}

describe("default microphone capture", () => {
    beforeEach(() => stubNetwork())

    it("streams AudioWorklet frames and releases the tracks and context on stop", async () => {
        const audio = stubAudio({ worklet: true })
        const started = startLiveTranscription({ WebSocketImpl: FakeSocket as any })
        await vi.waitFor(() => expect(FakeSocket.last?.sent.length).toBe(1))
        await FakeSocket.last.serve(ready)
        const session = await started
        audio.nodes[0].port.onmessage({ data: new Float32Array(1600).fill(0.1) })
        expect(FakeSocket.last.sent.filter((m) => m.realtimeInput?.audio).length).toBe(1)
        session.cancel()
        expect(audio.stopTrack).toHaveBeenCalled()
        expect(audio.nodes[0].disconnect).toHaveBeenCalled()
        expect(audio.contexts[0].close).toHaveBeenCalled()
    })

    it("falls back to ScriptProcessor and to a default-rate context when 16 kHz is refused", async () => {
        const audio = stubAudio({ worklet: false, rateThrows: true })
        const started = startLiveTranscription({ WebSocketImpl: FakeSocket as any })
        await vi.waitFor(() => expect(FakeSocket.last?.sent.length).toBe(1))
        await FakeSocket.last.serve(ready)
        const session = await started
        audio.nodes[0].onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(1600).fill(0.2) } })
        expect(FakeSocket.last.sent.filter((m) => m.realtimeInput?.audio).length).toBe(1)
        session.cancel()
    })
})

describe("useLiveTranscribe", () => {
    beforeEach(() => {
        stubNetwork()
        stubAudio()
        vi.stubGlobal("WebSocket", FakeSocket)
    })

    async function startHook(props: any = {}) {
        const hook = renderHook(() => useLiveTranscribe(props))
        let startPromise: Promise<void> = Promise.resolve()
        act(() => { startPromise = hook.result.current.start() })
        await vi.waitFor(() => expect(FakeSocket.last?.sent.length).toBe(1))
        await act(async () => { await FakeSocket.last.serve(ready); await startPromise })
        return hook
    }

    it("goes idle -> listening, shows partial and text, then stop() returns the final and calls onFinished", async () => {
        const onFinished = vi.fn()
        const { result } = await startHook({ onFinished })
        expect(result.current.state).toBe("listening")
        expect(result.current.listening).toBe(true)
        await act(async () => { await FakeSocket.last.serve(partialText("Dra")) })
        expect(result.current.partial).toBe("Dra")
        await act(async () => { await FakeSocket.last.serve(finalText("Draw a boat.")) })
        expect(result.current.text).toBe("Draw a boat.")
        vi.useFakeTimers()
        let final = ""
        await act(async () => {
            const p = result.current.stop()
            await vi.advanceTimersByTimeAsync(2000)
            final = await p
        })
        expect(final).toBe("Draw a boat.")
        expect(onFinished).toHaveBeenCalledWith("Draw a boat.")
        expect(result.current.state).toBe("idle")
    })

    it("ignores a second start() while a session is active and stop() without a session is a no-op", async () => {
        const { result } = await startHook()
        const fetchMock = globalThis.fetch as any
        const calls = fetchMock.mock.calls.length
        await act(async () => { await result.current.start() })
        expect(fetchMock.mock.calls.length).toBe(calls)
        act(() => result.current.cancel())
        expect(result.current.state).toBe("idle")
        let out: any
        await act(async () => { out = await result.current.stop() })
        expect(out).toBe("")
    })

    it("maps a denied microphone to a friendly message", async () => {
        vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }) }) } })
        const hook = renderHook(() => useLiveTranscribe())
        let p: Promise<void> = Promise.resolve()
        act(() => { p = hook.result.current.start() })
        await vi.waitFor(() => expect(FakeSocket.last?.sent.length).toBe(1))
        await act(async () => { await FakeSocket.last.serve(ready); await p })
        expect(hook.result.current.error).toBe("Microphone permission was denied.")
        expect(hook.result.current.state).toBe("idle")
    })

    it("cancels the live session on unmount", async () => {
        const hook = await startHook()
        hook.unmount()
        expect(FakeSocket.last.closed).toBe(true)
    })
})

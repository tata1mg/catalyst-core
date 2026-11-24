// @vitest-environment jsdom
// useMicrophone with an audio analyser: the live level, speech detection, auto-stop after silence and the
// "no speech heard" case. The recorder and AudioContext are fakes; loudness is whatever the test says it is.
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useMicrophone } from "../../src/native/bridge/hooks/useMicrophone"

let loud = false
class FakeRecorder {
    static isTypeSupported = () => true
    state = "inactive"
    mimeType = "audio/webm"
    ondataavailable: ((e: any) => void) | null = null
    onstop: (() => void) | null = null
    constructor(public stream: any) {}
    start() { this.state = "recording"; this.ondataavailable?.({ data: new Blob(["audio"]) }) }
    stop() { this.state = "inactive"; void this.onstop?.() }
}
class FakeAnalyser {
    fftSize = 0
    getByteTimeDomainData(buf: Uint8Array) { buf.fill(loud ? 220 : 128) }
}
class FakeContext {
    analyser = new FakeAnalyser()
    close = vi.fn(async () => {})
    createAnalyser() { return this.analyser }
    createMediaStreamSource() { return { connect: vi.fn() } }
}
const track = { stop: vi.fn() }
const stream = { getTracks: () => [track] }

beforeEach(() => {
    loud = false
    track.stop.mockReset()
    vi.useFakeTimers()
    vi.stubGlobal("MediaRecorder", FakeRecorder)
    vi.stubGlobal("AudioContext", FakeContext)
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(stream) } })
})
afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe("useMicrophone with an analyser", () => {
    it("shows a level, hears speech, and stops itself after the silence window, delivering the clip", async () => {
        const onRecorded = vi.fn()
        const { result } = renderHook(() => useMicrophone({ onRecorded, silenceMs: 500 }))
        await act(async () => { await result.current.start() })
        loud = true
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        expect(result.current.level).toBeGreaterThan(0)
        expect(result.current.listening).toBe(true)
        loud = false
        await act(async () => { await vi.advanceTimersByTimeAsync(800) })
        expect(result.current.listening).toBe(false)
        await vi.waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1), { timeout: 2000, interval: 10 }).catch(() => {})
        await act(async () => { await vi.advanceTimersByTimeAsync(50) })
        expect(onRecorded).toHaveBeenCalledWith(expect.stringMatching(/^data:audio\/webm/), expect.objectContaining({ seconds: expect.any(Number) }))
    })

    it("does not stop on silence when autoStop is off", async () => {
        const { result } = renderHook(() => useMicrophone({ autoStop: false, silenceMs: 200 }))
        await act(async () => { await result.current.start() })
        loud = true
        await act(async () => { await vi.advanceTimersByTimeAsync(200) })
        loud = false
        await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
        expect(result.current.listening).toBe(true)
        act(() => result.current.cancel())
    })

    it("says so when nothing but silence was recorded", async () => {
        const onRecorded = vi.fn()
        const { result } = renderHook(() => useMicrophone({ onRecorded }))
        await act(async () => { await result.current.start() })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        await act(async () => { result.current.stop() })
        expect(result.current.error).toBe("No speech was heard. Check the microphone and try again.")
        expect(onRecorded).not.toHaveBeenCalled()
    })

    it("reports a microphone that cannot be opened for another reason", async () => {
        ;(navigator.mediaDevices.getUserMedia as any).mockRejectedValueOnce(new Error("busy"))
        const { result } = renderHook(() => useMicrophone())
        await act(async () => { await result.current.start() })
        expect(result.current.error).toBe("Could not open the microphone: busy")
        expect(result.current.listening).toBe(false)
    })

    it("a second start() while recording does nothing", async () => {
        const { result } = renderHook(() => useMicrophone())
        await act(async () => { await result.current.start() })
        const calls = (navigator.mediaDevices.getUserMedia as any).mock.calls.length
        await act(async () => { await result.current.start() })
        expect((navigator.mediaDevices.getUserMedia as any).mock.calls.length).toBe(calls)
        act(() => result.current.cancel())
    })
})

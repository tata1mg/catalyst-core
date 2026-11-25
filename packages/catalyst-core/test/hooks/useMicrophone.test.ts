// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const permission = vi.fn<() => Promise<string | null>>()
vi.mock("../../src/native/bridge/hooks/microphonePermission.js", () => ({ requestMicrophonePermission: () => permission() }))

import { useMicrophone } from "../../src/native/bridge/hooks/useMicrophone"

afterEach(() => {
    cleanup() // no vitest globals here, so no automatic cleanup
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

class FakeRecorder {
    static supported = true
    static isTypeSupported = (t: string) => FakeRecorder.supported && t === "audio/webm;codecs=opus"
    state = "inactive"
    mimeType = "audio/webm;codecs=opus"
    ondataavailable: ((e: any) => void) | null = null
    onstop: (() => void) | null = null
    constructor(public stream: any) {}
    start() { this.state = "recording"; this.ondataavailable?.({ data: new Blob(["audio"]) }) }
    stop() { this.state = "inactive"; void this.onstop?.() }
}
const track = { stop: vi.fn() }
const stream = { getTracks: () => [track] }

beforeEach(() => {
    track.stop.mockReset()
    permission.mockReset().mockResolvedValue(null)
    vi.stubGlobal("MediaRecorder", FakeRecorder)
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(stream) } })
})

describe("useMicrophone", () => {
    it("is unsupported without MediaRecorder or getUserMedia, and start() says why", async () => {
        vi.stubGlobal("MediaRecorder", undefined)
        const { result } = renderHook(() => useMicrophone())
        expect(result.current.supported).toBe(false)
        await act(async () => { await result.current.start() })
        expect(result.current.error).toMatch(/cannot record audio/)
        expect(result.current.listening).toBe(false)
    })

    it("reports a denied permission and does not start", async () => {
        ;(navigator.mediaDevices.getUserMedia as any).mockRejectedValueOnce(Object.assign(new Error("no"), { name: "NotAllowedError" }))
        const { result } = renderHook(() => useMicrophone())
        await act(async () => { await result.current.start() })
        expect(result.current.error).toBe("Microphone permission was denied.")
        expect(result.current.listening).toBe(false)
    })

    it("records, stops, releases the microphone and delivers the clip as a data URL", async () => {
        const onRecorded = vi.fn()
        // No AudioContext in jsdom: the recording is delivered without a speech check.
        const { result } = renderHook(() => useMicrophone({ onRecorded }))
        await act(async () => { await result.current.start() })
        expect(result.current.listening).toBe(true)
        await act(async () => { result.current.stop() })
        await vi.waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1))
        expect(onRecorded.mock.calls[0][0]).toMatch(/^data:audio\/webm/)
        expect(track.stop).toHaveBeenCalled()
        expect(result.current.listening).toBe(false)
    })

    it("cancel() drops the recording", async () => {
        const onRecorded = vi.fn()
        const { result } = renderHook(() => useMicrophone({ onRecorded }))
        await act(async () => { await result.current.start() })
        await act(async () => { result.current.cancel() })
        await new Promise((r) => setTimeout(r, 20))
        expect(onRecorded).not.toHaveBeenCalled()
        expect(track.stop).toHaveBeenCalled()
    })

    it("cancel() before the microphone is even requested never opens it", async () => {
        const { result } = renderHook(() => useMicrophone())
        let pending: Promise<any> = Promise.resolve()
        act(() => { pending = result.current.start() })
        await act(async () => { result.current.cancel(); await pending })
        expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
        expect(result.current.listening).toBe(false)
    })

    it("cancel() while the browser is still opening the microphone releases it as soon as it arrives", async () => {
        let open!: (s: any) => void
        ;(navigator.mediaDevices.getUserMedia as any).mockReturnValueOnce(new Promise((resolve) => { open = resolve }))
        const onRecorded = vi.fn()
        const { result } = renderHook(() => useMicrophone({ onRecorded }))
        let pending: Promise<any> = Promise.resolve()
        act(() => { pending = result.current.start() })
        await vi.waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled()) // the browser is now opening it
        await act(async () => { result.current.cancel() })
        let started: any
        await act(async () => { open(stream); started = await pending })
        expect(started.started).toBe(false)
        expect(track.stop).toHaveBeenCalled()
        expect(result.current.listening).toBe(false)
        expect(onRecorded).not.toHaveBeenCalled()
    })

    it("unmounting while the microphone is opening releases it and starts nothing", async () => {
        let open!: (s: any) => void
        ;(navigator.mediaDevices.getUserMedia as any).mockReturnValueOnce(new Promise((resolve) => { open = resolve }))
        const { result, unmount } = renderHook(() => useMicrophone())
        let pending: Promise<any> = Promise.resolve()
        act(() => { pending = result.current.start() })
        await vi.waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled())
        unmount()
        await act(async () => { open(stream); await pending })
        expect(track.stop).toHaveBeenCalled()
    })

    it("a recorder that cannot be built is a start result, the microphone is released, and nothing throws", async () => {
        vi.stubGlobal("MediaRecorder", class { static isTypeSupported = () => true; constructor() { throw new Error("unsupported type") } })
        const { result } = renderHook(() => useMicrophone())
        let started: any
        await act(async () => { started = await result.current.start() })
        expect(started.started).toBe(false)
        expect(started.error).toMatch(/Could not start recording: unsupported type/)
        expect(track.stop).toHaveBeenCalled()
        expect(result.current.listening).toBe(false)
        expect(result.current.error).toMatch(/Could not start recording/)
    })

    it("a recorder that fails to start is a start result too, and everything it opened is released", async () => {
        vi.stubGlobal("MediaRecorder", class FailingRecorder extends FakeRecorder { start() { throw new Error("start failed") } })
        const { result } = renderHook(() => useMicrophone())
        let started: any
        await act(async () => { started = await result.current.start() })
        expect(started).toMatchObject({ started: false, error: expect.stringMatching(/start failed/) })
        expect(track.stop).toHaveBeenCalled()
        expect(result.current.listening).toBe(false)
    })

    it("stops by itself at maxSeconds", async () => {
        vi.useFakeTimers()
        const onRecorded = vi.fn()
        const { result } = renderHook(() => useMicrophone({ onRecorded, maxSeconds: 2 }))
        await act(async () => { await result.current.start() })
        await act(async () => { await vi.advanceTimersByTimeAsync(2300) })
        expect(result.current.listening).toBe(false)
        vi.useRealTimers()
        await vi.waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1))
    })

    it("releases the microphone when the page unmounts mid-recording", async () => {
        const { result, unmount } = renderHook(() => useMicrophone())
        await act(async () => { await result.current.start() })
        unmount()
        expect(track.stop).toHaveBeenCalled()
    })

    it("asks the native shell for the microphone before it opens it, and does not open it when refused", async () => {
        permission.mockRejectedValueOnce(new Error("Microphone permission denied"))
        const { result } = renderHook(() => useMicrophone())
        await act(async () => { await result.current.start() })
        expect(permission).toHaveBeenCalledTimes(1)
        expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
        expect(result.current.error).toBe("Microphone permission was denied.")
        expect(result.current.listening).toBe(false)
    })

    it("opens the microphone once the shell has granted it", async () => {
        permission.mockResolvedValueOnce("GRANTED")
        const { result } = renderHook(() => useMicrophone())
        await act(async () => { await result.current.start() })
        expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
        expect(result.current.listening).toBe(true)
    })

    it("a bridge failure while asking for permission is reported as that, not as the person refusing", async () => {
        permission.mockRejectedValueOnce(Object.assign(new Error("bridge down"), { code: "BRIDGE_ERROR" }))
        const { result } = renderHook(() => useMicrophone())
        let started: any
        await act(async () => { started = await result.current.start() })
        expect(started.started).toBe(false)
        expect(started.error).toMatch(/Could not ask for the microphone permission: bridge down/)
        expect(started.error).not.toMatch(/denied/)
        permission.mockRejectedValueOnce(Object.assign(new Error("Microphone permission denied"), { code: "PERMISSION_DENIED" }))
        await act(async () => { started = await result.current.start() })
        expect(started.error).toBe("Microphone permission was denied.")
    })

    it("two quick start() calls make one recording: the second is refused while the first is still opening", async () => {
        let release!: (v: string | null) => void
        permission.mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
        const { result } = renderHook(() => useMicrophone())
        let first!: Promise<any>
        let second: any
        act(() => { first = result.current.start() })
        await act(async () => { second = await result.current.start() })
        expect(second).toEqual({ started: false, error: "Already starting." })
        await act(async () => { release(null); await first })
        expect(result.current.listening).toBe(true)
        expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
    })

    it("a recording cancelled while its clip is being read is not delivered", async () => {
        class SlowReader {
            static last: SlowReader
            result: any = null
            onload: any
            onerror: any
            constructor() { SlowReader.last = this }
            readAsDataURL() {}
            finish(data: string) { this.result = data; this.onload?.() }
        }
        vi.stubGlobal("FileReader", SlowReader)
        const onRecorded = vi.fn()
        const { result } = renderHook(() => useMicrophone({ onRecorded }))
        await act(async () => { await result.current.start() })
        act(() => { result.current.stop() }) // the clip is now being read
        act(() => { result.current.cancel() }) // too late for the session, but the clip must still be dropped
        await act(async () => { SlowReader.last.finish("data:audio/webm;base64,AAAA"); await Promise.resolve() })
        expect(onRecorded).not.toHaveBeenCalled()
    })
})

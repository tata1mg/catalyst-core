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
})

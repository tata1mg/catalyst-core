// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const bridge = vi.hoisted(() => ({
    isAvailable: vi.fn(() => true),
    speech: { getSupport: vi.fn<(c?: string) => boolean | void>(() => true), start: vi.fn<(c?: string) => boolean | void>(() => true), stop: vi.fn() },
}))
vi.mock("../../src/native/bridge/utils/NativeBridge.js", () => ({ default: bridge }))
const permission = vi.hoisted(() => vi.fn<() => Promise<string | null>>())
vi.mock("../../src/native/bridge/hooks/microphonePermission.js", () => ({ requestMicrophonePermission: () => permission() }))

import { useSpeechRecognition } from "../../src/native/bridge/hooks/useSpeechRecognition"

let handlers: Record<string, (data: unknown) => void> = {}
const webBridge = {
    register: vi.fn((name: string, fn: (data: unknown) => void) => { handlers[name] = fn }),
    unregister: vi.fn((name: string) => { delete handlers[name] }),
}
const emit = (name: string, data: unknown) => act(() => { handlers[name](data) })

beforeEach(() => {
    handlers = {}
    webBridge.register.mockClear()
    webBridge.unregister.mockClear()
    bridge.isAvailable.mockReturnValue(true)
    bridge.speech.getSupport.mockReset().mockReturnValue(true)
    bridge.speech.start.mockReset().mockReturnValue(true)
    bridge.speech.stop.mockReset()
    permission.mockReset().mockResolvedValue("GRANTED")
    ;(window as any).WebBridge = webBridge
})
afterEach(() => {
    cleanup() // no vitest globals here, so no automatic cleanup
    delete (window as any).WebBridge
    vi.useRealTimers()
})

describe("useSpeechRecognition", () => {
    it("is unsupported in a plain browser, makes no bridge calls, and start() says so", async () => {
        delete (window as any).WebBridge
        const { result } = renderHook(() => useSpeechRecognition())
        expect(result.current.supported).toBe(false)
        await act(async () => { await result.current.start() })
        expect(result.current.error).toMatch(/only available inside the app/)
        expect(bridge.speech.getSupport).not.toHaveBeenCalled()
        expect(bridge.speech.start).not.toHaveBeenCalled()
    })

    it("asks the shell about the language on mount, and learns from the reply", () => {
        const { result } = renderHook(() => useSpeechRecognition({ language: "en-IN" }))
        expect(bridge.speech.getSupport).toHaveBeenCalledWith(JSON.stringify({ language: "en-IN" }))
        expect(result.current.supported).toBeNull()
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-IN", installed: true })
        expect(result.current.supported).toBe(true)
        expect(result.current.support).toMatchObject({ language: "en-IN", installed: true })
    })

    it("a language without an on-device model is unsupported and start() explains why, without listening", async () => {
        const { result } = renderHook(() => useSpeechRecognition({ language: "hi-IN" }))
        emit("SPEECH_RECOGNITION_SUPPORT", { available: false, onDevice: false, language: "hi-IN", reason: "ON_DEVICE_UNAVAILABLE" })
        expect(result.current.supported).toBe(false)
        await act(async () => { await result.current.start() })
        expect(result.current.error).toBe("On-device speech recognition is not available on this device.")
        expect(permission).not.toHaveBeenCalled()
        expect(bridge.speech.start).not.toHaveBeenCalled()
    })

    it("a shell that never answers (built before the command existed) is treated as unsupported after 5 s", async () => {
        vi.useFakeTimers()
        const { result } = renderHook(() => useSpeechRecognition())
        await act(async () => { await vi.advanceTimersByTimeAsync(5100) })
        expect(result.current.supported).toBe(false)
        expect(result.current.support?.reason).toBe("NO_RESPONSE")
    })

    it("an answer cancels the wait", async () => {
        vi.useFakeTimers()
        const { result } = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
        expect(result.current.supported).toBe(true)
    })

    it("start() asks for the microphone, then starts the shell with the language", async () => {
        const { result } = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        await act(async () => { await result.current.start() })
        expect(permission).toHaveBeenCalledTimes(1)
        expect(bridge.speech.start).toHaveBeenCalledWith(JSON.stringify({ language: "en-US" }))
        expect(result.current.state).toBe("starting")
        emit("SPEECH_RECOGNITION_STATE", { state: "listening" })
        expect(result.current.listening).toBe(true)
    })

    it("does not start when the microphone is refused", async () => {
        permission.mockRejectedValueOnce(new Error("Microphone permission denied"))
        const { result } = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        await act(async () => { await result.current.start() })
        expect(bridge.speech.start).not.toHaveBeenCalled()
        expect(result.current.error).toBe("Microphone or speech recognition permission was denied.")
        expect(result.current.state).toBe("idle")
    })

    it("reports an app that has no such command (the call returns false)", async () => {
        bridge.speech.start.mockReturnValue(false)
        const { result } = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        await act(async () => { await result.current.start() })
        expect(result.current.error).toBe("This version of the app cannot recognise speech yet.")
        expect(result.current.state).toBe("idle")
    })

    it("shows partial text, then the final text, and tells onFinal once", async () => {
        const onFinal = vi.fn()
        const { result } = renderHook(() => useSpeechRecognition({ onFinal }))
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        await act(async () => { await result.current.start() })
        emit("SPEECH_RECOGNITION_PARTIAL", { text: "a red" })
        expect(result.current.partial).toBe("a red")
        emit("SPEECH_RECOGNITION_PARTIAL", { text: "a red boat" })
        emit("SPEECH_RECOGNITION_FINAL", { text: "a red boat at sea" })
        expect(result.current).toMatchObject({ text: "a red boat at sea", partial: "" })
        expect(onFinal).toHaveBeenCalledTimes(1)
        expect(onFinal).toHaveBeenCalledWith("a red boat at sea")
        emit("SPEECH_RECOGNITION_STATE", { state: "idle" })
        expect(result.current.state).toBe("idle")
    })

    it("accepts events sent as JSON strings, and ignores an empty final", () => {
        const onFinal = vi.fn()
        const { result } = renderHook(() => useSpeechRecognition({ onFinal }))
        emit("SPEECH_RECOGNITION_PARTIAL", JSON.stringify({ text: "hello" }))
        expect(result.current.partial).toBe("hello")
        emit("SPEECH_RECOGNITION_FINAL", JSON.stringify({ text: "" }))
        expect(onFinal).not.toHaveBeenCalled()
    })

    it("turns error codes into messages, and stays quiet for a cancel", () => {
        const { result } = renderHook(() => useSpeechRecognition({ language: "en-US" }))
        emit("SPEECH_RECOGNITION_ERROR", { code: "NO_SPEECH", message: "x" })
        expect(result.current.error).toBe("No speech was heard.")
        emit("SPEECH_RECOGNITION_ERROR", { code: "LANGUAGE_UNAVAILABLE", message: "x" })
        expect(result.current.error).toBe("On-device speech recognition is not available for en-US.")
        emit("SPEECH_RECOGNITION_ERROR", { code: "SOMETHING_NEW", message: "the shell says so" })
        expect(result.current.error).toBe("the shell says so")
        const before = result.current.error
        emit("SPEECH_RECOGNITION_ERROR", { code: "CANCELLED", message: "x" })
        expect(result.current.error).toBe(before)
        expect(result.current.state).toBe("idle")
    })

    it("stop() ends the session; cancel() ends it and drops the final text", async () => {
        const onFinal = vi.fn()
        const { result } = renderHook(() => useSpeechRecognition({ onFinal }))
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        await act(async () => { await result.current.start() })
        act(() => result.current.stop())
        expect(bridge.speech.stop).toHaveBeenCalledTimes(1)

        act(() => result.current.cancel())
        emit("SPEECH_RECOGNITION_FINAL", { text: "late words" })
        expect(onFinal).not.toHaveBeenCalled()
        expect(result.current.text).toBe("")

        // the next session is not affected
        await act(async () => { await result.current.start() })
        emit("SPEECH_RECOGNITION_FINAL", { text: "fresh words" })
        expect(onFinal).toHaveBeenCalledWith("fresh words")
    })

    it("unregisters every callback and stops when the page unmounts", () => {
        const { unmount } = renderHook(() => useSpeechRecognition())
        expect(Object.keys(handlers)).toHaveLength(5)
        unmount()
        expect(Object.keys(handlers)).toHaveLength(0)
        expect(bridge.speech.stop).toHaveBeenCalled()
    })
})

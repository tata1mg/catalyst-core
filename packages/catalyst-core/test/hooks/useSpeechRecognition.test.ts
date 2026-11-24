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
import { resetSpeechBus } from "../../src/native/bridge/hooks/speechBus"

let handlers: Record<string, (data: unknown) => void> = {}
const webBridge = {
    register: vi.fn((name: string, fn: (data: unknown) => void) => { handlers[name] = fn }),
    unregister: vi.fn((name: string) => { delete handlers[name] }),
}
const emit = (name: string, data: unknown) => act(() => { handlers[name](data) })

beforeEach(() => {
    resetSpeechBus()
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
    resetSpeechBus()
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

    it("cancel() while the microphone prompt is open: the late answer does not start recognition", async () => {
        let allow!: (v: string) => void
        permission.mockReturnValueOnce(new Promise<string>((resolve) => { allow = resolve }))
        const { result } = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        let started: any
        let pending: Promise<void> = Promise.resolve()
        act(() => { pending = result.current.start().then((r) => { started = r }) })
        act(() => result.current.cancel())
        await act(async () => { allow("GRANTED"); await pending })
        expect(started).toEqual({ started: false, code: "CANCELLED" })
        expect(bridge.speech.start).not.toHaveBeenCalled()
    })

    it("unmounting while the microphone prompt is open: the late answer does not start recognition", async () => {
        let allow!: (v: string) => void
        permission.mockReturnValueOnce(new Promise<string>((resolve) => { allow = resolve }))
        const { result, unmount } = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        let pending: Promise<unknown> = Promise.resolve()
        act(() => { pending = result.current.start() })
        unmount()
        await act(async () => { allow("GRANTED"); await pending })
        expect(bridge.speech.start).not.toHaveBeenCalled()
    })

    it("stop() before the prompt is answered also abandons the pending start", async () => {
        let allow!: (v: string) => void
        permission.mockReturnValueOnce(new Promise<string>((resolve) => { allow = resolve }))
        const { result } = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        let pending: Promise<unknown> = Promise.resolve()
        act(() => { pending = result.current.start() })
        act(() => result.current.stop())
        await act(async () => { allow("GRANTED"); await pending })
        expect(bridge.speech.start).not.toHaveBeenCalled()
    })

    it("a refusal that arrives after cancel() is not reported as an error", async () => {
        let deny!: (e: Error) => void
        permission.mockReturnValueOnce(new Promise<string>((_resolve, reject) => { deny = reject }))
        const { result } = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        let pending: Promise<unknown> = Promise.resolve()
        act(() => { pending = result.current.start() })
        act(() => result.current.cancel())
        await act(async () => { deny(new Error("denied")); await pending })
        expect(result.current.error).toBeNull()
    })

    it("a CANCELLED error that nobody asked for ends the session as an empty result, but cancel() stays silent", async () => {
        const onEnd = vi.fn()
        const { result } = renderHook(() => useSpeechRecognition({ onEnd }))
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        await act(async () => { await result.current.start() })
        emit("SPEECH_RECOGNITION_ERROR", { code: "CANCELLED", message: "x" })
        expect(onEnd).toHaveBeenCalledTimes(1)
        expect(onEnd).toHaveBeenCalledWith("")
        await act(async () => { await result.current.start() })
        act(() => result.current.cancel())
        emit("SPEECH_RECOGNITION_ERROR", { code: "CANCELLED", message: "x" })
        expect(onEnd).toHaveBeenCalledTimes(1)
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

    it("accepts events sent as JSON strings, and ignores an empty final", async () => {
        const onFinal = vi.fn()
        const { result } = renderHook(() => useSpeechRecognition({ onFinal }))
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        await act(async () => { await result.current.start() })
        emit("SPEECH_RECOGNITION_PARTIAL", JSON.stringify({ text: "hello" }))
        expect(result.current.partial).toBe("hello")
        emit("SPEECH_RECOGNITION_FINAL", JSON.stringify({ text: "" }))
        expect(onFinal).not.toHaveBeenCalled()
    })

    it("turns error codes into messages and gives the code, and stays quiet for a cancel", async () => {
        const { result } = renderHook(() => useSpeechRecognition({ language: "en-US" }))
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        const failWith = async (code: string, message = "x") => {
            await act(async () => { await result.current.start() }) // an error ends the session, so each one needs its own
            emit("SPEECH_RECOGNITION_ERROR", { code, message })
        }
        await failWith("NO_SPEECH")
        expect(result.current.error).toBe("No speech was heard.")
        expect(result.current.errorCode).toBe("NO_SPEECH")
        await failWith("SOMETHING_NEW", "the shell says so")
        expect(result.current.error).toBe("the shell says so")
        await act(async () => { await result.current.start() })
        const before = result.current.error
        emit("SPEECH_RECOGNITION_ERROR", { code: "CANCELLED", message: "x" })
        expect(result.current.error).toBe(before)
        expect(result.current.state).toBe("idle")
        await failWith("LANGUAGE_UNAVAILABLE")
        expect(result.current.error).toBe("On-device speech recognition is not available for en-US.")
    })

    it("a start that fails because the on-device model is missing makes the hook unsupported from then on", async () => {
        const { result } = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        expect(result.current.supported).toBe(true)
        await act(async () => { await result.current.start() })
        emit("SPEECH_RECOGNITION_ERROR", { code: "ON_DEVICE_UNAVAILABLE", message: "kAFAssistantErrorDomain 1: Failed to initialize recognizer" })
        expect(result.current.supported).toBe(false)
        expect(result.current.support).toMatchObject({ available: false, reason: "ON_DEVICE_UNAVAILABLE" })
        expect(result.current.error).toBe("On-device speech recognition is not available on this device.")

        // and it no longer starts, so the shell is not asked again
        bridge.speech.start.mockClear()
        await act(async () => { await result.current.start() })
        expect(bridge.speech.start).not.toHaveBeenCalled()
    })

    it("an error that says nothing about availability (no speech heard) keeps support as it was", async () => {
        const { result } = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        emit("SPEECH_RECOGNITION_ERROR", { code: "NO_SPEECH", message: "x" })
        expect(result.current.supported).toBe(true)
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

    it("unregisters every callback when the last user unmounts, and stops the session only if it owned it", async () => {
        const { result, unmount } = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        expect(Object.keys(handlers)).toHaveLength(5)
        await act(async () => { await result.current.start() })
        unmount()
        expect(Object.keys(handlers)).toHaveLength(0)
        expect(bridge.speech.stop).toHaveBeenCalledTimes(1)
    })

    it("an unmount with no session running does not stop the shell", () => {
        const { unmount } = renderHook(() => useSpeechRecognition())
        unmount()
        expect(bridge.speech.stop).not.toHaveBeenCalled()
    })
})

describe("two components using speech recognition at once", () => {
    it("share one subscription: the shell is asked once and registered once", () => {
        renderHook(() => useSpeechRecognition())
        renderHook(() => useSpeechRecognition())
        expect(webBridge.register).toHaveBeenCalledTimes(5)
        expect(bridge.speech.getSupport).toHaveBeenCalledTimes(1)
    })

    it("a support reply reaches both, and a second one mounting later gets the answer without asking again", () => {
        const first = renderHook(() => useSpeechRecognition())
        const second = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        expect(first.result.current.supported).toBe(true)
        expect(second.result.current.supported).toBe(true)
        const third = renderHook(() => useSpeechRecognition())
        expect(third.result.current.supported).toBe(true)
        expect(bridge.speech.getSupport).toHaveBeenCalledTimes(1)
    })

    it("session events go only to the one that started it", async () => {
        const first = renderHook(() => useSpeechRecognition())
        const second = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        await act(async () => { await first.result.current.start() })
        emit("SPEECH_RECOGNITION_PARTIAL", { text: "only for the first" })
        emit("SPEECH_RECOGNITION_FINAL", { text: "only for the first, done" })
        expect(first.result.current.text).toBe("only for the first, done")
        expect(second.result.current.partial).toBe("")
        expect(second.result.current.text).toBe("")
    })

    it("a second one cannot start while the first has a session (BUSY), and the first is not disturbed", async () => {
        const first = renderHook(() => useSpeechRecognition())
        const second = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        await act(async () => { await first.result.current.start() })
        bridge.speech.start.mockClear()
        await act(async () => { await second.result.current.start() })
        expect(bridge.speech.start).not.toHaveBeenCalled()
        expect(second.result.current.errorCode).toBe("BUSY")
        emit("SPEECH_RECOGNITION_PARTIAL", { text: "still the first" })
        expect(first.result.current.partial).toBe("still the first")
    })

    it("one unmounting does not unregister the callbacks or stop the other's session", async () => {
        const first = renderHook(() => useSpeechRecognition())
        const second = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        await act(async () => { await first.result.current.start() })
        second.unmount()
        expect(Object.keys(handlers)).toHaveLength(5)
        expect(bridge.speech.stop).not.toHaveBeenCalled()
        emit("SPEECH_RECOGNITION_FINAL", { text: "still delivered" })
        expect(first.result.current.text).toBe("still delivered")
    })

    it("once the session ends (idle), another component may start its own", async () => {
        const first = renderHook(() => useSpeechRecognition())
        const second = renderHook(() => useSpeechRecognition())
        emit("SPEECH_RECOGNITION_SUPPORT", { available: true, onDevice: true, language: "en-US" })
        await act(async () => { await first.result.current.start() })
        emit("SPEECH_RECOGNITION_FINAL", { text: "done" })
        emit("SPEECH_RECOGNITION_STATE", { state: "idle" })
        await act(async () => { await second.result.current.start() })
        expect(second.result.current.errorCode).toBeNull()
        expect(bridge.speech.start).toHaveBeenCalledTimes(2)
    })
})

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const bridge = vi.hoisted(() => ({
    isAvailable: vi.fn(() => true),
    isAndroid: true,
    microphone: { requestPermission: vi.fn<() => boolean | void>(() => true) },
}))
vi.mock("../../src/native/bridge/utils/NativeBridge.js", () => ({ default: bridge }))

import { requestMicrophonePermission } from "../../src/native/bridge/hooks/microphonePermission"

const EVENT = "MICROPHONE_PERMISSION_STATUS"
let handlers: Record<string, (data: string) => void> = {}
const webBridge = {
    register: vi.fn((name: string, fn: (data: string) => void) => { handlers[name] = fn }),
    unregister: vi.fn((name: string) => { delete handlers[name] }),
}

beforeEach(() => {
    handlers = {}
    webBridge.register.mockClear()
    webBridge.unregister.mockClear()
    bridge.isAvailable.mockReturnValue(true)
    bridge.isAndroid = true
    bridge.microphone.requestPermission.mockReset().mockReturnValue(true)
    ;(window as any).WebBridge = webBridge
})
afterEach(() => { delete (window as any).WebBridge })

describe("requestMicrophonePermission", () => {
    it("asks the shell, then resolves GRANTED when the shell says so", async () => {
        const pending = requestMicrophonePermission()
        expect(bridge.microphone.requestPermission).toHaveBeenCalledTimes(1)
        handlers[EVENT]("GRANTED")
        await expect(pending).resolves.toBe("GRANTED")
        expect(webBridge.unregister).toHaveBeenCalledWith(EVENT)
    })

    it("overlapping requests share one bridge call and one callback, and both get the answer", async () => {
        const first = requestMicrophonePermission()
        const second = requestMicrophonePermission()
        expect(bridge.microphone.requestPermission).toHaveBeenCalledTimes(1)
        expect(webBridge.register).toHaveBeenCalledTimes(1)
        handlers[EVENT]("GRANTED")
        await expect(Promise.all([first, second])).resolves.toEqual(["GRANTED", "GRANTED"])
        // once settled, the next request asks again
        const third = requestMicrophonePermission()
        expect(bridge.microphone.requestPermission).toHaveBeenCalledTimes(2)
        handlers[EVENT]("GRANTED")
        await third
    })

    it("rejects when the user refuses", async () => {
        const pending = requestMicrophonePermission()
        handlers[EVENT]("DENIED")
        await expect(pending).rejects.toThrow("Microphone permission denied")
        expect(webBridge.unregister).toHaveBeenCalledWith(EVENT)
    })

    it("resolves null without asking in a plain browser (no WebBridge) or when no native shell is available", async () => {
        delete (window as any).WebBridge
        await expect(requestMicrophonePermission()).resolves.toBeNull()
        ;(window as any).WebBridge = webBridge
        bridge.isAvailable.mockReturnValue(false)
        await expect(requestMicrophonePermission()).resolves.toBeNull()
        expect(bridge.microphone.requestPermission).not.toHaveBeenCalled()
    })

    it("asks on iOS too, with the same command and the same answer", async () => {
        bridge.isAndroid = false
        const pending = requestMicrophonePermission()
        expect(bridge.microphone.requestPermission).toHaveBeenCalledTimes(1)
        handlers[EVENT]("GRANTED")
        await expect(pending).resolves.toBe("GRANTED")
    })

    it("stops waiting after 30 s when a shell built before the command existed never answers (iOS stays silent)", async () => {
        vi.useFakeTimers()
        try {
            bridge.isAndroid = false
            const pending = requestMicrophonePermission()
            await vi.advanceTimersByTimeAsync(29_000)
            expect(webBridge.unregister).not.toHaveBeenCalled()
            await vi.advanceTimersByTimeAsync(1_500)
            await expect(pending).resolves.toBeNull()
            expect(webBridge.unregister).toHaveBeenCalledWith(EVENT)
        } finally {
            vi.useRealTimers()
        }
    })

    it("an answer cancels the wait", async () => {
        vi.useFakeTimers()
        try {
            const pending = requestMicrophonePermission()
            handlers[EVENT]("GRANTED")
            await expect(pending).resolves.toBe("GRANTED")
            webBridge.unregister.mockClear()
            await vi.advanceTimersByTimeAsync(60_000)
            expect(webBridge.unregister).not.toHaveBeenCalled() // the timer was cleared, nothing fires later
        } finally {
            vi.useRealTimers()
        }
    })

    it("does not wait for a shell built before the command existed (the call reports false)", async () => {
        bridge.microphone.requestPermission.mockReturnValue(false)
        await expect(requestMicrophonePermission()).resolves.toBeNull()
        expect(webBridge.unregister).toHaveBeenCalledWith(EVENT)
    })

    it("rejects and cleans up when the bridge call throws", async () => {
        bridge.microphone.requestPermission.mockImplementation(() => { throw new Error("bridge down") })
        await expect(requestMicrophonePermission()).rejects.toThrow("bridge down")
        expect(webBridge.unregister).toHaveBeenCalledWith(EVENT)
    })
})

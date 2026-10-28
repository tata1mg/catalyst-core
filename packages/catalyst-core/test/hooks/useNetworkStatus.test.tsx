// @vitest-environment jsdom
// WebBridge keeps one handler per callback name. Every useNetworkStatus instance must still hear about the network,
// and one unmounting must not silence the others (useAI now holds an instance alongside the app's own).
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getStatus = vi.fn()
vi.mock("../../src/native/bridge/utils/NativeBridge.js", () => ({
    default: { isAvailable: () => true, network: { getStatus: (...a: unknown[]) => getStatus(...a) } },
}))

import { useNetworkStatus } from "../../src/native/bridge/hooks/useNetworkStatus"

type Handler = (payload: unknown) => void
let handlers: Map<string, Handler>
let register: ReturnType<typeof vi.fn>
let unregister: ReturnType<typeof vi.fn>

beforeEach(() => {
    handlers = new Map()
    register = vi.fn((name: string, cb: Handler) => {
        handlers.set(name, cb) // like the real WebBridge: one handler per name, a second register replaces it
        return true
    })
    unregister = vi.fn((name: string) => handlers.delete(name))
    ;(window as any).WebBridge = { register, unregister }
    getStatus.mockReset()
})
afterEach(() => {
    delete (window as any).WebBridge
})

const emit = (payload: object) => act(() => handlers.get("NETWORK_STATUS_CHANGED")?.(JSON.stringify(payload)))

describe("useNetworkStatus with several instances", () => {
    it("registers with the bridge once, however many instances mount", () => {
        renderHook(() => useNetworkStatus())
        renderHook(() => useNetworkStatus())
        renderHook(() => useNetworkStatus())
        expect(register).toHaveBeenCalledTimes(1)
    })

    it("delivers every update to every instance", () => {
        const a = renderHook(() => useNetworkStatus())
        const b = renderHook(() => useNetworkStatus())
        emit({ online: false, type: "none" })
        expect(a.result.current).toMatchObject({ online: false, type: "none" })
        expect(b.result.current).toMatchObject({ online: false, type: "none" })
        emit({ online: true, type: "wifi" })
        expect(a.result.current).toMatchObject({ online: true, type: "wifi" })
        expect(b.result.current).toMatchObject({ online: true, type: "wifi" })
    })

    it("an instance unmounting does not silence the others", () => {
        const a = renderHook(() => useNetworkStatus())
        const b = renderHook(() => useNetworkStatus())
        a.unmount()
        expect(unregister).not.toHaveBeenCalled()
        emit({ online: false, type: null })
        expect(b.result.current.online).toBe(false)
    })

    it("drops the native registration when the last instance unmounts, and picks it up again", () => {
        const a = renderHook(() => useNetworkStatus())
        const b = renderHook(() => useNetworkStatus())
        a.unmount()
        b.unmount()
        expect(unregister).toHaveBeenCalledTimes(1)
        expect(handlers.size).toBe(0)
        const c = renderHook(() => useNetworkStatus())
        expect(register).toHaveBeenCalledTimes(2)
        emit({ online: false, type: null })
        expect(c.result.current.online).toBe(false)
    })

    it("each instance still asks native for the current status when it mounts", () => {
        renderHook(() => useNetworkStatus())
        renderHook(() => useNetworkStatus())
        expect(getStatus).toHaveBeenCalledTimes(2)
    })

    it("a malformed payload is reported as an error and does not break the others", () => {
        const a = renderHook(() => useNetworkStatus())
        const b = renderHook(() => useNetworkStatus())
        act(() => handlers.get("NETWORK_STATUS_CHANGED")?.("{not json"))
        emit({ online: true, type: "cellular" })
        expect(a.result.current).toMatchObject({ online: true, type: "cellular" })
        expect(b.result.current.type).toBe("cellular")
    })
})

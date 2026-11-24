// @vitest-environment jsdom
// Outside the native app useNetworkStatus follows the browser's online/offline events; webFallback: false turns that off.
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const nativeAvailable = vi.hoisted(() => ({ value: false, getStatus: vi.fn() }))
vi.mock("../../src/native/bridge/utils/NativeBridge.js", () => ({
    default: { isAvailable: () => nativeAvailable.value, network: { getStatus: () => nativeAvailable.getStatus() } },
}))

import { useNetworkStatus } from "../../src/native/bridge/hooks/useNetworkStatus"

afterEach(() => {
    cleanup()
    nativeAvailable.value = false
    delete (window as any).WebBridge
})

describe("useNetworkStatus on the web", () => {
    it("starts from navigator.onLine and follows online/offline events", () => {
        const { result } = renderHook(() => useNetworkStatus())
        expect(result.current.isWeb).toBe(true)
        expect(result.current.webFallbackActive).toBe(true)
        act(() => { window.dispatchEvent(new Event("offline")) })
        expect(result.current.online).toBe(false)
        act(() => { window.dispatchEvent(new Event("online")) })
        expect(result.current.online).toBe(true)
        expect(result.current.type).toBeNull()
    })

    it("ignores browser events when webFallback is false", () => {
        const { result } = renderHook(() => useNetworkStatus({ webFallback: false }))
        expect(result.current.webFallbackDisabled).toBe(true)
        const before = result.current.online
        act(() => { window.dispatchEvent(new Event("offline")) })
        expect(result.current.online).toBe(before)
    })

    it("reports a failure when the native status request throws", () => {
        nativeAvailable.value = true
        ;(window as any).WebBridge = { register: vi.fn(), unregister: vi.fn() }
        nativeAvailable.getStatus.mockImplementation(() => { throw new Error("bridge down") })
        const { result } = renderHook(() => useNetworkStatus())
        expect(result.current.error).toBe("bridge down")
        nativeAvailable.getStatus.mockImplementation(() => { throw new Error("") })
        cleanup()
        const again = renderHook(() => useNetworkStatus())
        expect(again.result.current.error).toBe("Network status unavailable")
    })
})

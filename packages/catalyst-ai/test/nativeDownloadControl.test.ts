// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"

const mod = import("../src/nativeDownloadControl.js")
const transport = import("../src/nativeTransport.js")

describe("nextDownloadCommand", () => {
    it("pauses when it goes offline and resumes when it returns, otherwise stays quiet", async () => {
        const { nextDownloadCommand } = await mod
        expect(nextDownloadCommand({ online: false, paused: false })).toBe("pause")
        expect(nextDownloadCommand({ online: false, paused: true })).toBeNull()
        expect(nextDownloadCommand({ online: true, paused: true })).toBe("resume")
        expect(nextDownloadCommand({ online: true, paused: false })).toBeNull()
        expect(nextDownloadCommand({ online: undefined, paused: true })).toBe("resume")
    })
})

describe("pauseNativeDownload / resumeNativeDownload (feature detection)", () => {
    afterEach(() => {
        delete (globalThis as any).NativeBridge
        delete (globalThis as any).webkit
        delete (globalThis as any).CatalystPlugins
    })

    it("calls the Android JavascriptInterface when the build has it", async () => {
        const { pauseNativeDownload, resumeNativeDownload } = await transport
        const nb = { initAI: vi.fn(), pauseAIDownload: vi.fn(), resumeAIDownload: vi.fn() }
        ;(globalThis as any).NativeBridge = nb
        expect(pauseNativeDownload("offline")).toBe(true)
        expect(nb.pauseAIDownload).toHaveBeenCalledWith("offline")
        expect(resumeNativeDownload()).toBe(true)
        expect(nb.resumeAIDownload).toHaveBeenCalled()
    })

    it("does nothing on an older Android build without the methods", async () => {
        const { pauseNativeDownload, resumeNativeDownload } = await transport
        ;(globalThis as any).NativeBridge = { initAI: vi.fn() }
        expect(pauseNativeDownload()).toBe(false)
        expect(resumeNativeDownload()).toBe(false)
    })

    it("posts to the iOS plugin only when its manifest lists the command", async () => {
        const { pauseNativeDownload, resumeNativeDownload } = await transport
        const postMessage = vi.fn()
        ;(globalThis as any).webkit = { messageHandlers: { PluginBridge: { postMessage } } }
        ;(globalThis as any).CatalystPlugins = { "io.catalyst.ai": ["initAI", "clearConversation", "pauseDownload", "resumeDownload"] }
        expect(pauseNativeDownload("offline")).toBe(true)
        expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "io.catalyst.ai", command: "pauseDownload", data: { reason: "offline" } }))
        expect(resumeNativeDownload()).toBe(true)
        expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ command: "resumeDownload" }))

        postMessage.mockClear()
        ;(globalThis as any).CatalystPlugins = { "io.catalyst.ai": ["initAI", "clearConversation"] } // an older build
        expect(pauseNativeDownload()).toBe(false)
        expect(postMessage).not.toHaveBeenCalled()
    })

    it("does nothing at all without a native AI module", async () => {
        const { pauseNativeDownload, resumeNativeDownload } = await transport
        expect(pauseNativeDownload()).toBe(false)
        expect(resumeNativeDownload()).toBe(false)
    })
})

describe("useNativeDownloadControl", () => {
    const nb = () => ({ initAI: vi.fn(), pauseAIDownload: vi.fn(), resumeAIDownload: vi.fn() })
    afterEach(() => { delete (globalThis as any).NativeBridge })

    it("pauses on offline, resumes on online, one command per change", async () => {
        const { useNativeDownloadControl } = await mod
        const bridge = nb()
        ;(globalThis as any).NativeBridge = bridge
        const { rerender } = renderHook((p: { online: boolean }) => useNativeDownloadControl({ active: true, network: { online: p.online } }), { initialProps: { online: true } })
        expect(bridge.pauseAIDownload).not.toHaveBeenCalled()
        rerender({ online: false })
        expect(bridge.pauseAIDownload).toHaveBeenCalledTimes(1)
        rerender({ online: false })
        expect(bridge.pauseAIDownload).toHaveBeenCalledTimes(1)
        rerender({ online: true })
        expect(bridge.resumeAIDownload).toHaveBeenCalledTimes(1)
        rerender({ online: true })
        expect(bridge.resumeAIDownload).toHaveBeenCalledTimes(1)
    })

    it("pauses at once when it mounts already offline", async () => {
        const { useNativeDownloadControl } = await mod
        const bridge = nb()
        ;(globalThis as any).NativeBridge = bridge
        renderHook(() => useNativeDownloadControl({ active: true, network: { online: false } }))
        expect(bridge.pauseAIDownload).toHaveBeenCalledWith("offline")
    })

    it("does not touch a download that is not running (model ready or native AI off)", async () => {
        const { useNativeDownloadControl } = await mod
        const bridge = nb()
        ;(globalThis as any).NativeBridge = bridge
        renderHook(() => useNativeDownloadControl({ active: false, network: { online: false } }))
        expect(bridge.pauseAIDownload).not.toHaveBeenCalled()
    })

    it("does nothing when the caller does not track the network", async () => {
        const { useNativeDownloadControl } = await mod
        const bridge = nb()
        ;(globalThis as any).NativeBridge = bridge
        renderHook(() => useNativeDownloadControl({ active: true, network: undefined }))
        expect(bridge.pauseAIDownload).not.toHaveBeenCalled()
        expect(bridge.resumeAIDownload).not.toHaveBeenCalled()
    })

    it("still resumes our own pause when the model becomes ready while offline", async () => {
        const { useNativeDownloadControl } = await mod
        const bridge = nb()
        ;(globalThis as any).NativeBridge = bridge
        const { rerender } = renderHook((p: { active: boolean; online: boolean }) => useNativeDownloadControl({ active: p.active, network: { online: p.online } }), { initialProps: { active: true, online: false } })
        expect(bridge.pauseAIDownload).toHaveBeenCalledTimes(1)
        rerender({ active: false, online: true })
        expect(bridge.resumeAIDownload).toHaveBeenCalledTimes(1)
    })

    it("leaving the page does not leave the shared download paused", async () => {
        const { useNativeDownloadControl } = await mod
        const bridge = nb()
        ;(globalThis as any).NativeBridge = bridge
        const { unmount } = renderHook(() => useNativeDownloadControl({ active: true, network: { online: false } }))
        unmount()
        expect(bridge.resumeAIDownload).toHaveBeenCalledTimes(1)
    })

    it("a build without the commands is tolerated (no pause happened, so nothing to undo)", async () => {
        const { useNativeDownloadControl } = await mod
        const bridge = { initAI: vi.fn() }
        ;(globalThis as any).NativeBridge = bridge
        const { unmount } = renderHook(() => useNativeDownloadControl({ active: true, network: { online: false } }))
        expect(() => unmount()).not.toThrow()
    })
})

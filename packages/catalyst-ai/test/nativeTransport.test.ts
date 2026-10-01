// Platform-aware native AI transport (src/nativeTransport.js). The browser globals are faked per test:
// Android exposes window.NativeBridge (JavascriptInterface); iOS exposes the PluginBridge message handler
// plus the window.CatalystPlugins manifest that catalyst-core's iOS shell injects at document start.
const transport = import("../src/nativeTransport.js")

type FakeWindow = Record<string, any>
const setWindow = (value: FakeWindow | undefined) => {
    ;(globalThis as any).window = value
}

afterEach(() => setWindow(undefined))

const iosWindow = (plugins: Record<string, string[]> | undefined) => {
    const postMessage = vi.fn()
    const win: FakeWindow = { webkit: { messageHandlers: { PluginBridge: { postMessage } } } }
    if (plugins) win.CatalystPlugins = plugins
    return { win, postMessage }
}

describe("getNativeAIPlatform / isNativeAIAvailable", () => {
    it("is unavailable outside a browser", async () => {
        const t = await transport
        setWindow(undefined)
        expect(t.getNativeAIPlatform()).toBeNull()
        expect(t.isNativeAIAvailable()).toBe(false)
    })

    it("android: detected by NativeBridge.initAI; availability comes from isAIAvailable()", async () => {
        const t = await transport
        setWindow({ NativeBridge: { initAI: vi.fn(), isAIAvailable: () => true } })
        expect(t.getNativeAIPlatform()).toBe("android")
        expect(t.isNativeAIAvailable()).toBe(true)

        setWindow({ NativeBridge: { initAI: vi.fn(), isAIAvailable: () => false } })
        expect(t.isNativeAIAvailable()).toBe(false)
    })

    it("ios: available only when the AI plugin is in the injected manifest", async () => {
        const t = await transport
        setWindow(iosWindow({ "io.catalyst.ai": ["initAI", "clearConversation"] }).win)
        expect(t.getNativeAIPlatform()).toBe("ios")
        expect(t.isNativeAIAvailable()).toBe(true)
    })

    it("ios: not available when the plugin was not composed into the build", async () => {
        const t = await transport
        setWindow(iosWindow({ "io.catalyst.device_info": ["getDeviceInfo"] }).win)
        expect(t.getNativeAIPlatform()).toBeNull()
        expect(t.isNativeAIAvailable()).toBe(false)

        setWindow(iosWindow(undefined).win)
        expect(t.isNativeAIAvailable()).toBe(false)
    })
})

describe("initNativeAI / clearNativeConversation", () => {
    it("android: passes JSON string to NativeBridge.initAI", async () => {
        const t = await transport
        const initAI = vi.fn()
        const clearNativeConversation = vi.fn()
        setWindow({ NativeBridge: { initAI, clearNativeConversation } })

        expect(t.initNativeAI({ systemPrompt: "hi" })).toBe(true)
        expect(initAI).toHaveBeenCalledWith(JSON.stringify({ systemPrompt: "hi" }))

        t.clearNativeConversation()
        expect(clearNativeConversation).toHaveBeenCalledTimes(1)
    })

    it("ios: posts a PluginBridge message addressed to io.catalyst.ai with a requestId", async () => {
        const t = await transport
        const { win, postMessage } = iosWindow({ "io.catalyst.ai": ["initAI", "clearConversation"] })
        setWindow(win)

        expect(t.initNativeAI({ attachmentComponents: { Card: {} }, systemPrompt: "hi" })).toBe(true)
        expect(postMessage).toHaveBeenCalledWith({
            pluginId: "io.catalyst.ai",
            command: "initAI",
            data: { attachmentComponents: { Card: {} }, systemPrompt: "hi" },
            requestId: expect.stringMatching(/^catalyst_ai_\d+_\d+$/),
        })

        t.clearNativeConversation()
        expect(postMessage).toHaveBeenLastCalledWith(
            expect.objectContaining({ pluginId: "io.catalyst.ai", command: "clearConversation", data: null })
        )
    })

    it("does nothing and reports false when no native AI module exists", async () => {
        const t = await transport
        setWindow({})
        expect(t.initNativeAI({})).toBe(false)
        expect(() => t.clearNativeConversation()).not.toThrow()
    })
})

describe("describeNativeAIUnavailable", () => {
    it("tells iOS developers to enable ai and rebuild", async () => {
        const t = await transport
        setWindow(iosWindow(undefined).win)
        expect(t.describeNativeAIUnavailable()).toMatch(/ai\.enabled/)
    })

    it("keeps the Android guidance otherwise", async () => {
        const t = await transport
        setWindow({})
        expect(t.describeNativeAIUnavailable()).toMatch(/NativeBridge\.initAI/)
    })
})

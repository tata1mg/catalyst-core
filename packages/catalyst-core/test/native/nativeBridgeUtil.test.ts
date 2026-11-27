// @vitest-environment jsdom
// NativeBridgeUtil: platform detection, command validation, and the exact command + payload each helper sends on
// Android (window.NativeBridge methods) and iOS (webkit message handler).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NativeBridgeUtil } from "../../src/native/bridge/utils/NativeBridge"
import { NATIVE_COMMANDS } from "../../src/native/bridge/constants/NativeInterfaces"

const win: any = globalThis
const C: any = NATIVE_COMMANDS

/** Android bridge where every command is a spy. */
function androidBridge() {
    const bridge: Record<string, any> = {}
    for (const name of Object.values(C) as string[]) bridge[name] = vi.fn()
    win.NativeBridge = bridge
    return bridge
}
function iosBridge() {
    const postMessage = vi.fn()
    win.webkit = { messageHandlers: { NativeBridge: { postMessage } } }
    return postMessage
}

beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "group").mockImplementation(() => {})
    vi.spyOn(console, "groupEnd").mockImplementation(() => {})
})
afterEach(() => {
    delete win.NativeBridge
    delete win.webkit
    vi.restoreAllMocks()
})

// [label, call, command, data sent]
const CALLS: Array<[string, (b: any) => any, string, any]> = [
    ["videoStream.start", (b) => b.videoStream.start({ facing: "back" }), "START_VIDEO_STREAM", { facing: "back" }],
    ["videoStream.stop", (b) => b.videoStream.stop(), "STOP_VIDEO_STREAM", null],
    ["videoStream.setZoom", (b) => b.videoStream.setZoom(2), "SET_VIDEO_STREAM_ZOOM", "2"],
    ["videoStream.setTorch", (b) => b.videoStream.setTorch(1), "SET_VIDEO_STREAM_TORCH", JSON.stringify({ on: true })],
    ["videoStream.setFps", (b) => b.videoStream.setFps(15), "SET_VIDEO_STREAM_FPS", JSON.stringify({ min: 15, max: null })],
    ["videoStream.flip", (b) => b.videoStream.flip(), "FLIP_VIDEO_STREAM", null],
    ["camera.open", (b) => b.camera.open('{"q":1}'), "OPEN_CAMERA", '{"q":1}'],
    ["camera.requestPermission", (b) => b.camera.requestPermission(), "REQUEST_CAMERA_PERMISSION", null],
    ["file.pick default", (b) => b.file.pick(), "PICK_FILE", "*/*"],
    ["file.pick null", (b) => b.file.pick(null), "PICK_FILE", "*/*"],
    ["file.pick blank string", (b) => b.file.pick("  "), "PICK_FILE", "*/*"],
    ["file.pick mime string", (b) => b.file.pick("image/png"), "PICK_FILE", "image/png"],
    ["file.pick options", (b) => b.file.pick({ multiple: true }), "PICK_FILE", JSON.stringify({ multiple: true, mimeType: "*/*" })],
    ["file.pick options with mime", (b) => b.file.pick({ mimeType: "audio/*" }), "PICK_FILE", JSON.stringify({ mimeType: "audio/*" })],
    ["file.openWithIntent", (b) => b.file.openWithIntent("f://x", "text/plain"), "OPEN_FILE_WITH_INTENT", "f://x|text/plain"],
    ["file.openWithIntent no mime", (b) => b.file.openWithIntent("f://x"), "OPEN_FILE_WITH_INTENT", "f://x"],
    ["file.openInBrowser", (b) => b.file.openInBrowser("https://a.b"), "OPEN_IN_BROWSER", "https://a.b"],
    ["network.getStatus", (b) => b.network.getStatus(), "GET_NETWORK_STATUS", null],
    ["haptic.feedback", (b) => b.haptic.feedback(), "REQUEST_HAPTIC_FEEDBACK", "light"],
    ["notification.scheduleLocal", (b) => b.notification.scheduleLocal({ id: 1 }), "SCHEDULE_LOCAL_NOTIFICATION", JSON.stringify({ id: 1 })],
    ["notification.cancelLocal", (b) => b.notification.cancelLocal("n1"), "CANCEL_LOCAL_NOTIFICATION", "n1"],
    ["notification.requestPermission", (b) => b.notification.requestPermission(), "REQUEST_NOTIFICATION_PERMISSION", null],
    ["notification.registerForPush", (b) => b.notification.registerForPush(), "REGISTER_FOR_PUSH_NOTIFICATIONS", null],
    ["notification.updateBadge", (b) => b.notification.updateBadge(3), "UPDATE_BADGE_COUNT", "3"],
    ["notification.subscribeToTopic", (b) => b.notification.subscribeToTopic("news"), "SUBSCRIBE_TO_TOPIC", JSON.stringify({ topic: "news" })],
    ["notification.unsubscribeFromTopic", (b) => b.notification.unsubscribeFromTopic("news"), "UNSUBSCRIBE_FROM_TOPIC", JSON.stringify({ topic: "news" })],
    ["notification.getSubscribedTopics", (b) => b.notification.getSubscribedTopics(), "GET_SUBSCRIBED_TOPICS", null],
    ["device.getDeviceInfo", (b) => b.device.getDeviceInfo(), "GET_DEVICE_INFO", null],
    ["auth.googleSignIn object", (b) => b.auth.googleSignIn({ clientId: "c" }), "GOOGLE_SIGN_IN", JSON.stringify({ clientId: "c" })],
    ["safeArea.get", (b) => b.safeArea.get(), "GET_SAFE_AREA", null],
    ["security.setScreenSecure", (b) => b.security.setScreenSecure(true), "SET_SCREEN_SECURE", JSON.stringify({ enable: true })],
    ["security.getScreenSecure", (b) => b.security.getScreenSecure(), "GET_SCREEN_SECURE", null],
    ["security.clearWebData", (b) => b.security.clearWebData(), "CLEAR_WEB_DATA", null],
    ["transition.start", (b) => b.transition.start({ type: "fade" }), "START_TRANSITION", JSON.stringify({ type: "fade" })],
    ["transition.commit", (b) => b.transition.commit(), "COMMIT_TRANSITION", null],
    ["transition.cancel", (b) => b.transition.cancel(), "CANCEL_TRANSITION", null],
]

describe("NativeBridgeUtil on Android", () => {
    it.each(CALLS)("%s calls the Android method with its payload", (_label, call, command, data) => {
        const bridge = androidBridge()
        const util = new NativeBridgeUtil()
        expect(util.isAndroid).toBe(true)
        expect(call(util)).toBe(true)
        expect(bridge[C[command]]).toHaveBeenCalledWith(data)
    })

    it("reports false when the Android bridge lacks the method, and when the method throws", () => {
        const bridge = androidBridge()
        const util = new NativeBridgeUtil()
        delete bridge[C.GET_SAFE_AREA]
        expect(util.safeArea.get()).toBe(false)
        bridge[C.GET_DEVICE_INFO] = () => { throw new Error("jni") }
        expect(util.device.getDeviceInfo()).toBe(false)
    })
})

describe("NativeBridgeUtil on iOS", () => {
    it.each(CALLS.slice(0, 12))("%s posts { command, data } to the webkit handler", (_label, call, command, data) => {
        const post = iosBridge()
        const util = new NativeBridgeUtil()
        expect(util.isIOS).toBe(true)
        expect(call(util)).toBe(true)
        expect(post).toHaveBeenCalledWith({ command: C[command], data })
    })

    it("rethrows when postMessage fails", () => {
        const post = iosBridge()
        post.mockImplementation(() => { throw new Error("webkit") })
        expect(() => new NativeBridgeUtil().network.getStatus()).toThrow("webkit")
    })
})

describe("validation, environment and helpers", () => {
    it("throws for a missing command, an unknown command, and when no bridge exists", () => {
        androidBridge()
        const util = new NativeBridgeUtil()
        expect(() => util.call("")).toThrow("Command is required")
        expect(() => util.call("NOPE")).toThrow(/Invalid command: NOPE/)
        delete win.NativeBridge
        expect(() => util.call(C.GET_DEVICE_INFO)).toThrow(/Native bridge not available/)
    })

    it("warns in development mode when a command fails", () => {
        const previous = process.env.NODE_ENV
        process.env.NODE_ENV = "development"
        try {
            expect(() => new NativeBridgeUtil().call(C.GET_DEVICE_INFO)).toThrow()
            expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Development mode"))
        } finally {
            process.env.NODE_ENV = previous
        }
    })

    it("ignores an invalid zoom value and stringifies a non-object signIn payload", () => {
        const bridge = androidBridge()
        const util = new NativeBridgeUtil()
        expect(util.videoStream.setZoom(NaN)).toBe(false)
        expect(util.videoStream.setZoom(undefined as any)).toBe(false)
        expect(bridge[C.SET_VIDEO_STREAM_ZOOM]).not.toHaveBeenCalled()
        util.auth.googleSignIn("raw" as any)
        expect(bridge[C.GOOGLE_SIGN_IN]).toHaveBeenCalledWith("raw")
    })

    it("describes the environment as android, ios or web", () => {
        expect(new NativeBridgeUtil().getEnvironmentInfo()).toMatchObject({ platform: "web", isNativeEnvironment: false })
        androidBridge()
        expect(new NativeBridgeUtil().getEnvironmentInfo().platform).toBe("android")
        delete win.NativeBridge
        iosBridge()
        const ios = new NativeBridgeUtil()
        expect(ios.getEnvironmentInfo().platform).toBe("ios")
        expect(ios.isAvailable()).toBe(true)
    })

    it("testConnection logs the bridge on each platform without throwing", () => {
        androidBridge()
        expect(() => new NativeBridgeUtil().testConnection()).not.toThrow()
        delete win.NativeBridge
        iosBridge()
        expect(() => new NativeBridgeUtil().testConnection()).not.toThrow()
    })
})

// @vitest-environment jsdom
// Routing picks its on-device list from the native shell, never from the user agent: a phone browser is "web",
// a WebView build is its native platform.
import { afterEach, describe, expect, it } from "vitest"
import { resolvePlatform } from "../../src/native/bridge/hooks/aiProviders"
import { NativeBridgeUtil } from "../../src/native/bridge/utils/NativeBridge"

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"

const platformNow = () => {
    const shell = new NativeBridgeUtil()
    return resolvePlatform({ android: shell._detectAndroid(), ios: shell._detectIOS() })
}
const setUA = (ua: string) => Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true })

afterEach(() => {
    delete (window as any).NativeBridge
    delete (window as any).webkit
})

describe("platform detection for routing", () => {
    it("an iPhone Safari tab is web: the user agent says iOS but there is no native module", () => {
        setUA(IPHONE_SAFARI)
        expect(platformNow()).toBe("web")
    })

    it("an Android Chrome tab is web too", () => {
        setUA(ANDROID_CHROME)
        expect(platformNow()).toBe("web")
    })

    it("the Android WebView build is android (window.NativeBridge), whatever the user agent", () => {
        setUA("Mozilla/5.0 (X11; Linux x86_64) SomethingCustom")
        ;(window as any).NativeBridge = { initAI: () => {} }
        expect(platformNow()).toBe("android")
    })

    it("the iOS WebView build is ios (the NativeBridge message handler), whatever the user agent", () => {
        setUA("Mozilla/5.0 (X11; Linux x86_64) SomethingCustom")
        ;(window as any).webkit = { messageHandlers: { NativeBridge: { postMessage: () => {} } } }
        expect(platformNow()).toBe("ios")
    })

    it("an iOS page that only has an unrelated message handler is still web", () => {
        setUA(IPHONE_SAFARI)
        ;(window as any).webkit = { messageHandlers: { somethingElse: {} } }
        expect(platformNow()).toBe("web")
    })
})

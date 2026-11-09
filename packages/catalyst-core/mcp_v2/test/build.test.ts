// get_build_flow's appId / url / LOCAL_IP warnings, which mirror the release
// checks in src/native/nativeConfig.js (NATIVE-003 and NATIVE-001).
const { appIdentityWarnings }: typeof import("../tools/build.js") = require("../tools/build.js")

function warningsFor(wv: Record<string, unknown>, platform: "android" | "ios", isRelease = true): string[] {
    const warnings: string[] = []
    appIdentityWarnings({ wv }, isRelease, warnings, platform)
    return warnings
}

const PUBLIC = { url: "https://shop.acme.com" }
const appIdWarning = (list: string[]) => list.some((w) => /NATIVE-003/.test(w))
const hostWarning = (list: string[]) => list.some((w) => /NATIVE-001/.test(w))

describe("get_build_flow: app identity warnings", () => {
    it("flags every placeholder id the release resolver refuses", () => {
        for (const appId of [
            "com.example.shop",
            "io.yourname.androidproject",
            "com.catalyst.framework.app",
            "com.debug.webview",
            "COM.DEBUG.WEBVIEW",
        ]) {
            expect(appIdWarning(warningsFor({ ...PUBLIC, appId }, "android")), appId).toBe(true)
        }
        expect(appIdWarning(warningsFor({ ...PUBLIC }, "ios"))).toBe(true)
        expect(appIdWarning(warningsFor({ ...PUBLIC, appId: "com.acme.shop" }, "ios"))).toBe(false)
    })

    it("lets the platform key win over appId", () => {
        const wv = {
            ...PUBLIC,
            appId: "com.acme.shop",
            android: { packageName: "io.yourname.androidproject" },
            ios: { bundleIdentifier: "com.acme.iphone" },
        }
        expect(appIdWarning(warningsFor(wv, "android"))).toBe(true)
        expect(appIdWarning(warningsFor(wv, "ios"))).toBe(false)

        const realKey = { ...PUBLIC, appId: "com.example.shop", ios: { appBundleId: "com.acme.iphone" } }
        expect(appIdWarning(warningsFor(realKey, "ios"))).toBe(false)
    })

    it("trims the platform key and falls back to appId when it is blank", () => {
        const blank = {
            ...PUBLIC,
            appId: "com.acme.shop",
            android: { packageName: "  " },
            ios: { bundleIdentifier: " " },
        }
        expect(appIdWarning(warningsFor(blank, "android"))).toBe(false)
        expect(appIdWarning(warningsFor(blank, "ios"))).toBe(false)

        const padded = { ...PUBLIC, appId: "com.acme.shop", android: { packageName: " com.debug.webview " } }
        expect(appIdWarning(warningsFor(padded, "android"))).toBe(true)
    })

    it("warns a release with no url that would load this machine", () => {
        for (const LOCAL_IP of [
            undefined,
            "",
            " ",
            "localhost",
            "127.0.0.1",
            "::1",
            "[::1]",
            "0.0.0.0",
            "10.1.2.3",
            "172.16.0.5",
            "192.168.1.20",
            "169.254.10.1",
            "my-mac.local",
        ]) {
            expect(
                hostWarning(warningsFor({ appId: "com.acme.shop", LOCAL_IP }, "android")),
                String(LOCAL_IP)
            ).toBe(true)
        }
        expect(hostWarning(warningsFor({ appId: "com.acme.shop", ...PUBLIC }, "android"))).toBe(false)
        expect(hostWarning(warningsFor({ appId: "com.acme.shop", LOCAL_IP: "shop.acme.com" }, "ios"))).toBe(
            false
        )
        expect(hostWarning(warningsFor({ appId: "com.acme.shop", LOCAL_IP: "172.32.0.1" }, "ios"))).toBe(
            false
        )
        expect(
            hostWarning(
                warningsFor(
                    { appId: "com.acme.shop", LOCAL_IP: "192.168.1.20", allowPrivateHost: true },
                    "ios"
                )
            )
        ).toBe(false)
        expect(hostWarning(warningsFor({ appId: "com.acme.shop", allowPrivateHost: true }, "ios"))).toBe(
            false
        )
    })

    it("stays quiet about identity for a debug build", () => {
        const list = warningsFor({ appId: "com.example.shop" }, "android", false)
        expect(appIdWarning(list)).toBe(false)
        expect(hostWarning(list)).toBe(false)
    })
})

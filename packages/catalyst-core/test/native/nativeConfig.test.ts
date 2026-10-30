import fs from "fs"
import { createRequire } from "module"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"

import { ERROR_DEFINITIONS } from "../../src/errors/registry.js"
import {
    BUILD_NUMBER_EPOCH_MS,
    MAX_BUILD_NUMBER,
    assertReleaseHost,
    computeBuildNumber,
    computeStartUrl,
    isPlaceholderAppId,
    parseAppUrl,
    privateHostReason,
    describePrivateHost,
    resolveAppVersion,
    resolveNativeConfig,
} from "../../src/native/nativeConfig.js"
import { NATIVE_ERRORS } from "../../src/native/utils.js"

// buildIos/config.js is plain CJS with no ESM-syntax imports, so it loads with require.
const require = createRequire(import.meta.url)
const createIosConfigPhase = require("../../src/native/buildIos/config.js")

const temps: string[] = []
function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-native-config-"))
    temps.push(dir)
    return dir
}
afterEach(() => {
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const NO_LOCAL = new Set<string>()
const NOW = BUILD_NUMBER_EPOCH_MS + 1_000_000 * 60_000

function thrown(fn: () => unknown): any {
    try {
        fn()
    } catch (error) {
        return error
    }
    throw new Error("expected a throw")
}

/** Resolve with fixed time, no local addresses and a temp cwd. */
function resolve(platform: "android" | "ios", config: any, options: Record<string, any> = {}) {
    const cwd = options.cwd || tempDir()
    const resolved = resolveNativeConfig(platform, {
        config,
        cwd,
        env: {},
        now: NOW,
        localHosts: NO_LOCAL,
        ...options,
    })
    resolved.cleanup()
    return resolved
}

describe("parseAppUrl", () => {
    it("defaults the port from the scheme", () => {
        expect(parseAppUrl("https://shop.acme.com")).toEqual({
            scheme: "https",
            host: "shop.acme.com",
            port: 443,
            origin: "https://shop.acme.com",
        })
        expect(parseAppUrl("http://shop.acme.com").port).toBe(80)
        expect(parseAppUrl("http://shop.acme.com:8080/")).toMatchObject({
            port: 8080,
            origin: "http://shop.acme.com:8080",
        })
        expect(parseAppUrl("https://shop.acme.com:443").port).toBe(443)
    })

    it.each([
        ["https://shop.acme.com:8443", "port other than 443"],
        ["https://shop.acme.com/app", "origin only"],
        ["https://shop.acme.com/?a=1", "origin only"],
        ["ftp://shop.acme.com", "https://"],
        ["shop.acme.com", "not a URL"],
        ["https://user:pw@shop.acme.com", "user name"],
        ["", "empty"],
    ])("rejects %j (NATIVE-004)", (value, why) => {
        const error = thrown(() => parseAppUrl(value))
        expect(error.code).toBe("NATIVE-004")
        expect(error.message).toContain(why)
    })
})

describe("isPlaceholderAppId", () => {
    it.each([
        "com.example.myshop",
        "io.yourname.androidproject",
        "com.catalyst.framework.app",
        "com.debug.webview",
        "",
    ])("%j is a placeholder", (id) => expect(isPlaceholderAppId(id)).toBe(true))
    it("accepts a real id", () => expect(isPlaceholderAppId("com.acme.shop")).toBe(false))
})

describe("privateHostReason", () => {
    it.each([
        ["localhost", "this machine"],
        ["app.localhost", "this machine"],
        ["192.168.1.5", "a private LAN address"],
        ["10.0.0.1", "a private LAN address"],
        ["172.20.0.3", "a private LAN address"],
        ["169.254.10.1", "a link-local address"],
        ["0.0.0.0", "not a routable address"],
        ["127.0.0.1", "this machine's loopback address"],
        ["mac.local", "a .local name that only the local network resolves"],
        ["::1", "this machine's loopback address"],
        ["::", "not a routable address"],
        ["fe80::1", "a link-local address"],
        ["fd12::1", "a private LAN address"],
        ["::ffff:192.168.1.5", "a private LAN address"],
        ["example.com", "a placeholder domain reserved for examples"],
        ["www.example.com", "a placeholder domain reserved for examples"],
        ["shop.test", "a placeholder domain reserved for examples"],
    ])("%s is %s", (host, reason) => {
        expect(privateHostReason(host, { localHosts: NO_LOCAL })).toBe(reason)
        expect(describePrivateHost(host, reason)).toBe(`${host} is ${reason}`)
    })

    it("describes an empty host without a dangling subject", () => {
        expect(describePrivateHost("", privateHostReason("", { localHosts: NO_LOCAL }))).toBe(
            "the host is empty"
        )
    })

    it("accepts public hosts", () => {
        expect(privateHostReason("shop.acme.com", { localHosts: NO_LOCAL })).toBeNull()
        expect(privateHostReason("8.8.8.8", { localHosts: NO_LOCAL })).toBeNull()
    })

    it("refuses this machine's own address", () => {
        expect(privateHostReason("100.64.1.5", { localHosts: new Set(["100.64.1.5"]) })).toBe(
            "this machine's own address"
        )
    })
})

describe("assertReleaseHost", () => {
    it("throws NATIVE-001 for a private host unless allowed", () => {
        const wv = { LOCAL_IP: "192.168.1.20", port: "3005" }
        const error = thrown(() => assertReleaseHost("android", wv, { localHosts: NO_LOCAL }))
        expect(error.code).toBe("NATIVE-001")
        expect(error.message).toBe(
            "Release build points at a local or private host: http://192.168.1.20:3005/ (192.168.1.20 is a private LAN address)"
        )
        expect(
            thrown(() =>
                assertReleaseHost("ios", { LOCAL_IP: "localhost", port: "3005" }, { localHosts: NO_LOCAL })
            ).message
        ).toBe(
            "Release build points at a local or private host: http://localhost:3005/ (localhost is this machine)"
        )
        const logs: string[] = []
        const start = assertReleaseHost("android", wv, {
            allowPrivateHost: true,
            localHosts: NO_LOCAL,
            log: (message: string) => logs.push(message),
        })
        expect(start.url).toBe("http://192.168.1.20:3005/")
        expect(logs.join("\n")).toContain("allowPrivateHost")
    })

    it("builds the start URL the way each shell does", () => {
        expect(computeStartUrl("ios", { LOCAL_IP: "a.com", useHttps: true, port: 3005 }).url).toBe(
            "https://a.com:443/"
        )
        expect(computeStartUrl("android", {}, { release: true }).host).toBe("127.0.0.1")
    })
})

describe("computeBuildNumber", () => {
    it("is whole minutes since 2024-01-01T00:00:00Z", () => {
        expect(BUILD_NUMBER_EPOCH_MS).toBe(Date.parse("2024-01-01T00:00:00Z"))
        expect(computeBuildNumber({ env: {}, now: BUILD_NUMBER_EPOCH_MS + 90 * 60_000 + 59_999 })).toEqual({
            buildNumber: 90,
            buildNumberSource: "clock",
        })
        // Never 0, even at the epoch.
        expect(computeBuildNumber({ env: {}, now: BUILD_NUMBER_EPOCH_MS }).buildNumber).toBe(1)
    })

    it("takes CATALYST_BUILD_NUMBER over the clock", () => {
        expect(computeBuildNumber({ env: { CATALYST_BUILD_NUMBER: " 2026102701 " }, now: NOW })).toEqual({
            buildNumber: 2026102701,
            buildNumberSource: "CATALYST_BUILD_NUMBER",
        })
        expect(computeBuildNumber({ env: { CATALYST_BUILD_NUMBER: "" }, now: NOW }).buildNumberSource).toBe(
            "clock"
        )
    })

    it.each(["0", "-1", "1.5", "abc", String(MAX_BUILD_NUMBER + 1)])("rejects %s (NATIVE-002)", (value) => {
        expect(thrown(() => computeBuildNumber({ env: { CATALYST_BUILD_NUMBER: value } })).code).toBe(
            "NATIVE-002"
        )
    })

    it("resolveAppVersion reads the version from package.json", () => {
        const cwd = tempDir()
        fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ version: "1.4.0" }))
        expect(resolveAppVersion({ cwd, env: {}, now: NOW })).toEqual({
            versionName: "1.4.0",
            buildNumber: 1_000_000,
            buildNumberSource: "clock",
        })
        expect(resolveAppVersion({ cwd: tempDir(), env: {}, now: NOW }).versionName).toBeUndefined()
    })
})

describe("resolveNativeConfig: release", () => {
    const newShape = {
        NODE_SERVER_PORT: 3005,
        WEBVIEW_CONFIG: { appId: "com.acme.shop", appName: "Acme Shop", url: "https://shop.acme.com" },
    }

    it("turns url, appId and appName into the legacy shape the shells read", () => {
        const resolved = resolve("android", newShape, { release: true })
        expect(resolved.release).toBe(true)
        expect(resolved.startUrl).toBe("https://shop.acme.com:443/")
        expect(resolved.appId).toBe("com.acme.shop")
        expect(resolved.appName).toBe("Acme Shop")
        expect(resolved.WEBVIEW_CONFIG).toMatchObject({
            LOCAL_IP: "shop.acme.com",
            port: "443",
            useHttps: true,
            android: { packageName: "com.acme.shop", appName: "Acme Shop", buildType: "release" },
            ios: { appBundleId: "com.acme.shop", bundleIdentifier: "com.acme.shop", appName: "Acme Shop" },
        })
        for (const key of ["url", "appId", "appName", "allowPrivateHost", "release"]) {
            expect(resolved.WEBVIEW_CONFIG).not.toHaveProperty(key)
        }
        expect(resolved.version.buildNumber).toBe(1_000_000)
    })

    it("lets --url override WEBVIEW_CONFIG.url", () => {
        const resolved = resolve("ios", newShape, { release: true, url: "https://staging.acme.com" })
        expect(resolved.WEBVIEW_CONFIG.LOCAL_IP).toBe("staging.acme.com")
    })

    it("keeps the legacy LOCAL_IP, port and useHttps when url is absent", () => {
        const resolved = resolve(
            "android",
            {
                WEBVIEW_CONFIG: {
                    LOCAL_IP: "shop.acme.com",
                    port: 443,
                    useHttps: true,
                    android: { packageName: "com.acme.shop" },
                },
            },
            { release: true }
        )
        expect(resolved.startUrl).toBe("https://shop.acme.com:443/")
        expect(resolved.appId).toBe("com.acme.shop")
    })

    it("prefers appId over the platform keys", () => {
        const resolved = resolve(
            "ios",
            { WEBVIEW_CONFIG: { ...newShape.WEBVIEW_CONFIG, ios: { appBundleId: "com.old.id" } } },
            { release: true }
        )
        expect(resolved.appId).toBe("com.acme.shop")
        expect(resolved.WEBVIEW_CONFIG.ios.appBundleId).toBe("com.acme.shop")
    })

    it("reads the iOS id from bundleIdentifier, then appBundleId, and ships that one everywhere", () => {
        const wv = { url: "https://shop.acme.com" }
        // Shared.xcconfig has always set PRODUCT_BUNDLE_IDENTIFIER from
        // bundleIdentifier first; the guard checks that id, and simctl uses it too.
        const both = resolve(
            "ios",
            { WEBVIEW_CONFIG: { ...wv, ios: { appBundleId: "com.a.b", bundleIdentifier: "com.c.d" } } },
            { release: true }
        )
        expect(both.appId).toBe("com.c.d")
        expect(both.WEBVIEW_CONFIG.ios).toMatchObject({ appBundleId: "com.c.d", bundleIdentifier: "com.c.d" })
        expect(
            resolve("ios", { WEBVIEW_CONFIG: { ...wv, ios: { appBundleId: "com.a.b" } } }, { release: true })
                .appId
        ).toBe("com.a.b")
        // A placeholder in the id that ships is caught even when the other key is real.
        const shipsPlaceholder = {
            WEBVIEW_CONFIG: {
                ...wv,
                ios: { appBundleId: "com.acme.shop", bundleIdentifier: "com.example.shop" },
            },
        }
        expect(thrown(() => resolve("ios", shipsPlaceholder, { release: true })).code).toBe("NATIVE-003")
    })

    it("refuses an app id that is not valid for the platform (NATIVE-010)", () => {
        const wv = (appId: string) => ({ WEBVIEW_CONFIG: { appId, url: "https://shop.acme.com" } })
        for (const bad of [
            "shop",
            "com..shop",
            "com.acme.1shop",
            "com.acme.my-shop",
            "com.new.shop",
            'com.acme.x"$(id)',
        ]) {
            const error = thrown(() => resolve("android", wv(bad)))
            expect(error.code, bad).toBe("NATIVE-010")
        }
        for (const bad of ["shop", "com.acme.my_shop", "com.acme.sh op"]) {
            expect(thrown(() => resolve("ios", wv(bad))).code, bad).toBe("NATIVE-010")
        }
        // Valid per platform: Java allows _, Apple allows - and a leading digit.
        expect(resolve("android", wv("com.acme.my_shop2")).appId).toBe("com.acme.my_shop2")
        expect(resolve("ios", wv("com.1mg.my-shop")).appId).toBe("com.1mg.my-shop")
        // Shipped per-platform keys are checked the same way.
        const legacy = { WEBVIEW_CONFIG: { android: { packageName: "com.acme.class" } } }
        expect(thrown(() => resolve("android", legacy)).code).toBe("NATIVE-010")
    })

    it("keeps the shipped ios.version for iOS, with a deprecation warning", () => {
        const cwd = tempDir()
        fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ version: "1.0.0" }))
        const config = {
            WEBVIEW_CONFIG: {
                ...newShape.WEBVIEW_CONFIG,
                ios: { version: { major: 3, minor: 4, buildNumber: 87 } },
            },
        }
        const logs: string[] = []
        const resolved = resolve("ios", config, { release: true, cwd, log: (m: string) => logs.push(m) })
        expect(resolved.version).toEqual({
            versionName: "3.4.0",
            buildNumber: 87,
            buildNumberSource: "ios.version",
        })
        expect(logs.join("\n")).toMatch(/ios\.version is deprecated.*package\.json.*CATALYST_BUILD_NUMBER/)

        // CATALYST_BUILD_NUMBER still wins; no buildNumber means the clock.
        expect(
            resolve("ios", config, { release: true, cwd, env: { CATALYST_BUILD_NUMBER: "90" } }).version
        ).toMatchObject({ versionName: "3.4.0", buildNumber: 90, buildNumberSource: "CATALYST_BUILD_NUMBER" })
        const noBuild = { WEBVIEW_CONFIG: { ...newShape.WEBVIEW_CONFIG, ios: { version: { major: 2 } } } }
        expect(resolve("ios", noBuild, { release: true, cwd }).version).toMatchObject({
            versionName: "2.0.0",
            buildNumber: 1_000_000,
            buildNumberSource: "clock",
        })
        // Android never had a version object: package.json applies.
        expect(resolve("android", config, { release: true, cwd }).version.versionName).toBe("1.0.0")
    })

    it("refuses a placeholder or missing app id (NATIVE-003)", () => {
        const placeholder = { WEBVIEW_CONFIG: { appId: "com.example.myshop", url: "https://shop.acme.com" } }
        expect(thrown(() => resolve("android", placeholder, { release: true })).code).toBe("NATIVE-003")
        const missing = { WEBVIEW_CONFIG: { url: "https://shop.acme.com" } }
        const error = thrown(() => resolve("ios", missing, { release: true }))
        expect(error.code).toBe("NATIVE-003")
        expect(error.message).toContain("com.catalyst.framework.app")
    })

    it("refuses a private or placeholder host (NATIVE-001), and allowPrivateHost downgrades it", () => {
        const lan = { WEBVIEW_CONFIG: { appId: "com.acme.shop", url: "http://192.168.1.4:3005" } }
        expect(thrown(() => resolve("android", lan, { release: true })).code).toBe("NATIVE-001")
        const placeholder = { WEBVIEW_CONFIG: { appId: "com.acme.shop", url: "https://www.example.com" } }
        expect(thrown(() => resolve("android", placeholder, { release: true })).code).toBe("NATIVE-001")
        const allowed = resolve(
            "android",
            { WEBVIEW_CONFIG: { ...lan.WEBVIEW_CONFIG, allowPrivateHost: true } },
            { release: true }
        )
        expect(allowed.startUrl).toBe("http://192.168.1.4:3005/")
        expect(allowed.WEBVIEW_CONFIG).not.toHaveProperty("allowPrivateHost")
    })

    it("refuses a release with no production URL at all", () => {
        expect(
            thrown(() =>
                resolve("android", { WEBVIEW_CONFIG: { appId: "com.acme.shop" } }, { release: true })
            ).code
        ).toBe("NATIVE-001")
    })

    it("treats buildType release as a release, with a deprecation warning", () => {
        const logs: string[] = []
        const resolved = resolve(
            "android",
            { WEBVIEW_CONFIG: { ...newShape.WEBVIEW_CONFIG, android: { buildType: "release" } } },
            { log: (message: string) => logs.push(message) }
        )
        expect(resolved.release).toBe(true)
        expect(logs.join("\n")).toMatch(/deprecated.*--release/)
    })

    it("writes the resolved config to a private temp file", () => {
        const resolved = resolveNativeConfig("android", {
            config: newShape,
            cwd: tempDir(),
            env: {},
            now: NOW,
            localHosts: NO_LOCAL,
            release: true,
        })
        try {
            expect(fs.statSync(resolved.configPath).mode & 0o777).toBe(0o600)
            expect(JSON.parse(fs.readFileSync(resolved.configPath, "utf8")).WEBVIEW_CONFIG.LOCAL_IP).toBe(
                "shop.acme.com"
            )
        } finally {
            resolved.cleanup()
        }
        expect(fs.existsSync(resolved.configPath)).toBe(false)
    })
})

describe("resolveNativeConfig: debug", () => {
    const config = {
        NODE_SERVER_PORT: 3006,
        WEBVIEW_CONFIG: {
            appId: "com.example.myshop",
            url: "https://shop.acme.com",
            apiBaseUrl: "https://shop.acme.com/api/",
            accessControl: { enabled: true, allowedUrls: ["https://shop.acme.com/*"] },
            android: {},
        },
    }

    it("loads the dev server on the caller's host and ignores url", () => {
        const resolved = resolve("android", config)
        expect(resolved.release).toBe(false)
        expect(resolved.usesDevServer).toBe(true)
        expect(resolved.devOrigin).toBe("http://localhost:3006")
        expect(resolved.startUrl).toBe("http://localhost:3006/")
        expect(resolved.WEBVIEW_CONFIG).toMatchObject({
            LOCAL_IP: "localhost",
            port: "3006",
            useHttps: false,
        })
        expect(resolved.WEBVIEW_CONFIG.android.buildType).toBe("debug")
    })

    it("does not refuse a placeholder app id in debug", () => {
        expect(resolve("ios", config).appId).toBe("com.example.myshop")
    })

    it("adds the dev origin to allowedUrls and remaps apiBaseUrl in the resolved config only", () => {
        const resolved = resolve("ios", config, { devHost: "jane-mac.local" })
        expect(resolved.WEBVIEW_CONFIG.accessControl.allowedUrls).toEqual([
            "https://shop.acme.com/*",
            "http://jane-mac.local:3006",
            "http://jane-mac.local:3006/*",
        ])
        expect(resolved.WEBVIEW_CONFIG.apiBaseUrl).toBe("http://jane-mac.local:3006/api/")
        expect(config.WEBVIEW_CONFIG.accessControl.allowedUrls).toEqual(["https://shop.acme.com/*"])
    })

    it("keeps a comma-separated allowedUrls string a string", () => {
        const resolved = resolve("android", {
            WEBVIEW_CONFIG: {
                port: "3005",
                accessControl: { enabled: true, allowedUrls: "https://a.com/*, https://b.com/*" },
            },
        })
        expect(resolved.WEBVIEW_CONFIG.accessControl.allowedUrls).toBe(
            "https://a.com/*,https://b.com/*,http://localhost:3005,http://localhost:3005/*"
        )
    })

    it("points a localhost apiBaseUrl at a device host", () => {
        const resolved = resolve(
            "ios",
            { WEBVIEW_CONFIG: { port: "3005", apiBaseUrl: "http://localhost:8080/api" } },
            { devHost: "jane-mac.local" }
        )
        expect(resolved.WEBVIEW_CONFIG.apiBaseUrl).toBe("http://jane-mac.local:8080/api")
    })

    it("keeps a legacy public LOCAL_IP with a warning and no dev server", () => {
        const logs: string[] = []
        const resolved = resolve(
            "android",
            { WEBVIEW_CONFIG: { LOCAL_IP: "shop.acme.com", port: "443", useHttps: true } },
            { log: (message: string) => logs.push(message) }
        )
        expect(resolved.usesDevServer).toBe(false)
        expect(resolved.WEBVIEW_CONFIG.LOCAL_IP).toBe("shop.acme.com")
        expect(logs.join("\n")).toContain("WEBVIEW_CONFIG.url")
    })

    it("replaces a LAN LOCAL_IP saved by an older setup with the dev host", () => {
        const resolved = resolve("android", { WEBVIEW_CONFIG: { LOCAL_IP: "192.168.1.20", port: "3005" } })
        expect(resolved.WEBVIEW_CONFIG.LOCAL_IP).toBe("localhost")
    })

    it("fills platform blocks that are missing", () => {
        const resolved = resolve("ios", { WEBVIEW_CONFIG: { appId: "com.acme.shop" } })
        expect(resolved.WEBVIEW_CONFIG.ios).toMatchObject({
            appBundleId: "com.acme.shop",
            buildType: "debug",
        })
        expect(resolved.WEBVIEW_CONFIG.android).toMatchObject({ packageName: "com.acme.shop" })
    })
})

describe("NATIVE_ERRORS", () => {
    it("matches the registry for every copied code", () => {
        for (const [code, entry] of Object.entries(NATIVE_ERRORS)) {
            const def = (ERROR_DEFINITIONS as Record<string, any>)[code]
            expect(def, code).toBeDefined()
            expect(entry.message, code).toBe(def.defaultMessage)
            expect(entry.hint, code).toBe(def.suggestedAction)
        }
    })

    it("copies every NATIVE code", () => {
        const nativeCodes = Object.keys(ERROR_DEFINITIONS).filter((code) => code.startsWith("NATIVE-"))
        expect(nativeCodes.length).toBeGreaterThan(0)
        for (const code of nativeCodes) expect(NATIVE_ERRORS, code).toHaveProperty(code)
    })
})

describe("iOS ConfigConstants", () => {
    it("never emits the resolver-only keys (url, appId, appName, allowPrivateHost)", async () => {
        const resolved = resolve(
            "ios",
            {
                WEBVIEW_CONFIG: {
                    url: "https://shop.acme.com",
                    appId: "com.acme.shop",
                    appName: "Acme Shop",
                    allowPrivateHost: false,
                    ios: {},
                },
            },
            { release: true }
        )
        const projectDir = tempDir()
        const progress = { start() {}, complete() {}, fail() {}, log() {} }
        const { generateConfigConstants } = createIosConfigPhase({
            WEBVIEW_CONFIG: resolved.WEBVIEW_CONFIG,
            iosConfig: resolved.WEBVIEW_CONFIG.ios,
            PROJECT_DIR: projectDir,
            PUBLIC_PATH: tempDir(),
            url: "https://shop.acme.com",
            progress,
        })
        await generateConfigConstants()
        const swift = fs.readFileSync(
            path.join(
                projectDir,
                "CoreLogic",
                "Sources",
                "CatalystCoreLogic",
                "Constants",
                "ConfigConstants.swift"
            ),
            "utf8"
        )
        // One url: the start URL the build passes in, not a second from config.
        expect(swift.match(/static let url\b/g)).toHaveLength(1)
        expect(swift).not.toMatch(/static let (appId|allowPrivateHost)\b/)
        expect(swift).toContain('public static let LOCAL_IP = "shop.acme.com"')
    })
})

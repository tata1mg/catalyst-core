import fs from "fs"
import { createRequire } from "module"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"

// The CJS build phase loads with require, as in iosSigning.test.ts.
const require = createRequire(import.meta.url)
const createIosConfigPhase = require("../../src/native/buildIos/config.js")

const temps: string[] = []
function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-ios-config-phase-"))
    temps.push(dir)
    return dir
}

afterEach(() => {
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function rejection(promise: Promise<unknown>): Promise<any> {
    try {
        await promise
    } catch (error) {
        return error
    }
    throw new Error("expected a rejection")
}

type Log = { message: string; type?: string }

function recordingProgress() {
    const logs: Log[] = []
    const events: string[] = []
    return {
        logs,
        events,
        progress: {
            start: (step: string) => events.push(`start:${step}`),
            complete: (step: string) => events.push(`complete:${step}`),
            fail: (step: string, message: string) => events.push(`fail:${step}:${message}`),
            log: (message: string, type?: string) => logs.push({ message, type }),
            status: (message: string) => events.push(`status:${message}`),
        },
    }
}

const CONSTANTS_PATH = ["CoreLogic", "Sources", "CatalystCoreLogic", "Constants", "ConfigConstants.swift"]

/** Run generateConfigConstants and return the Swift it wrote, plus the logs. */
async function constants(
    WEBVIEW_CONFIG: Record<string, any>,
    {
        iosConfig = WEBVIEW_CONFIG.ios || {},
        publicPath = tempDir(),
    }: { iosConfig?: any; publicPath?: string } = {}
) {
    const projectDir = tempDir()
    const recorder = recordingProgress()
    const { generateConfigConstants } = createIosConfigPhase({
        WEBVIEW_CONFIG,
        iosConfig,
        PROJECT_DIR: projectDir,
        PUBLIC_PATH: publicPath,
        url: "https://shop.acme.com/",
        progress: recorder.progress,
    })
    await generateConfigConstants()
    const swift = fs.readFileSync(path.join(projectDir, ...CONSTANTS_PATH), "utf8")
    return { swift, ...recorder }
}

describe("generateConfigConstants: Swift properties", () => {
    it("types each array by its first element and keeps empty arrays as [String]", async () => {
        const { swift } = await constants({
            tags: ["a", "b"],
            ports: [80, 443],
            ratios: [0.5, 1.5],
            flags: [true, false],
            objects: [{ id: 1 }],
            none: [],
            ios: {},
        })
        expect(swift).toContain('    public static let tags: [String] = ["a", "b"]')
        expect(swift).toContain("    public static let ports: [Int] = [80, 443]")
        expect(swift).toContain("    public static let ratios: [Double] = [0.5, 1.5]")
        expect(swift).toContain("    public static let flags: [Bool] = [true, false]")
        expect(swift).toContain('    public static let objects: [String] = ["[object Object]"]')
        expect(swift).toContain("    public static let none: [String] = []")
    })

    it("emits scalars, nil for null, and nested objects as enums", async () => {
        const { swift } = await constants({
            title: "Shop",
            port: 3005,
            debug: true,
            missing: null,
            theme: { primary: "#000", spacing: { small: 4 } },
            ios: {},
        })
        expect(swift).toContain('    public static let title = "Shop"')
        expect(swift).toContain("    public static let port = 3005")
        expect(swift).toContain("    public static let debug = true")
        expect(swift).toContain("    public static let missing: String? = nil")
        expect(swift).toContain(
            [
                "    public enum Theme {",
                '        public static let primary = "#000"',
                "        public enum Spacing {",
                "            public static let small = 4",
                "        }",
                "    }",
            ].join("\n")
        )
    })

    it("always types cachePattern as [String], from a string or an array", async () => {
        const single = await constants({ ios: { cachePattern: "*.png" } })
        expect(single.swift).toContain('    public static let cachePattern: [String] = ["*.png"]')
        expect(single.logs.map((l) => l.message)).not.toContain(
            "cachePattern not found in config, adding default (no patterns)"
        )

        const many = await constants({ ios: { cachePattern: ["*.png", "*.css"] } })
        expect(many.swift).toContain('    public static let cachePattern: [String] = ["*.png", "*.css"]')
    })

    it("falls back to a quoted string for a value of another type", async () => {
        const { swift } = await constants({ big: BigInt(7), ios: {} })
        expect(swift).toContain('    public static let big = "7"')
    })

    it("adds the iOS keys after the shared ones, skipping build-only and duplicate keys", async () => {
        const { swift } = await constants({
            theme: "light",
            ios: { theme: "dark", appName: "Acme", ascApiKey: "secret", exportMethod: "debugging" },
        })
        expect(swift).toContain('    public static let theme = "light"')
        expect(swift).not.toContain('theme = "dark"')
        expect(swift).toContain("    // iOS-specific configuration")
        expect(swift).toContain('    public static let appName = "Acme"')
        expect(swift).not.toMatch(/ascApiKey|exportMethod|secret/)
    })
})

describe("generateConfigConstants: access control", () => {
    it("emits the allowed URLs from an array", async () => {
        const { swift } = await constants({
            accessControl: { enabled: true, allowedUrls: ["https://a.com/*", "https://b.com/*"] },
            ios: {},
        })
        expect(swift).toContain("    public static let accessControlEnabled = true")
        expect(swift).toContain(
            '    public static let allowedUrls: [String] = ["https://a.com/*", "https://b.com/*"]'
        )
    })

    it("splits a comma-separated string and drops empty entries", async () => {
        const { swift } = await constants({
            accessControl: { allowedUrls: " https://a.com/* , ,https://b.com/* ," },
            ios: {},
        })
        expect(swift).toContain("    public static let accessControlEnabled = false")
        expect(swift).toContain(
            '    public static let allowedUrls: [String] = ["https://a.com/*", "https://b.com/*"]'
        )
    })

    it("is disabled with no URLs when not configured", async () => {
        const { swift } = await constants({ ios: {} })
        expect(swift).toContain("    public static let accessControlEnabled = false")
        expect(swift).toContain("    public static let allowedUrls: [String] = []")
    })
})

describe("generateConfigConstants: splash screen", () => {
    it("uses the configured values and embeds public/splashscreen.html as base64", async () => {
        const publicPath = tempDir()
        const html = "<html><body>Loading</body></html>"
        fs.writeFileSync(path.join(publicPath, "splashscreen.html"), html)
        const { swift, logs } = await constants(
            {
                splashScreen: {
                    duration: 1500,
                    backgroundColor: "#112233",
                    imageWidth: 200,
                    imageHeight: 100,
                    cornerRadius: 8,
                    minDuration: 250,
                },
                ios: {},
            },
            { publicPath }
        )
        expect(swift).toContain("    public static let splashScreenEnabled = true")
        expect(swift).toContain("    public static let splashScreenDuration: TimeInterval? = 1.5")
        expect(swift).toContain('    public static let splashScreenBackgroundColor = "#112233"')
        expect(swift).toContain("    public static let splashScreenImageWidth: CGFloat = 200")
        expect(swift).toContain("    public static let splashScreenImageHeight: CGFloat = 100")
        expect(swift).toContain("    public static let splashScreenCornerRadius: CGFloat = 8")
        expect(swift).toContain(
            `    public static let splashScreenHtml: String? = "${Buffer.from(html).toString("base64")}"`
        )
        expect(swift).toContain("    public static let splashScreenMinDuration: TimeInterval = 0.25")
        expect(logs.filter((l) => l.type === "warning")).toEqual([])
    })

    it("defaults the values, with no HTML splash when the file is missing", async () => {
        const { swift } = await constants({ splashScreen: {}, ios: {} })
        expect(swift).toContain("    public static let splashScreenEnabled = true")
        expect(swift).toContain("    public static let splashScreenDuration: TimeInterval? = nil")
        expect(swift).toContain('    public static let splashScreenBackgroundColor = "#ffffff"')
        expect(swift).toContain("    public static let splashScreenImageWidth: CGFloat = 120")
        expect(swift).toContain("    public static let splashScreenImageHeight: CGFloat = 120")
        expect(swift).toContain("    public static let splashScreenCornerRadius: CGFloat = 20")
        expect(swift).toContain("    public static let splashScreenHtml: String? = nil")
        expect(swift).toContain("    public static let splashScreenMinDuration: TimeInterval = 0")
    })

    it("warns about an HTML splash over 1 MB and an invalid minDuration", async () => {
        const publicPath = tempDir()
        fs.writeFileSync(path.join(publicPath, "splashscreen.html"), Buffer.alloc(1024 * 1024 + 1, "a"))
        const { swift, logs } = await constants(
            { splashScreen: { minDuration: -5 }, ios: {} },
            { publicPath }
        )
        const warnings = logs.filter((l) => l.type === "warning").map((l) => l.message)
        expect(warnings).toContain(
            "splashscreen.html is 1.0 MB; it is embedded in the app binary, keep it small"
        )
        expect(warnings).toContain("Ignoring invalid splashScreen.minDuration: -5")
        expect(swift).toContain("    public static let splashScreenMinDuration: TimeInterval = 0")
        expect(swift).toMatch(/public static let splashScreenHtml: String\? = "YWFh/)
    })

    it("is disabled with the defaults when not configured", async () => {
        const { swift } = await constants({ ios: {} })
        expect(swift).toContain("    public static let splashScreenEnabled = false")
        expect(swift).toContain("    public static let splashScreenHtml: String? = nil")
    })
})

describe("generateConfigConstants: defaults and failures", () => {
    it("adds disabled defaults for the features Swift always references", async () => {
        const { swift, logs } = await constants({ ios: {} })
        expect(swift).toContain(
            "    public enum Notifications {\n        public static let enabled = false\n    }"
        )
        expect(swift).toContain("    public enum GoogleSignIn {\n        public static let enabled = false")
        expect(swift).toContain(
            "    public enum Profiler {\n        public static let enabled = false\n    }"
        )
        expect(swift).toContain(
            "    public enum EdgeToEdge {\n        public static let enabled = false\n    }"
        )
        expect(swift).toContain('    public static let initial_url = ""')
        expect(swift).toContain('    public static let appInfo = ""')
        expect(swift).toContain("    public static let cachePattern: [String] = []")
        expect(swift.trimEnd().endsWith("}")).toBe(true)
        expect(logs.map((l) => l.message)).toContain("EdgeToEdge not found in config, adding default (false)")
    })

    it("uses the configured notifications instead of the default, and logs it", async () => {
        const { swift, logs } = await constants({
            notifications: { enabled: true },
            googleSignIn: { enabled: true },
            profiler: { enabled: true },
            edgeToEdge: { enabled: true },
            initial_url: "/home",
            appInfo: "v1",
            ios: {},
        })
        expect(swift).toContain(
            "    public enum Notifications {\n        public static let enabled = true\n    }"
        )
        expect(swift.match(/public enum Notifications/g)).toHaveLength(1)
        expect(swift.match(/public enum GoogleSignIn/g)).toHaveLength(1)
        expect(swift.match(/public enum Profiler/g)).toHaveLength(1)
        expect(swift.match(/public enum EdgeToEdge/g)).toHaveLength(1)
        expect(swift).toContain('    public static let initial_url = "/home"')
        expect(swift).toContain('    public static let appInfo = "v1"')
        const messages = logs.map((l) => l.message)
        expect(messages).toContain('Processing notifications config: {"enabled":true}')
        expect(messages).toContain("Notifications config was processed from WEBVIEW_CONFIG")
    })

    it("reports the failure on the progress step and rethrows", async () => {
        const projectDir = tempDir()
        // A file where the Constants folder should be makes the write fail.
        const constantsDir = path.join(projectDir, ...CONSTANTS_PATH.slice(0, -1))
        fs.mkdirSync(path.dirname(constantsDir), { recursive: true })
        fs.writeFileSync(constantsDir, "")
        const recorder = recordingProgress()
        const { generateConfigConstants } = createIosConfigPhase({
            WEBVIEW_CONFIG: { ios: {} },
            iosConfig: {},
            PROJECT_DIR: projectDir,
            PUBLIC_PATH: tempDir(),
            url: "https://shop.acme.com/",
            progress: recorder.progress,
        })
        const error = await rejection(generateConfigConstants())
        expect(error.code).toBe("ENOTDIR")
        expect(recorder.events[0]).toBe("start:config")
        expect(recorder.events).toContain(`fail:config:${error.message}`)
        expect(recorder.events).not.toContain("complete:config")
    })
})

describe("generateXCConfig", () => {
    it("writes the defaults and reports the Swift and iOS versions", async () => {
        const projectDir = tempDir()
        const recorder = recordingProgress()
        const { generateXCConfig } = createIosConfigPhase({
            WEBVIEW_CONFIG: {},
            iosConfig: { version: { major: 2, minor: 3, buildNumber: 11 } },
            PROJECT_DIR: projectDir,
            progress: recorder.progress,
        })
        await generateXCConfig()
        const xcconfig = fs.readFileSync(path.join(projectDir, "Configurations", "Shared.xcconfig"), "utf8")
        expect(xcconfig).toMatch(/^PRODUCT_BUNDLE_IDENTIFIER = com\.catalyst\.framework\.app$/m)
        expect(xcconfig).toMatch(/^APP_DISPLAY_NAME = Catalyst App$/m)
        expect(xcconfig).toMatch(/^MARKETING_VERSION = 2\.3\.0$/m)
        expect(xcconfig).toMatch(/^CURRENT_PROJECT_VERSION = 11$/m)
        expect(xcconfig).toMatch(/^SWIFT_VERSION = 5\.9$/m)
        expect(xcconfig).toMatch(/^IPHONEOS_DEPLOYMENT_TARGET = 17\.0$/m)
        expect(recorder.events).toContain("status:xcconfig · Swift 5.9 · iOS 17.0")
    })

    it("names the file in the error and keeps the original error", async () => {
        const projectDir = tempDir()
        // A file where Configurations/ should be.
        fs.writeFileSync(path.join(projectDir, "Configurations"), "")
        const { generateXCConfig } = createIosConfigPhase({
            WEBVIEW_CONFIG: {},
            iosConfig: {},
            PROJECT_DIR: projectDir,
            progress: recordingProgress().progress,
        })
        const error = await rejection(generateXCConfig())
        expect(error.message).toMatch(/^Failed to generate Shared\.xcconfig: /)
        expect(error.code).toBe("ENOTDIR")
    })
})

const PROJECT_NAME = "iosnativeWebView"

function plistPhase({
    WEBVIEW_CONFIG = {},
    isGoogleSignInEnabled = false,
    debugPlist = {} as Record<string, any> | null,
    releasePlist = {} as Record<string, any> | null,
    googleServices = null as string | null,
}: {
    WEBVIEW_CONFIG?: Record<string, any>
    isGoogleSignInEnabled?: boolean
    debugPlist?: Record<string, any> | null
    releasePlist?: Record<string, any> | null
    googleServices?: string | null
} = {}) {
    const projectDir = tempDir()
    const dir = path.join(projectDir, PROJECT_NAME)
    fs.mkdirSync(dir, { recursive: true })
    const debugFile = path.join(dir, "Info.plist")
    const releaseFile = path.join(dir, "Info-Release.plist")
    if (debugPlist) fs.writeFileSync(debugFile, JSON.stringify(debugPlist))
    if (releasePlist) fs.writeFileSync(releaseFile, JSON.stringify(releasePlist))
    if (googleServices !== null) fs.writeFileSync(path.join(dir, "GoogleService-Info.plist"), googleServices)
    const restored: string[] = []
    const phase = createIosConfigPhase({
        WEBVIEW_CONFIG,
        iosConfig: {},
        PROJECT_DIR: projectDir,
        PROJECT_NAME,
        isGoogleSignInEnabled,
        restoreManagedFileFromBaseline: (file: string) => restored.push(file),
        readPlistObject: (file: string) => JSON.parse(fs.readFileSync(file, "utf8")),
        writePlistObject: (file: string, value: unknown) => fs.writeFileSync(file, JSON.stringify(value)),
    })
    const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"))
    return {
        ...phase,
        projectDir,
        restored,
        debugFile,
        releaseFile,
        debug: () => read(debugFile),
        release: () => read(releaseFile),
    }
}

const GOOGLE_SERVICES = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>CLIENT_ID</key>
    <string>123-abc.apps.googleusercontent.com</string>
    <key>REVERSED_CLIENT_ID</key>
    <string>com.googleusercontent.apps.123-abc</string>
</dict>
</plist>`

describe("updateInfoPlist", () => {
    it("sets the display name and versions with the defaults", async () => {
        const phase = plistPhase()
        await phase.updateInfoPlist()
        const debug = phase.debug()
        expect(debug.CFBundleDisplayName).toBe("Catalyst Application")
        expect(debug.CFBundleShortVersionString).toBe("1.0.0")
        expect(debug.CFBundleVersion).toBe("1")
        expect(debug).not.toHaveProperty("CFBundleURLTypes")
        expect(debug).not.toHaveProperty("LSApplicationQueriesSchemes")
        expect(phase.restored).toEqual([phase.debugFile, phase.releaseFile])
    })

    it("skips a plist that does not exist", async () => {
        const phase = plistPhase({ debugPlist: null })
        await phase.updateInfoPlist()
        expect(fs.existsSync(phase.debugFile)).toBe(false)
        expect(phase.restored).toEqual([phase.releaseFile])
        expect(phase.release().CFBundleShortVersionString).toBe("1.0.0")
    })

    it("takes the reversed client ID from GoogleService-Info.plist", async () => {
        const phase = plistPhase({ isGoogleSignInEnabled: true, googleServices: GOOGLE_SERVICES })
        await phase.updateInfoPlist()
        for (const plist of [phase.debug(), phase.release()]) {
            expect(plist.CFBundleURLTypes).toEqual([
                {
                    CFBundleURLName: "googleSignIn",
                    CFBundleURLSchemes: ["com.googleusercontent.apps.123-abc"],
                },
            ])
            expect(plist.LSApplicationQueriesSchemes).toEqual([
                "google",
                "com.googleusercontent.apps.123-abc",
            ])
        }
    })

    it("reverses CLIENT_ID from GoogleService-Info.plist when it has no REVERSED_CLIENT_ID", async () => {
        const phase = plistPhase({
            isGoogleSignInEnabled: true,
            googleServices:
                "<dict><key>CLIENT_ID</key><string>123-abc.apps.googleusercontent.com</string></dict>",
        })
        await phase.updateInfoPlist()
        expect(phase.debug().CFBundleURLTypes[0].CFBundleURLSchemes).toEqual([
            "com.googleusercontent.apps.123-abc",
        ])
    })

    it("reverses the configured iOS client ID, before the web client ID", async () => {
        const phase = plistPhase({
            isGoogleSignInEnabled: true,
            WEBVIEW_CONFIG: {
                googleSignIn: { webClientId: "web.example.com", iosClientId: "ios.example.com" },
            },
        })
        await phase.updateInfoPlist()
        expect(phase.debug().CFBundleURLTypes[0].CFBundleURLSchemes).toEqual(["com.example.ios"])

        const web = plistPhase({
            isGoogleSignInEnabled: true,
            WEBVIEW_CONFIG: { googleSignIn: { webClientId: "web.example.com" } },
        })
        await web.updateInfoPlist()
        expect(web.debug().CFBundleURLTypes[0].CFBundleURLSchemes).toEqual(["com.example.web"])
    })

    it("fails when Google Sign-In is on but no client ID is found anywhere", async () => {
        const phase = plistPhase({ isGoogleSignInEnabled: true, googleServices: "<dict></dict>" })
        const error = await rejection(phase.updateInfoPlist())
        expect(error.message).toBe("Google Sign-In enabled but no valid clientId found")
        expect(phase.restored).toEqual([])
    })

    it("leaves the URL types alone when Google Sign-In is off, even with a client ID", async () => {
        const phase = plistPhase({ WEBVIEW_CONFIG: { googleSignIn: { clientId: "a.b.c" } } })
        await phase.updateInfoPlist()
        expect(phase.debug()).not.toHaveProperty("CFBundleURLTypes")
    })

    it("merges plugin URL schemes into the existing ones without duplicates", async () => {
        const phase = plistPhase({
            debugPlist: {
                CFBundleURLTypes: [
                    { CFBundleURLName: "app", CFBundleURLSchemes: ["acme", "acme"] },
                    { CFBundleURLName: "broken" },
                ],
                LSApplicationQueriesSchemes: ["tel"],
            },
        })
        await phase.updateInfoPlist({
            urlSchemes: [
                { name: "app", schemes: ["acme", "acme-pay"] },
                { name: "plugin", schemes: ["plug"] },
                { schemes: ["anon"] },
            ],
            querySchemes: ["tel", "mailto", ""],
        })
        expect(phase.debug().CFBundleURLTypes).toEqual([
            { CFBundleURLName: "app", CFBundleURLSchemes: ["acme", "acme-pay"] },
            { CFBundleURLName: "broken", CFBundleURLSchemes: [] },
            { CFBundleURLName: "plugin", CFBundleURLSchemes: ["plug"] },
            { CFBundleURLName: null, CFBundleURLSchemes: ["anon"] },
        ])
        expect(phase.debug().LSApplicationQueriesSchemes).toEqual(["tel", "mailto"])
        expect(phase.release().LSApplicationQueriesSchemes).toEqual(["tel", "mailto"])
    })

    it("merges plugin Info.plist arrays and dictionaries into the template", async () => {
        const phase = plistPhase({
            debugPlist: {
                UIBackgroundModes: ["fetch"],
                NSExtension: { NSExtensionAttributes: { A: 1 } },
                UIRequiresFullScreen: true,
            },
        })
        await phase.updateInfoPlist({
            infoPlist: {
                UIBackgroundModes: ["fetch", "remote-notification"],
                NSExtension: { NSExtensionAttributes: { B: 2 }, NSExtensionPointIdentifier: "x" },
                UIRequiresFullScreen: true,
                NSCameraUsageDescription: "Scan",
            },
        })
        const debug = phase.debug()
        expect(debug.UIBackgroundModes).toEqual(["fetch", "remote-notification"])
        expect(debug.NSExtension).toEqual({
            NSExtensionAttributes: { A: 1, B: 2 },
            NSExtensionPointIdentifier: "x",
        })
        expect(debug.UIRequiresFullScreen).toBe(true)
        expect(debug.NSCameraUsageDescription).toBe("Scan")
    })

    it("refuses a plugin value that conflicts with the template, naming the field", async () => {
        const phase = plistPhase({ debugPlist: { NSExtension: { Mode: "a" } } })
        const error = await rejection(phase.updateInfoPlist({ infoPlist: { NSExtension: { Mode: "b" } } }))
        expect(error.message).toBe(
            "Conflicting values for 'ios.infoPlist.NSExtension.Mode' while composing iOS build metadata"
        )
    })
})

describe("updateEntitlements", () => {
    function entitlementsFile(phase: ReturnType<typeof plistPhase>) {
        return path.join(phase.projectDir, PROJECT_NAME, `${PROJECT_NAME}.entitlements`)
    }

    it("does nothing when the app has no entitlements file", async () => {
        const phase = plistPhase()
        await phase.updateEntitlements({ entitlements: { "com.apple.developer.x": true } })
        expect(fs.existsSync(entitlementsFile(phase))).toBe(false)
        expect(phase.restored).toEqual([])
    })

    it("merges plugin entitlements and drops a stale aps-environment", async () => {
        const phase = plistPhase()
        const file = entitlementsFile(phase)
        fs.writeFileSync(
            file,
            JSON.stringify({
                "aps-environment": "production",
                "com.apple.developer.associated-domains": ["applinks:acme.com"],
            })
        )
        await phase.updateEntitlements({
            entitlements: {
                "com.apple.developer.associated-domains": ["applinks:acme.com", "webcredentials:acme.com"],
                "com.apple.developer.applesignin": ["Default"],
            },
        })
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
            "com.apple.developer.associated-domains": ["applinks:acme.com", "webcredentials:acme.com"],
            "com.apple.developer.applesignin": ["Default"],
        })
        expect(phase.restored).toEqual([file])
    })

    it("adds aps-environment only when notifications are on, defaulting to development", async () => {
        const projectDir = tempDir()
        const file = path.join(projectDir, PROJECT_NAME, `${PROJECT_NAME}.entitlements`)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify({}))
        const phase = createIosConfigPhase({
            WEBVIEW_CONFIG: { notifications: { enabled: true } },
            iosConfig: {},
            PROJECT_DIR: projectDir,
            PROJECT_NAME,
            restoreManagedFileFromBaseline: () => {},
            readPlistObject: (f: string) => JSON.parse(fs.readFileSync(f, "utf8")),
            writePlistObject: (f: string, value: unknown) => fs.writeFileSync(f, JSON.stringify(value)),
        })
        await phase.updateEntitlements()
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ "aps-environment": "development" })
    })

    it("refuses a plugin entitlement that conflicts with the template", async () => {
        const phase = plistPhase()
        fs.writeFileSync(entitlementsFile(phase), JSON.stringify({ "keychain-sharing": true }))
        const error = await rejection(
            phase.updateEntitlements({ entitlements: { "keychain-sharing": false } })
        )
        expect(error.message).toBe(
            "Conflicting values for 'ios.entitlements.keychain-sharing' while composing iOS build metadata"
        )
    })
})

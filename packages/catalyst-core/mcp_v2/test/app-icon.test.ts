// public/icon.png as the app icon (catalyst-core 1.2.0+) in check_config and
// get_conversion_status, NATIVE-010 for an iOS bundle id, and get_build_flow's
// version-gated native flows.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { handle_check_config }: typeof import("../tools/config.js") = require("../tools/config.js")
const conversion: any = require("../tools/conversion.js")
const build: any = require("../tools/build.js")
const { readPngInfo } = require("../lib/helpers")

const TASKS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "conversion-tasks.json"), "utf8"))

/** A PNG header with no image data: enough for readPngInfo. colorType 2 is RGB, 6 is RGBA. */
function png(width: number, height: number, colorType = 2): Buffer {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const ihdr = Buffer.alloc(25)
    ihdr.writeUInt32BE(13, 0)
    ihdr.write("IHDR", 4, "ascii")
    ihdr.writeUInt32BE(width, 8)
    ihdr.writeUInt32BE(height, 12)
    ihdr[16] = 8
    ihdr[17] = colorType
    const iend = Buffer.alloc(12)
    iend.write("IEND", 4, "ascii")
    return Buffer.concat([signature, ihdr, iend])
}

const IDENTITY = { appId: "com.acme.shop", appName: "Acme Shop", url: "https://shop.acme.com" }

function makeProject({
    version = "1.2.0",
    icon,
    webview = IDENTITY,
    androidSized = false,
    iosSized = false,
}: {
    version?: string
    icon?: Buffer
    webview?: object
    androidSized?: boolean
    iosSized?: boolean
} = {}): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-icon-"))
    fs.mkdirSync(path.join(root, "config"))
    fs.mkdirSync(path.join(root, "public"))
    const config = {
        NODE_SERVER_HOSTNAME: "localhost",
        NODE_SERVER_PORT: 3005,
        BUILD_OUTPUT_PATH: "build",
        PUBLIC_STATIC_ASSET_PATH: "/assets/",
        PUBLIC_STATIC_ASSET_URL: "http://localhost:3005",
        CLIENT_ENV_VARIABLES: [],
        WEBVIEW_CONFIG: webview,
    }
    fs.writeFileSync(path.join(root, "config", "config.json"), JSON.stringify(config))
    fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "app", dependencies: { "catalyst-core": version } })
    )
    if (icon) fs.writeFileSync(path.join(root, "public", "icon.png"), icon)
    if (androidSized) {
        const dir = path.join(root, "public", "android", "appIcons")
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, "icon-mdpi.png"), png(48, 48))
    }
    if (iosSized) fs.mkdirSync(path.join(root, "public", "ios", "appIcons"), { recursive: true })
    return root
}

const iconFindings = (r: any) => ({
    issues: r.issues.filter((f: any) => f.field === "public/icon.png"),
    warnings: r.warnings.filter((f: any) => f.field === "public/icon.png"),
    passed: r.passed.filter((f: any) => f.field === "public/icon.png"),
})

describe("readPngInfo", () => {
    it("reads size and alpha, and rejects bytes that are not a PNG", () => {
        expect(readPngInfo(png(1024, 1024))).toMatchObject({ width: 1024, height: 1024, hasAlpha: false })
        expect(readPngInfo(png(1024, 1024, 6)).hasAlpha).toBe(true)
        expect(readPngInfo(Buffer.from("not a png at all, just some text"))).toBeNull()
    })
})

describe("check_config: public/icon.png", () => {
    it("passes a square 1024px PNG on 1.2.0 for both platforms", () => {
        const r = handle_check_config({ project_path: makeProject({ icon: png(1024, 1024) }) })
        const f = iconFindings(r)
        expect(f.issues).toEqual([])
        expect(f.warnings).toEqual([])
        expect(f.passed[0].note).toMatch(/1024x1024 PNG, the app icon for android and ios/)
    })

    it("errors with ANDROID-010 and IOS-005 for an icon under 1024px", () => {
        const r = handle_check_config({ project_path: makeProject({ icon: png(512, 512) }) })
        const messages = iconFindings(r).issues.map((i: any) => i.message)
        expect(messages.some((m: string) => /ANDROID-010/.test(m))).toBe(true)
        expect(messages.some((m: string) => /IOS-005/.test(m))).toBe(true)
    })

    it("errors for a file that is not a PNG, or not square", () => {
        const notPng = handle_check_config({
            project_path: makeProject({ icon: Buffer.from("x".repeat(64)) }),
            platform: "android",
        })
        expect(iconFindings(notPng).issues[0].message).toMatch(/not a PNG file.*ANDROID-010/)
        const wide = handle_check_config({
            project_path: makeProject({ icon: png(1024, 768) }),
            platform: "ios",
        })
        expect(iconFindings(wide).issues[0].message).toMatch(/must be square.*IOS-005/)
    })

    it("warns about alpha on a debug build and errors for an iOS release (IOS-006)", () => {
        const debug = handle_check_config({ project_path: makeProject({ icon: png(1024, 1024, 6) }) })
        expect(iconFindings(debug).warnings[0].message).toMatch(/IOS-006/)
        const release = handle_check_config({
            project_path: makeProject({
                icon: png(1024, 1024, 6),
                webview: { ...IDENTITY, ios: { buildType: "release" } },
            }),
        })
        expect(iconFindings(release).issues[0].message).toMatch(/IOS-006/)
    })

    it("ignores icon.png on a platform whose sized icons replace it", () => {
        const r = handle_check_config({
            project_path: makeProject({ icon: png(512, 512), androidSized: true }),
            platform: "android",
        })
        expect(iconFindings(r)).toEqual({ issues: [], warnings: [], passed: [] })
        const ios = handle_check_config({
            project_path: makeProject({ icon: png(512, 512), androidSized: true }),
            platform: "ios",
        })
        expect(iconFindings(ios).issues[0].message).toMatch(/IOS-005/)
    })

    it("suggests public/icon.png when 1.2.0 has no icon at all", () => {
        const r = handle_check_config({ project_path: makeProject() })
        expect(iconFindings(r).warnings[0].message).toMatch(
            /No app icon for android and ios.*public\/icon\.png/
        )
    })

    it("says 1.1.x ignores public/icon.png", () => {
        const r = handle_check_config({
            project_path: makeProject({ version: "1.1.0", icon: png(1024, 1024) }),
        })
        const f = iconFindings(r)
        expect(f.issues).toEqual([])
        expect(f.warnings[0].message).toMatch(/from catalyst-core 1\.2\.0; 1\.1\.0 ignores it/)
    })
})

describe("check_config: NATIVE-010", () => {
    it("errors for an iOS bundleIdentifier with an underscore on 1.2.0", () => {
        const webview = { ...IDENTITY, ios: { bundleIdentifier: "com.acme.my_shop" } }
        const r = handle_check_config({ project_path: makeProject({ webview }), platform: "ios" })
        const finding = r.issues.find((i: any) => i.field === "WEBVIEW_CONFIG.ios.bundleIdentifier")
        expect(finding?.message).toMatch(/NATIVE-010/)
        expect(finding?.message).toMatch(/"com\.acme\.myshop"/)
    })

    it("only warns on 1.1.x, where the id reached Xcode unchecked", () => {
        const webview = { ...IDENTITY, ios: { bundleIdentifier: "com.acme.my_shop" } }
        const r = handle_check_config({
            project_path: makeProject({ version: "1.1.0", webview }),
            platform: "ios",
        })
        expect(r.issues.find((i: any) => i.field === "WEBVIEW_CONFIG.ios.bundleIdentifier")).toBeUndefined()
        const warning = r.warnings.find((w: any) => w.field === "WEBVIEW_CONFIG.ios.bundleIdentifier")
        expect(warning?.message).toMatch(/From catalyst-core 1\.2\.0.*NATIVE-010/)
    })

    it("names the 1.2.0 breaking change for an appId with an underscore", () => {
        const r = handle_check_config({
            project_path: makeProject({ webview: { ...IDENTITY, appId: "com.acme.my_shop" } }),
            platform: "ios",
        })
        const finding = r.issues.find((i: any) => i.field === "WEBVIEW_CONFIG.appId")
        expect(finding?.message).toMatch(/Since catalyst-core 1\.2\.0.*NATIVE-010/)
    })
})

function iconTasks(options: Parameters<typeof makeProject>[0]) {
    const root = makeProject(options)
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    conversion.init({ dir: root, pkg, installedVersion: options?.version || "1.2.0" }, TASKS)
    const status = conversion.handle_get_conversion_status({ project_path: root })
    const all = [...status.gaps, ...status.completed, ...(status.blocked || [])]
    const find = (id: string) => all.find((t: any) => t.id === id)
    const isGap = (id: string) => status.gaps.some((t: any) => t.id === id)
    return { find, isGap }
}

describe("get_conversion_status: T13/T14 app icons", () => {
    it("completes both with a valid public/icon.png on 1.2.0, without the sized sets", () => {
        const { isGap } = iconTasks({ icon: png(1024, 1024) })
        expect(isGap("T13_ANDROID_ICONS")).toBe(false)
        expect(isGap("T14_IOS_ICONS")).toBe(false)
    })

    it("asks for public/icon.png when 1.2.0 has none", () => {
        const { isGap, find } = iconTasks({})
        expect(isGap("T13_ANDROID_ICONS")).toBe(true)
        expect(find("T13_ANDROID_ICONS").reason).toMatch(/public\/icon\.png not found/)
    })

    it("reports a transparent icon as an iOS gap only (IOS-006)", () => {
        const { isGap, find } = iconTasks({ icon: png(1024, 1024, 6) })
        expect(isGap("T13_ANDROID_ICONS")).toBe(false)
        expect(isGap("T14_IOS_ICONS")).toBe(true)
        expect(find("T14_IOS_ICONS").native_risk).toMatch(/IOS-006/)
    })

    it("reports an undersized icon with the build's error codes", () => {
        const { find } = iconTasks({ icon: png(256, 256) })
        expect(find("T13_ANDROID_ICONS").native_risk).toMatch(/ANDROID-010/)
        expect(find("T14_IOS_ICONS").native_risk).toMatch(/IOS-005/)
    })

    it("still wants the sized sets before 1.2.0", () => {
        // The platform blocks 1.1.x needs, so T13/T14 are not blocked by T9/T10.
        const webview = {
            android: { buildType: "debug", sdkPath: "/sdk", emulatorName: "Pixel", appName: "Acme" },
            ios: {
                buildType: "debug",
                appBundleId: "com.acme.shop",
                simulatorName: "iPhone 17",
                appName: "Acme",
            },
        }
        const { isGap, find } = iconTasks({ version: "1.1.0", icon: png(1024, 1024), webview })
        expect(isGap("T13_ANDROID_ICONS")).toBe(true)
        expect(find("T13_ANDROID_ICONS").reason).toMatch(/icon-mdpi\.png/)
        expect(isGap("T14_IOS_ICONS")).toBe(true)
    })

    it("names the real files in the task definitions", () => {
        const t13 = TASKS.find((t: any) => t.id === "T13_ANDROID_ICONS")
        const t14 = TASKS.find((t: any) => t.id === "T14_IOS_ICONS")
        expect(JSON.stringify(t13)).toMatch(/public\/icon\.png/)
        expect(JSON.stringify(t13)).toMatch(/icon-mdpi\.png/)
        expect(JSON.stringify(t14)).toMatch(/icon-1024x1024-1x\.png/)
        expect(JSON.stringify(t13)).not.toMatch(/appIcons\/mdpi\.png/)
    })
})

describe("get_build_flow: native flows by version", () => {
    beforeAll(() => build.init({ prepare: () => ({ all: () => [] }) }))

    const flow = (version: string, platform: string, mode: string, webview: object = IDENTITY) => {
        const root = makeProject({ version, webview })
        return build.handle_get_build_flow({ platform, mode }, { dir: root, installedVersion: version })
    }
    const text = (r: any) => JSON.stringify(r.steps)

    it("does not require the android or ios blocks on 1.2.0", () => {
        for (const platform of ["android", "ios"]) {
            const r = flow("1.2.0", platform, "dev")
            expect(r.warnings || [], platform).not.toContainEqual(expect.stringMatching(/block missing/))
        }
    })

    it("lists the signed APK and the debug APK on 1.2.0", () => {
        expect(text(flow("1.2.0", "android", "release"))).toMatch(
            /<name>\.apk signed with the same upload key/
        )
        expect(text(flow("1.2.0", "android", "dev"))).toMatch(/build-output\/android\/debug\//)
    })

    it("describes the iOS signing order and does not warn about IOS-010 for a Mac with Xcode", () => {
        const r = flow("1.2.0", "ios", "release")
        expect(text(r)).toMatch(
            /\(4\) an App Store profile installed.*\(5\) the Apple account signed in to Xcode/
        )
        expect(r.warnings || []).not.toContainEqual(expect.stringMatching(/IOS-010/))
        expect(r.project_config.join(" ")).toMatch(/installed App Store profile.*IOS-010/)
    })

    it("gives 1.1.x its buildApp steps and the block warnings it needs", () => {
        const r = flow("1.1.0", "android", "dev")
        expect(text(r)).toMatch(/npm run buildApp:android/)
        expect(text(r)).not.toMatch(/npm run android"/)
        expect(r.warnings).toContainEqual(expect.stringMatching(/android block missing/))
        expect(r.project_config.join(" ")).toMatch(/predates 1\.2\.0/)
    })
})

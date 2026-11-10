// The native commands the MCP server accepts and asks a converted app for:
// the one-step scripts on catalyst-core 1.2.0+, buildApp:* / setupEmulator:*
// before it.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { validateStepCommands }: typeof import("../tools/tasks.js") = require("../tools/tasks.js")
const conversion: typeof import("../tools/conversion.js") = require("../tools/conversion.js")

const TASKS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "conversion-tasks.json"), "utf8"))
const TEMPLATES = path.join(__dirname, "..", "..", "..", "create-catalyst-app", "templates")

describe("create_task_plan: valid commands", () => {
    it("accepts the 1.2.0 scripts and keeps the older ones", () => {
        const steps = [
            "Run npm run android",
            "Run npm run ios",
            "Build with npm run android:release",
            "Build with npm run ios:release",
            "Older apps: npm run buildApp:android -- --release",
            "npm run setupEmulator:ios",
        ]
        expect(validateStepCommands(steps, "current").invalid).toEqual([])
    })

    it("still rejects invented commands", () => {
        expect(validateStepCommands(["npm run build:android"], "current").invalid).toEqual([
            "npm run build:android",
        ])
    })
})

function conversionStatus(version: string, pkgScripts: Record<string, string>, webview: object) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conv-"))
    fs.mkdirSync(path.join(root, "config"))
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
    const pkg = { name: "app", dependencies: { "catalyst-core": version }, scripts: pkgScripts }
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg))
    conversion.init({ dir: root, pkg, installedVersion: version }, TASKS)
    const status: any = (conversion.handle_get_conversion_status as any)({ project_path: root })
    const find = (id: string) =>
        [...status.gaps, ...status.completed, ...(status.blocked || [])].find((t: any) => t.id === id)
    return { status, find }
}

describe("get_conversion_status: native scripts and app identity", () => {
    const templateScripts = JSON.parse(
        fs.readFileSync(path.join(TEMPLATES, "none-js", "package.json"), "utf8")
    ).scripts
    const identity = { appId: "com.acme.shop", appName: "Acme Shop", url: "https://shop.acme.com" }

    it("matches the template's script lines", () => {
        for (const [name, line] of Object.entries(conversion.ONE_STEP_NATIVE_SCRIPTS)) {
            expect(templateScripts[name], name).toBe(line)
        }
    })

    it("asks a 1.2.0 app for the four scripts, not setupEmulator", () => {
        const scripts = { ...conversion.ONE_STEP_NATIVE_SCRIPTS }
        const { find } = conversionStatus("1.2.0", scripts, identity)
        expect(find("T7b_NATIVE_SCRIPTS")).toMatchObject({ id: "T7b_NATIVE_SCRIPTS" })
        expect(find("T7b_NATIVE_SCRIPTS").reason).toBeUndefined()

        const { find: findMissing } = conversionStatus(
            "1.2.0-canary.3",
            { "buildApp:android": "x" },
            identity
        )
        const gap = findMissing("T7b_NATIVE_SCRIPTS")
        expect(gap.reason).toMatch(/"android:release": "catalyst buildApp:android --release"/)
        expect(gap.reason).not.toMatch(/setupEmulator/)
    })

    it("keeps the buildApp and setupEmulator scripts for apps before 1.2.0", () => {
        const { find } = conversionStatus("1.1.0", { ...conversion.ONE_STEP_NATIVE_SCRIPTS }, identity)
        expect(find("T7b_NATIVE_SCRIPTS").reason).toMatch(/setupEmulator:android/)
        expect(find("T7b_NATIVE_SCRIPTS").reason).toMatch(/1\.2\.0/)
    })

    it("asks a 1.2.0 app for appId, appName and url instead of per-platform blocks", () => {
        const scripts = { ...conversion.ONE_STEP_NATIVE_SCRIPTS }
        const done = conversionStatus("1.2.0", scripts, identity).find
        expect(done("T9_WEBVIEW_ANDROID").reason).toBeUndefined()
        expect(done("T10_WEBVIEW_IOS").reason).toBeUndefined()

        const empty = conversionStatus("1.2.0", scripts, { LOCAL_IP: "localhost" }).find
        expect(empty("T9_WEBVIEW_ANDROID").reason).toMatch(/appId, appName, url/)
        expect(empty("T10_WEBVIEW_IOS").reason).toMatch(/appId, appName, url/)

        const underscore = conversionStatus("1.2.0", scripts, { ...identity, appId: "com.acme.my_shop" }).find
        expect(underscore("T9_WEBVIEW_ANDROID").reason).toBeUndefined()
        expect(underscore("T10_WEBVIEW_IOS").native_risk).toMatch(/NATIVE-010/)
    })

    it("reports the version gate with the 1.2.0 scripts", () => {
        const { status } = conversionStatus("0.0.2", {}, identity)
        const gated = status.blocked_by_version.find((t: any) => t.id === "T7b_NATIVE_SCRIPTS")
        expect(gated.reason).toMatch(/1\.2\.0/)
    })
})

// The app id, app name, native scripts, icon and .gitignore entries every
// new app gets (scripts/appIdentity.cjs and the templates).
const identity: typeof import("../scripts/appIdentity.cjs") = require("../scripts/appIdentity.cjs")
const fs: typeof import("fs") = require("fs")
const os: typeof import("os") = require("os")
const path: typeof import("path") = require("path")

const templates = path.join(__dirname, "..", "templates")
const STARTERS = ["none-js", "none-ts", "redux-js", "redux-ts", "rtk-js", "rtk-ts"]

const dirs: string[] = []
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("deriveAppId", () => {
    it.each([
        ["my-shop", "com.example.myshop"],
        ["@acme/My_App", "com.example.myapp"],
        ["123go", "com.example.app123go"],
        ["class", "com.example.classapp"],
        ["---", "com.example.app"],
    ])("%s -> %s", (name, id) => {
        expect(identity.deriveAppId(name)).toBe(id)
    })
})

describe("deriveAppName", () => {
    it.each([
        ["my-shop", "My Shop"],
        ["@acme/my-cool_app", "My Cool App"],
        ["", "Catalyst App"],
    ])("%s -> %s", (name, appName) => {
        expect(identity.deriveAppName(name)).toBe(appName)
    })
})

describe("applyAppIdentity", () => {
    function app(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cca-identity-"))
        dirs.push(dir)
        fs.cpSync(path.join(templates, "common", "config"), path.join(dir, "config"), { recursive: true })
        return dir
    }

    it("sets the derived id and name and changes nothing else in the file", () => {
        const dir = app()
        const file = path.join(dir, "config", "config.json")
        const before = fs.readFileSync(file, "utf8")
        expect(identity.applyAppIdentity(dir, "my-shop")).toBe(true)
        const after = fs.readFileSync(file, "utf8")
        const config = JSON.parse(after)
        expect(config.WEBVIEW_CONFIG.appId).toBe("com.example.myshop")
        expect(config.WEBVIEW_CONFIG.appName).toBe("My Shop")
        const changed = after
            .split("\n")
            .filter((line: string, index: number) => line !== before.split("\n")[index])
        expect(changed).toHaveLength(2)
    })

    it("adds the keys to a config that lacks them", () => {
        const dir = app()
        const file = path.join(dir, "config", "config.json")
        fs.writeFileSync(file, JSON.stringify({ WEBVIEW_CONFIG: { port: "3005" } }))
        expect(identity.applyAppIdentity(dir, "shop")).toBe(true)
        expect(JSON.parse(fs.readFileSync(file, "utf8")).WEBVIEW_CONFIG).toEqual({
            appId: "com.example.shop",
            appName: "Shop",
            port: "3005",
        })
    })

    it("leaves a config without WEBVIEW_CONFIG alone", () => {
        const dir = app()
        const file = path.join(dir, "config", "config.json")
        fs.writeFileSync(file, "{}")
        expect(identity.applyAppIdentity(dir, "shop")).toBe(false)
        expect(fs.readFileSync(file, "utf8")).toBe("{}")
    })
})

describe("templates", () => {
    it("ship appId and appName placeholders in the shared config", () => {
        const config = JSON.parse(
            fs.readFileSync(path.join(templates, "common", "config", "config.json"), "utf8")
        )
        expect(config.WEBVIEW_CONFIG).toMatchObject({
            appId: expect.any(String),
            appName: expect.any(String),
        })
    })

    it("ship a square 1024 px opaque icon at public/icon.png", () => {
        const png = fs.readFileSync(path.join(templates, "common", "public", "icon.png"))
        expect(png.subarray(1, 4).toString()).toBe("PNG")
        expect(png.readUInt32BE(16)).toBe(1024)
        expect(png.readUInt32BE(20)).toBe(1024)
        // Colour type 2: RGB, no alpha (App Store Connect rejects alpha).
        expect(png[25]).toBe(2)
    })

    it.each(STARTERS)("%s has the native scripts", (starter) => {
        const pkg = JSON.parse(fs.readFileSync(path.join(templates, starter, "package.json"), "utf8"))
        expect(pkg.scripts).toMatchObject({
            android: "catalyst buildApp:android",
            ios: "catalyst buildApp:ios",
            "android:release": "catalyst buildApp:android --release",
            "ios:release": "catalyst buildApp:ios --release",
        })
    })

    it("no longer ship the native-only template", () => {
        expect(fs.existsSync(path.join(templates, "native"))).toBe(false)
        expect(fs.existsSync(path.join(__dirname, "..", "scripts", "native.cjs"))).toBe(false)
    })
})

describe("cli.cjs", () => {
    const cli = fs.readFileSync(path.join(__dirname, "..", "scripts", "cli.cjs"), "utf8")

    it("ignores credentials/, .catalyst/ and build-output/", () => {
        for (const entry of ["credentials/", ".catalyst/", "build-output/"])
            expect(cli).toContain(`"${entry}"`)
    })

    it("has no native prompt or flags", () => {
        expect(cli).not.toContain("--native")
        expect(cli).not.toContain("--app-id")
        expect(cli).toContain("applyAppIdentity")
    })
})

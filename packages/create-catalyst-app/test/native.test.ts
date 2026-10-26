// Native platform setup (scripts/native.cjs): the "Native platforms" answer
// and app id turned into config, icon, .gitignore and CI workflow.
const native: typeof import("../scripts/native.cjs") = require("../scripts/native.cjs")
const fs: typeof import("fs") = require("fs")
const os: typeof import("os") = require("os")
const path: typeof import("path") = require("path")
const crypto: typeof import("crypto") = require("crypto")

const templates = path.join(__dirname, "..", "templates")

/** A freshly extracted web app: templates/common + none-js and the CLI's .gitignore. */
function scaffold(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cca-native-"))
    fs.cpSync(path.join(templates, "common"), dir, { recursive: true })
    fs.cpSync(path.join(templates, "none-js"), dir, { recursive: true })
    fs.writeFileSync(path.join(dir, ".gitignore"), ["node_modules", "build", "logs"].join("\n"))
    return dir
}

function snapshot(dir: string): Record<string, string> {
    const out: Record<string, string> = {}
    const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name)
            if (entry.isDirectory()) walk(full)
            else
                out[path.relative(dir, full)] = crypto
                    .createHash("sha256")
                    .update(fs.readFileSync(full))
                    .digest("hex")
        }
    }
    walk(dir)
    return out
}

const dirs: string[] = []
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
function app(): string {
    const dir = scaffold()
    dirs.push(dir)
    return dir
}

describe("parseNativeOption", () => {
    it.each([
        ["none", []],
        ["android", ["android"]],
        ["ios", ["ios"]],
        ["both", ["android", "ios"]],
        ["ios,android", ["android", "ios"]],
        [" Android , iOS ", ["android", "ios"]],
    ])("%s", (value, expected) => {
        expect(native.parseNativeOption(value)).toEqual(expected)
    })

    it.each(["", "windows", "android,web", "none,ios"])("rejects %j", (value) => {
        expect(native.parseNativeOption(value)).toBeNull()
    })
})

describe("deriveAppId / deriveAppName", () => {
    it.each([
        ["my-app", "com.example.myapp"],
        ["@acme/shop_front", "com.example.shopfront"],
        ["2048", "com.example.app2048"],
        ["new", "com.example.newapp"],
        ["---", "com.example.app"],
    ])("%s -> %s, valid for both platforms", (name, id) => {
        expect(native.deriveAppId(name)).toBe(id)
        expect(native.validateAppId(id, ["android", "ios"])).toBeUndefined()
    })

    it("title-cases the project name", () => {
        expect(native.deriveAppName("my-cool_app")).toBe("My Cool App")
        expect(native.deriveAppName("@acme/shop")).toBe("Shop")
        expect(native.deriveAppName("")).toBe("Catalyst App")
    })
})

describe("validateAppId", () => {
    it("accepts reverse-DNS ids", () => {
        expect(native.validateAppId("com.acme.shop", ["android", "ios"])).toBeUndefined()
        expect(native.validateAppId("com.acme.shop_app", ["android"])).toBeUndefined()
        expect(native.validateAppId("com.acme.shop-app", ["ios"])).toBeUndefined()
    })

    it.each([
        ["", ["android"]],
        ["shop", ["ios"]],
        ["com..shop", ["ios"]],
        ["com.acme.", ["android"]],
        ["com.acme.shop-app", ["android"]],
        ["com.acme.shop_app", ["ios"]],
        ["com.acme.1shop", ["android"]],
        ["com.acme.new", ["android"]],
        ["com.acme.shop app", ["ios"]],
        ["com.acme.shop-app", ["android", "ios"]],
    ])("rejects %j for %j", (id, platforms) => {
        expect(native.validateAppId(id, platforms)).toEqual(expect.any(String))
    })
})

describe("applyNativeSetup", () => {
    it("leaves a web-only app byte-for-byte unchanged", () => {
        const dir = app()
        const before = snapshot(dir)
        expect(native.applyNativeSetup(dir, { platforms: [], appId: "com.example.x", appName: "X" })).toEqual(
            []
        )
        expect(snapshot(dir)).toEqual(before)
    })

    it("ships no native files in the web templates", () => {
        const config = JSON.parse(
            fs.readFileSync(path.join(templates, "common", "config", "config.json"), "utf8")
        )
        expect(config.WEBVIEW_CONFIG.release).toBeUndefined()
        expect(fs.existsSync(path.join(templates, "common", "public", "icon.png"))).toBe(false)
        expect(fs.existsSync(path.join(templates, "common", ".github"))).toBe(false)
    })

    it("writes both platforms' config, a failing release placeholder, the icon, .gitignore and workflow", () => {
        const dir = app()
        const written = native.applyNativeSetup(dir, {
            platforms: ["android", "ios"],
            appId: "com.acme.shop",
            appName: "Shop",
        })
        expect(written).toEqual([
            "config/config.json",
            "public/icon.png",
            ".gitignore",
            ".github/workflows/catalyst-native.yml",
        ])

        const config = JSON.parse(fs.readFileSync(path.join(dir, "config", "config.json"), "utf8"))
        const version = { major: 1, minor: 0, patch: 0 }
        expect(config.WEBVIEW_CONFIG.android).toEqual({
            buildType: "debug",
            packageName: "com.acme.shop",
            appName: "Shop",
            version,
        })
        expect(config.WEBVIEW_CONFIG.ios).toEqual({
            buildType: "debug",
            appBundleId: "com.acme.shop",
            appName: "Shop",
            version,
        })
        // No build number: a release must get one from --build-number or CI.
        expect(config.WEBVIEW_CONFIG.android.version.buildNumber).toBeUndefined()
        // A .localhost host fails catalyst-core's release-host guard until edited.
        expect(config.WEBVIEW_CONFIG.release).toEqual({
            LOCAL_IP: native.RELEASE_HOST_PLACEHOLDER,
            port: 443,
            useHttps: true,
        })
        expect(native.RELEASE_HOST_PLACEHOLDER).toMatch(/\.localhost$/)
        // The rest of the config is untouched.
        expect(config.WEBVIEW_CONFIG.LOCAL_IP).toBe("localhost")
        expect(config.NODE_SERVER_PORT).toBe(3005)

        const icon = fs.readFileSync(path.join(dir, "public", "icon.png"))
        expect(icon.subarray(1, 4).toString("ascii")).toBe("PNG")
        expect(icon.readUInt32BE(16)).toBe(1024)
        expect(icon.readUInt32BE(20)).toBe(1024)
        // Colour type 2 (RGB): no alpha, so it is also a valid App Store icon.
        expect(icon[25]).toBe(2)

        expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe(
            "node_modules\nbuild\nlogs\ncredentials/\n"
        )
    })

    it("only touches the chosen platform and keeps an existing icon", () => {
        const dir = app()
        fs.writeFileSync(path.join(dir, "public", "icon.png"), "mine")
        native.applyNativeSetup(dir, { platforms: ["android"], appId: "com.acme.shop", appName: "Shop" })
        const config = JSON.parse(fs.readFileSync(path.join(dir, "config", "config.json"), "utf8"))
        expect(config.WEBVIEW_CONFIG.android.packageName).toBe("com.acme.shop")
        expect(config.WEBVIEW_CONFIG.ios).toEqual({ buildType: "debug" })
        expect(fs.readFileSync(path.join(dir, "public", "icon.png"), "utf8")).toBe("mine")
        const workflow = fs.readFileSync(
            path.join(dir, ".github", "workflows", "catalyst-native.yml"),
            "utf8"
        )
        expect(workflow).toContain("buildApp:android --release")
        expect(workflow).not.toContain("buildApp:ios")
    })
})

describe("renderWorkflow", () => {
    it.each([[["android"]], [["ios"]], [["android", "ios"]]])("%j", (platforms) => {
        const workflow = native.renderWorkflow(platforms)
        expect(workflow.includes("    android:\n")).toBe(platforms.includes("android"))
        expect(workflow.includes("    ios:\n")).toBe(platforms.includes("ios"))
        expect(workflow).toContain("workflow_dispatch:")
        expect(workflow).toContain('tags: ["v*"]')
        expect(workflow).toContain("CATALYST_BUILD_NUMBER: ${{ github.run_number }}")
        expect(workflow).toContain("Nothing is")
        expect(workflow).toContain("published")

        const lines = workflow.split("\n")
        // Every action is pinned to a full commit SHA with its tag beside it.
        const uses = lines.filter((line) => line.includes("uses:"))
        expect(uses.length).toBeGreaterThan(0)
        for (const line of uses) expect(line).toMatch(/uses: [\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/)
        // Secrets reach the CLI through env:, never interpolated into a run: script.
        for (const line of lines.filter((l) => /^\s*(- )?run:/.test(l))) expect(line).not.toContain("${{")
        for (const line of lines.filter((l) => l.includes("${{ secrets."))) {
            expect(line).toMatch(/^\s+CATALYST_[A-Z0-9_]+: \$\{\{ secrets\.CATALYST_[A-Z0-9_]+ \}\}$/)
        }
    })

    it("pins Xcode on the iOS job and lists the iOS secrets", () => {
        const workflow = native.renderWorkflow(["ios"])
        expect(workflow).toContain("runs-on: macos-26")
        expect(workflow).toMatch(/sudo xcode-select -s \/Applications\/Xcode_26\.\d+\.app/)
        for (const name of [
            "CATALYST_IOS_P12_BASE64",
            "CATALYST_IOS_P12_PASSWORD",
            "CATALYST_IOS_PROFILE_BASE64",
        ]) {
            expect(workflow).toContain(`#   ${name}`)
        }
        expect(workflow).not.toContain("CATALYST_ANDROID_")
    })
})

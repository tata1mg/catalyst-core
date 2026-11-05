// check_config coverage for the on-device AI (catalyst-ai) settings.
const fs = require("fs")
const os = require("os")
const path = require("path")
const { handle_check_config }: typeof import("../tools/config.js") = require("../tools/config.js")

function makeProject(ai: unknown, aiConfig: unknown, installAi: boolean): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-cfg-"))
    fs.mkdirSync(path.join(root, "config"))
    const config = { WEBVIEW_CONFIG: { LOCAL_IP: "192.168.0.11", ai }, AI_CONFIG: aiConfig }
    fs.writeFileSync(path.join(root, "config", "config.json"), JSON.stringify(config))
    if (installAi) {
        fs.mkdirSync(path.join(root, "node_modules", "catalyst-ai"), { recursive: true })
        fs.writeFileSync(path.join(root, "node_modules", "catalyst-ai", "package.json"), "{}")
    }
    return root
}

const aiFields = (r: ReturnType<typeof handle_check_config>) =>
    [...r.issues, ...r.warnings].filter((f) => /ai/i.test(f.field))

describe("check_config: on-device AI", () => {
    it("errors when ai.enabled but catalyst-ai is not installed", () => {
        const r = handle_check_config({ project_path: makeProject({ enabled: true }, {}, false) })
        expect(r.issues.some((i) => i.field === "WEBVIEW_CONFIG.ai")).toBe(true)
    })

    it("passes when ai.enabled and catalyst-ai is installed", () => {
        const r = handle_check_config({ project_path: makeProject({ enabled: true }, {}, true) })
        expect(r.passed.some((p) => p.field === "WEBVIEW_CONFIG.ai")).toBe(true)
        expect(r.issues.some((i) => i.field === "WEBVIEW_CONFIG.ai")).toBe(false)
    })

    it("rejects an unknown engine", () => {
        const r = handle_check_config({
            project_path: makeProject({ enabled: true }, { browser: { engine: "gpt" } }, true),
        })
        expect(r.issues.some((i) => i.field === "AI_CONFIG.browser.engine")).toBe(true)
    })

    it("warns when an on-device provider is set but ai.enabled is off", () => {
        const r = handle_check_config({
            project_path: makeProject(undefined, { browser: { provider: "litert" } }, true),
        })
        expect(r.warnings.some((w) => w.field === "WEBVIEW_CONFIG.ai.enabled")).toBe(true)
    })

    it("stays silent for apps that do not use AI", () => {
        const r = handle_check_config({ project_path: makeProject(undefined, {}, false) })
        expect(aiFields(r)).toEqual([])
    })
})

function makeSplashProject(config: unknown, files: string[] = []): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-cfg-"))
    fs.mkdirSync(path.join(root, "config"))
    fs.writeFileSync(path.join(root, "config", "config.json"), JSON.stringify(config))
    for (const f of files) {
        fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true })
        fs.writeFileSync(path.join(root, f), "")
    }
    return root
}

const findings = (r: ReturnType<typeof handle_check_config>) => [...r.issues, ...r.warnings, ...r.passed]

describe("check_config: splash screen", () => {
    it("reads splashScreen from WEBVIEW_CONFIG and treats missing images as fine", () => {
        const r = handle_check_config({
            project_path: makeSplashProject({
                WEBVIEW_CONFIG: { splashScreen: { backgroundColor: "#fff" } },
            }),
        })
        expect(r.passed.some((p) => p.field === "WEBVIEW_CONFIG.splashScreen")).toBe(true)
        expect(r.issues.some((i) => /splash/i.test(i.field))).toBe(false)
    })

    it("flags a top-level splashScreen as misplaced", () => {
        const r = handle_check_config({
            project_path: makeSplashProject({ WEBVIEW_CONFIG: {}, splashScreen: { duration: 1000 } }),
        })
        expect(
            r.warnings.some((w) => w.field === "WEBVIEW_CONFIG.splashScreen" && /top level/.test(w.message!))
        ).toBe(true)
    })

    it("recognises public/splashscreen.html", () => {
        const r = handle_check_config({
            project_path: makeSplashProject({ WEBVIEW_CONFIG: { splashScreen: { minDuration: 1200 } } }, [
                "public/splashscreen.html",
            ]),
        })
        expect(r.passed.some((p) => p.field === "public/splashscreen.html")).toBe(true)
    })

    it("warns on an invalid minDuration", () => {
        for (const minDuration of [-1, "1200"]) {
            const r = handle_check_config({
                project_path: makeSplashProject({ WEBVIEW_CONFIG: { splashScreen: { minDuration } } }),
            })
            expect(r.warnings.some((w) => w.field === "WEBVIEW_CONFIG.splashScreen.minDuration")).toBe(true)
        }
    })

    it("accepts a valid minDuration silently", () => {
        const r = handle_check_config({
            project_path: makeSplashProject({ WEBVIEW_CONFIG: { splashScreen: { minDuration: 0 } } }),
        })
        expect(findings(r).some((f) => f.field === "WEBVIEW_CONFIG.splashScreen.minDuration")).toBe(false)
    })
})

describe("check_config: native port and cache patterns", () => {
    const fieldsOf = (list: Array<{ field: string }>) => list.map((f) => f.field)

    it("accepts WEBVIEW_CONFIG.port as the template's string or a number", () => {
        for (const port of ["3005", 3005]) {
            const r = handle_check_config({
                project_path: makeSplashProject({ NODE_SERVER_PORT: 3005, WEBVIEW_CONFIG: { port } }),
            })
            expect(fieldsOf(r.issues)).not.toContain("WEBVIEW_CONFIG.port")
            expect(fieldsOf(r.warnings)).not.toContain("WEBVIEW_CONFIG.port")
            expect(fieldsOf(r.passed)).toContain("WEBVIEW_CONFIG.port")
        }
    })

    it("still rejects a port that is not a port", () => {
        for (const port of ["abc", 0, 70000, true]) {
            const r = handle_check_config({ project_path: makeSplashProject({ WEBVIEW_CONFIG: { port } }) })
            expect(fieldsOf(r.issues)).toContain("WEBVIEW_CONFIG.port")
        }
    })

    it("reads ios.cachePattern as an array, and warns about a comma-separated string", () => {
        const ok = handle_check_config({
            project_path: makeSplashProject({ WEBVIEW_CONFIG: { ios: { cachePattern: ["*.css", "*.js"] } } }),
        })
        expect(fieldsOf(ok.passed)).toContain("WEBVIEW_CONFIG.ios.cachePattern")
        expect(fieldsOf(ok.warnings)).not.toContain("WEBVIEW_CONFIG.ios.cachePattern")

        const commas = handle_check_config({
            project_path: makeSplashProject({ WEBVIEW_CONFIG: { ios: { cachePattern: "*.css,*.js" } } }),
        })
        expect(fieldsOf(commas.warnings)).toContain("WEBVIEW_CONFIG.ios.cachePattern")

        const wrong = handle_check_config({
            project_path: makeSplashProject({ WEBVIEW_CONFIG: { ios: { cachePattern: 5 } } }),
        })
        expect(fieldsOf(wrong.warnings)).toContain("WEBVIEW_CONFIG.ios.cachePattern")
    })
})

describe("check_config: app id precedence and LOCAL_IP", () => {
    const fieldsOf = (list: Array<{ field: string }>) => list.map((f) => f.field)
    const check = (WEBVIEW_CONFIG: unknown) =>
        handle_check_config({ project_path: makeSplashProject({ WEBVIEW_CONFIG }) })

    it("checks the platform keys even when appId is set, because they win", () => {
        const placeholder = check({
            appId: "com.acme.shop",
            android: { packageName: "io.yourname.androidproject" },
            ios: { bundleIdentifier: "com.example.ios", appBundleId: "com.acme.shop" },
        })
        expect(fieldsOf(placeholder.warnings)).toEqual(
            expect.arrayContaining([
                "WEBVIEW_CONFIG.android.packageName",
                "WEBVIEW_CONFIG.ios.bundleIdentifier",
            ])
        )
        expect(
            placeholder.warnings.find((w) => w.field === "WEBVIEW_CONFIG.android.packageName")!.message
        ).toMatch(/wins over WEBVIEW_CONFIG\.appId/)

        const real = check({
            appId: "com.acme.shop",
            android: { packageName: "com.acme.droid" },
            ios: { appBundleId: "com.acme.iphone" },
        })
        expect(fieldsOf(real.passed)).toEqual(
            expect.arrayContaining(["WEBVIEW_CONFIG.android.packageName", "WEBVIEW_CONFIG.ios.appBundleId"])
        )
    })

    it("passes a LOCAL_IP that is a real host, private ones included, with a note", () => {
        for (const LOCAL_IP of ["10.0.38.192", "staging.acme.com"]) {
            const r = check({ LOCAL_IP })
            expect(fieldsOf(r.warnings)).not.toContain("WEBVIEW_CONFIG.LOCAL_IP")
            const passed = r.passed.find((p) => p.field === "WEBVIEW_CONFIG.LOCAL_IP") as any
            expect(passed.note).toMatch(/instead of the dev server/)
        }
        expect(fieldsOf(check({ LOCAL_IP: "localhost" }).passed)).toContain("WEBVIEW_CONFIG.LOCAL_IP")
    })

    it("warns about a LOCAL_IP that is this machine's own address", () => {
        const loopbackFree = Object.values(os.networkInterfaces())
            .flat()
            .find((entry: any) => entry && !entry.internal && entry.family === "IPv4") as any
        if (!loopbackFree) return
        const r = check({ LOCAL_IP: loopbackFree.address })
        expect(fieldsOf(r.warnings)).toContain("WEBVIEW_CONFIG.LOCAL_IP")
    })
})

// check_config coverage for the on-device AI (catalyst-ai) settings.
const fs = require("fs")
const os = require("os")
const path = require("path")
const {
    handle_check_config,
    isStaleLanAddress,
}: typeof import("../tools/config.js") = require("../tools/config.js")

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

describe("check_config: WEBVIEW_CONFIG.url", () => {
    const urlIssue = (url: string) =>
        handle_check_config({ project_path: makeSplashProject({ WEBVIEW_CONFIG: { url } }) }).issues.find(
            (i) => i.field === "WEBVIEW_CONFIG.url"
        )

    it("rejects what the release build rejects with NATIVE-004", () => {
        const cases: Array<[string, RegExp]> = [
            ["https://shop.acme.com/app", /without a path, query or fragment/],
            ["https://shop.acme.com/?x=1", /without a path, query or fragment/],
            ["https://shop.acme.com/#top", /without a path, query or fragment/],
            ["https://user:secret@shop.acme.com", /user name or password/],
            ["https://user@shop.acme.com", /user name or password/],
            ["https://shop.acme.com:8443", /HTTPS on a port other than 443/],
            ["ftp://shop.acme.com", /https:\/\/ or http:\/\//],
            ["shop.acme.com", /not a URL/],
        ]
        for (const [url, why] of cases) {
            const issue = urlIssue(url)
            expect(issue, url).toBeDefined()
            expect(issue!.message).toMatch(why)
            expect(issue!.message).toMatch(/NATIVE-004/)
        }
    })

    it("accepts an origin, with the default HTTPS port or any HTTP port", () => {
        for (const url of [
            "https://shop.acme.com",
            "https://shop.acme.com/",
            "https://shop.acme.com:443",
            "http://shop.acme.com:8080",
        ]) {
            expect(urlIssue(url), url).toBeUndefined()
        }
    })

    it("warns about a local or private host, IPv6 loopback and 0.0.0.0 included", () => {
        const urlWarning = (url: string, allowPrivateHost?: boolean) =>
            handle_check_config({
                project_path: makeSplashProject({ WEBVIEW_CONFIG: { url, allowPrivateHost } }),
            }).warnings.find((w) => w.field === "WEBVIEW_CONFIG.url")
        for (const url of [
            "http://localhost:3005",
            "http://[::1]:3005",
            "http://0.0.0.0:3005",
            "http://127.0.0.1",
            "http://10.0.0.4",
            "http://172.20.1.1",
            "http://192.168.1.5",
            "http://169.254.0.9",
            "http://my-mac.local",
            "http://app.localhost",
        ]) {
            expect(urlWarning(url)?.message, url).toMatch(/NATIVE-001/)
            expect(urlWarning(url, true), url).toBeUndefined()
        }
        for (const url of ["https://shop.acme.com", "https://localhostshop.com", "http://172.32.0.1"]) {
            expect(urlWarning(url), url).toBeUndefined()
        }
    })
})

// A fresh app from create-catalyst-app 1.2.0: the template config must check
// clean. API_URL ships empty, appInfo ships empty and there is no
// accessControl block; none of them is required by the build.
describe("check_config: the create-catalyst-app template", () => {
    const templateConfig = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "create-catalyst-app",
        "templates",
        "common",
        "config",
        "config.json"
    )

    for (const platform of ["both", "android", "ios"]) {
        it(`reports zero errors for platform ${platform}`, () => {
            const config = JSON.parse(fs.readFileSync(templateConfig, "utf8"))
            const r = handle_check_config({ project_path: makeSplashProject(config), platform })
            expect(r.issues).toEqual([])
            expect(r.summary.errors).toBe(0)
            expect(r.summary.valid).toBe(true)
        })
    }

    it("treats a missing accessControl block as a suggestion", () => {
        const config = JSON.parse(fs.readFileSync(templateConfig, "utf8"))
        const r = handle_check_config({ project_path: makeSplashProject(config) })
        const finding = r.warnings.find((w) => w.field === "WEBVIEW_CONFIG.accessControl")
        expect(finding?.message).toMatch(/^Optional/)
    })

    it("does not require API_URL or appInfo", () => {
        const config = JSON.parse(fs.readFileSync(templateConfig, "utf8"))
        delete config.API_URL
        delete config.WEBVIEW_CONFIG.appInfo
        const r = handle_check_config({ project_path: makeSplashProject(config) })
        const fields = [...r.issues, ...r.warnings].map((f) => f.field)
        expect(fields).not.toContain("API_URL")
        expect(fields).not.toContain("WEBVIEW_CONFIG.appInfo")
    })

    it("still errors on a key catalyst start needs", () => {
        const config = JSON.parse(fs.readFileSync(templateConfig, "utf8"))
        delete config.PUBLIC_STATIC_ASSET_URL
        const r = handle_check_config({ project_path: makeSplashProject(config) })
        expect(r.issues.map((i) => i.field)).toContain("PUBLIC_STATIC_ASSET_URL")
    })

    it("errors only when an enabled allowlist is empty", () => {
        const off = handle_check_config({
            project_path: makeSplashProject({ WEBVIEW_CONFIG: { accessControl: { enabled: false } } }),
        })
        expect(off.issues.map((i) => i.field)).not.toContain("WEBVIEW_CONFIG.accessControl.allowedUrls")
        const on = handle_check_config({
            project_path: makeSplashProject({
                WEBVIEW_CONFIG: { accessControl: { enabled: true, allowedUrls: [] } },
            }),
        })
        expect(on.issues.map((i) => i.field)).toContain("WEBVIEW_CONFIG.accessControl.allowedUrls")
    })
})

describe("check_config: app id and LAN address", () => {
    it("flags an appId with an underscore for iOS (NATIVE-010)", () => {
        const wv = { appId: "com.acme.my_shop" }
        const ios = handle_check_config({
            project_path: makeSplashProject({ WEBVIEW_CONFIG: wv }),
            platform: "ios",
        })
        expect(
            ios.issues.some((i) => i.field === "WEBVIEW_CONFIG.appId" && /NATIVE-010/.test(i.message!))
        ).toBe(true)
        const both = handle_check_config({ project_path: makeSplashProject({ WEBVIEW_CONFIG: wv }) })
        expect(
            both.warnings.some((w) => w.field === "WEBVIEW_CONFIG.appId" && /NATIVE-010/.test(w.message!))
        ).toBe(true)
        const fixed = handle_check_config({
            project_path: makeSplashProject({
                WEBVIEW_CONFIG: { ...wv, ios: { bundleIdentifier: "com.acme.myshop" } },
            }),
            platform: "ios",
        })
        expect(fixed.issues.some((i) => i.field === "WEBVIEW_CONFIG.appId")).toBe(false)
    })

    it("warns about a private LOCAL_IP that NODE_SERVER_HOSTNAME also holds", () => {
        for (const ip of ["192.168.1.20", "10.0.0.4", "172.20.1.1", "169.254.3.3"]) {
            const r = handle_check_config({
                project_path: makeSplashProject({
                    NODE_SERVER_HOSTNAME: ip,
                    WEBVIEW_CONFIG: { LOCAL_IP: ip },
                }),
            })
            const finding = r.warnings.find((w) => w.field === "WEBVIEW_CONFIG.LOCAL_IP")
            expect(finding?.message, ip).toMatch(/localhost/)
            expect(finding?.message, ip).toMatch(/npm run android/)
            // The rewrite runs once per checkout, so a checkout that already
            // ran a 1.2.0 debug build (a canary) has to fix it by hand.
            expect(finding?.message, ip).toMatch(/once per checkout/)
            expect(finding?.message, ip).toMatch(/already ran a 1\.2\.0 debug build.*by hand/)
        }
    })

    it("leaves a LAN staging host, a public host and allowPrivateHost alone", () => {
        expect(
            isStaleLanAddress({
                NODE_SERVER_HOSTNAME: "localhost",
                WEBVIEW_CONFIG: { LOCAL_IP: "192.168.1.20" },
            })
        ).toBe(false)
        expect(
            isStaleLanAddress({ NODE_SERVER_HOSTNAME: "8.8.8.8", WEBVIEW_CONFIG: { LOCAL_IP: "8.8.8.8" } })
        ).toBe(false)
        expect(
            isStaleLanAddress({
                NODE_SERVER_HOSTNAME: "172.32.0.1",
                WEBVIEW_CONFIG: { LOCAL_IP: "172.32.0.1" },
            })
        ).toBe(false)
        expect(
            isStaleLanAddress({
                NODE_SERVER_HOSTNAME: "192.168.1.20",
                WEBVIEW_CONFIG: { LOCAL_IP: "192.168.1.20", allowPrivateHost: true },
            })
        ).toBe(false)
        expect(
            isStaleLanAddress({
                NODE_SERVER_HOSTNAME: "192.168.1.20",
                WEBVIEW_CONFIG: { LOCAL_IP: " 192.168.1.20 " },
            })
        ).toBe(true)
    })
})

describe("check_config: AI_CONFIG.browser.download", () => {
    const run = (download: unknown) =>
        handle_check_config({ project_path: makeProject({ enabled: true }, { browser: { provider: "native", download } }, true) })
    const fields = (r: ReturnType<typeof handle_check_config>) => [...r.issues, ...r.warnings].filter((f) => f.field.includes("download"))

    it("accepts a valid policy", () => {
        expect(fields(run({ minBytesPerSec: 50000, windowSec: 20, resumeDelaySec: 10, maxIdleRetries: 8, heldRetrySec: 30 }))).toEqual([])
    })
    it("is silent when absent", () => {
        const r = handle_check_config({ project_path: makeProject({ enabled: true }, { browser: { provider: "native" } }, true) })
        expect(fields(r)).toEqual([])
    })
    it("rejects a non-object and non-number values", () => {
        expect(run("fast").issues.some((i) => i.field === "AI_CONFIG.browser.download")).toBe(true)
        expect(run([1]).issues.some((i) => i.field === "AI_CONFIG.browser.download")).toBe(true)
        expect(run({ windowSec: "20" }).issues.some((i) => i.field === "AI_CONFIG.browser.download.windowSec")).toBe(true)
    })
    it("warns about out-of-range values (clamped) and unknown keys (ignored)", () => {
        const r = run({ windowSec: 1, maxIdleRetries: 999, heldRetrySec: 1, minBytesPerSecond: 5 })
        const w = r.warnings.map((x) => x.field)
        expect(w).toContain("AI_CONFIG.browser.download.windowSec")
        expect(w).toContain("AI_CONFIG.browser.download.maxIdleRetries")
        expect(w).toContain("AI_CONFIG.browser.download.heldRetrySec")
        expect(w).toContain("AI_CONFIG.browser.download.minBytesPerSecond")
        expect(r.issues.filter((i) => i.field.includes("download"))).toEqual([])
    })
})

describe("check_config: AI_CONFIG.routing", () => {
    const providers = { gemini: { apiKey: "k" } }
    const good = {
        providers,
        routing: {
            policy: { objective: "balanced", order: ["onDevice", "cloud"], cloud: "ask", cloudMedia: "deny" },
            onDevice: { ios: [{ id: "gemma", engine: "litert", modalities: ["text", "image"], ttftMs: 900, tps: 20 }] },
            cloud: [{ id: "flash", provider: "gemini", model: "gemini-3.5-flash", modalities: ["text"] }],
        },
    }
    const run = (aiConfig: unknown, ai: unknown = { enabled: true }) =>
        handle_check_config({ project_path: makeProject(ai, aiConfig, true) })
    const routingFields = (r: ReturnType<typeof handle_check_config>) =>
        [...r.issues, ...r.warnings].filter((f) => f.field.includes("routing"))

    it("passes a valid routing block", () => {
        const r = run(good)
        expect(routingFields(r)).toEqual([])
        expect(r.passed.some((p) => p.field === "AI_CONFIG.routing")).toBe(true)
    })
    it("does nothing when routing is absent", () => {
        expect(routingFields(run({ providers }))).toEqual([])
    })
    it("rejects an unknown objective and bad policy values", () => {
        const r = run({ ...good, routing: { ...good.routing, policy: { objective: "fastest", cloud: "maybe" } } })
        const fields = r.issues.map((i) => i.field)
        expect(fields).toContain("AI_CONFIG.routing.policy.objective")
        expect(fields).toContain("AI_CONFIG.routing.policy.cloud")
    })
    it("flags a cloud model whose provider is not configured", () => {
        const r = run({ ...good, providers: {} })
        expect(r.issues.some((i) => i.field === "AI_CONFIG.routing.cloud[0].provider")).toBe(true)
    })
    it("flags bad modalities, missing ids and duplicate ids in one list", () => {
        const r = run({
            providers,
            routing: { onDevice: { ios: [{ id: "a", modalities: ["video"] }, { modalities: ["text"] }, { id: "b" }, { id: "b" }] } },
        })
        const fields = r.issues.map((i) => i.field)
        expect(fields).toContain("AI_CONFIG.routing.onDevice.ios[0].modalities")
        expect(fields).toContain("AI_CONFIG.routing.onDevice.ios[1]")
        expect(fields).toContain("AI_CONFIG.routing.onDevice.ios[3]")
    })
    it("allows the same id on different platforms", () => {
        const r = run({ providers, routing: { onDevice: { ios: [{ id: "gemma" }], android: [{ id: "gemma" }] } } })
        expect(r.issues.filter((i) => i.field.includes("routing"))).toEqual([])
    })
    it("warns about an order entry that matches nothing, but accepts ids and groups", () => {
        const r = run({ ...good, routing: { ...good.routing, policy: { order: ["flash", "onDevice", "nope"] } } })
        const w = r.warnings.filter((x) => x.field === "AI_CONFIG.routing.policy.order")
        expect(w).toHaveLength(1)
        expect(w[0].message).toContain("nope")
    })
    it("accepts metrics in order and warns when a model id collides with one", () => {
        const ok = run({ ...good, routing: { ...good.routing, policy: { order: ["onDevice", "cost", "latency", "tps"] } } })
        expect(ok.warnings.filter((x) => x.field === "AI_CONFIG.routing.policy.order")).toEqual([])
        const clash = run({ providers, routing: { onDevice: { ios: [{ id: "cost" }] } } })
        expect(clash.warnings.some((x) => x.message.includes("collides"))).toBe(true)
    })
    it("warns when cloud is allowed for media", () => {
        const r = run({ ...good, routing: { ...good.routing, policy: { cloud: "allow" } } })
        expect(r.warnings.some((x) => x.field === "AI_CONFIG.routing.policy")).toBe(true)
    })
    it("warns that on-device models need WEBVIEW_CONFIG.ai.enabled, and that foundation-models is iOS-only", () => {
        const r = run(good, { enabled: false })
        expect(r.warnings.some((x) => x.field === "WEBVIEW_CONFIG.ai.enabled")).toBe(true)
        const a = run({ providers, routing: { onDevice: { android: [{ id: "fm", engine: "foundation-models" }] } } })
        expect(a.warnings.some((x) => x.field === "AI_CONFIG.routing.onDevice.android[0].engine")).toBe(true)
    })
    it("rejects a non-object routing block and negative numbers", () => {
        expect(run({ providers, routing: [] }).issues.some((i) => i.field === "AI_CONFIG.routing")).toBe(true)
        const r = run({ providers, routing: { policy: { constraints: { maxLatencyMs: -1 } }, onDevice: { web: [{ id: "w", tps: -5 }] } } })
        const fields = r.issues.map((i) => i.field)
        expect(fields).toContain("AI_CONFIG.routing.policy.constraints.maxLatencyMs")
        expect(fields).toContain("AI_CONFIG.routing.onDevice.web[0].tps")
    })
})

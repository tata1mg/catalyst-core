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

describe("check_config: routing policy values that are not strings", () => {
    it("reports an object-valued objective instead of throwing", () => {
        const r = handle_check_config({ project_path: makeProject({ enabled: true }, { routing: { policy: { objective: { toString: null }, cloud: ["allow"] } } }, true) })
        const fields = r.issues.map((i) => i.field)
        expect(fields).toContain("AI_CONFIG.routing.policy.objective")
        expect(fields).toContain("AI_CONFIG.routing.policy.cloud")
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
    it("treats names that exist on every object (constructor, toString) as unknown keys instead of throwing", () => {
        const r = run({ constructor: 1, toString: 2 })
        const w = r.warnings.map((x) => x.field)
        expect(w).toContain("AI_CONFIG.browser.download.constructor")
        expect(w).toContain("AI_CONFIG.browser.download.toString")
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
        expect(clash.warnings.some((x) => x.message?.includes("collides"))).toBe(true)
    })
    it("warns when only web models are listed but the app is a native build (they are never used there)", () => {
        const webOnly = { providers, routing: { onDevice: { web: [{ id: "w", model: "m", modalities: ["text"] }] } } }
        expect(run(webOnly).warnings.some((x) => x.field === "AI_CONFIG.routing.onDevice")).toBe(true)
        expect(run(good).warnings.some((x) => x.field === "AI_CONFIG.routing.onDevice")).toBe(false) // has an ios entry
        expect(run(webOnly, { enabled: false }).warnings.some((x) => x.field === "AI_CONFIG.routing.onDevice")).toBe(false) // not a native build
    })
    it("warns about silent media egress only when both effective policies allow it", () => {
        const warned = (policy: object) => run({ ...good, routing: { ...good.routing, policy } }).warnings.some((x) => x.field === "AI_CONFIG.routing.policy")
        expect(warned({ cloud: "allow", cloudMedia: "allow" })).toBe(true)
        // cloudMedia defaults to deny, and "allow" cannot override a stricter cloud policy: the runtime asks or denies here
        expect(warned({ cloud: "allow" })).toBe(false)
        expect(warned({ cloudMedia: "allow" })).toBe(false)
        expect(warned({ cloud: "ask", cloudMedia: "allow" })).toBe(false)
        expect(warned({ cloud: "deny", cloudMedia: "allow" })).toBe(false)
    })
    it("rejects nested routing blocks that are not objects, instead of treating them as absent", () => {
        const fields = (routing: object) => run({ providers, routing }).issues.map((x) => x.field)
        expect(fields({ policy: [] })).toContain("AI_CONFIG.routing.policy")
        expect(fields({ policy: "fast" })).toContain("AI_CONFIG.routing.policy")
        expect(fields({ policy: { constraints: [] } })).toContain("AI_CONFIG.routing.policy.constraints")
        expect(fields({ policy: { weights: 5 } })).toContain("AI_CONFIG.routing.policy.weights")
        expect(fields({ onDevice: [] })).toContain("AI_CONFIG.routing.onDevice")
        expect(fields({ onDevice: "ios" })).toContain("AI_CONFIG.routing.onDevice")
    })
    it("checks the weights and cloud prices the router would otherwise quietly drop", () => {
        const fields = (routing: object) => run({ providers: { gemini: { apiKey: "k" } }, routing }).issues.map((x) => x.field).filter((f) => f.includes("routing"))
        expect(fields({ policy: { weights: { cost: -1, latency: "2", tps: 1 } } })).toEqual(expect.arrayContaining(["AI_CONFIG.routing.policy.weights.cost", "AI_CONFIG.routing.policy.weights.latency"]))
        expect(fields({ policy: { weights: { cost: 2, latency: 1, tps: 0 } } })).toEqual([])
        const cloud = (price: unknown) => ({ cloud: [{ id: "g", provider: "gemini", price }] })
        expect(fields(cloud({ input: 1 }))).toContain("AI_CONFIG.routing.cloud[0].price")
        expect(fields(cloud({ input: "1", output: 2 }))).toContain("AI_CONFIG.routing.cloud[0].price")
        expect(fields(cloud("free"))).toContain("AI_CONFIG.routing.cloud[0].price")
        expect(fields(cloud({ input: 1, output: 2 }))).not.toContain("AI_CONFIG.routing.cloud[0].price")
    })
    it("rejects an empty modalities list: the router would drop that model", () => {
        const r = run({ providers: { gemini: { apiKey: "k" } }, routing: { cloud: [{ id: "g", provider: "gemini", modalities: [] }] } })
        expect(r.issues.map((x) => x.field)).toContain("AI_CONFIG.routing.cloud[0].modalities")
    })
    it("does not accept inherited object names as configured providers", () => {
        for (const provider of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
            const r = run({ providers: { gemini: { apiKey: "k" } }, routing: { cloud: [{ id: "x", provider }] } })
            expect(r.issues.map((x) => x.field), provider).toContain("AI_CONFIG.routing.cloud[0].provider")
        }
    })
    it("flags an id shared by an on-device list and the cloud list, but not by ios and android", () => {
        const dup = (routing: object) => run({ providers: { gemini: { apiKey: "k" } }, routing }).issues.filter((x) => /Duplicate id/.test(x.message ?? "")).length
        expect(dup({ onDevice: { ios: [{ id: "m" }] }, cloud: [{ id: "m", provider: "gemini" }] })).toBe(1)
        expect(dup({ onDevice: { ios: [{ id: "m" }], android: [{ id: "m" }] } })).toBe(0)
        expect(dup({ onDevice: { ios: [{ id: "m" }, { id: "m" }] } })).toBe(1)
    })
    it("still checks AI_CONFIG.routing when WEBVIEW_CONFIG is missing, so one missing block does not hide the other errors", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-nowv-"))
        fs.mkdirSync(path.join(root, "config"))
        fs.writeFileSync(path.join(root, "config", "config.json"), JSON.stringify({ AI_CONFIG: { providers, routing: { policy: { objective: "cheapest-ish" } } } }))
        const fields = handle_check_config({ project_path: root }).issues.map((x) => x.field)
        expect(fields).toContain("WEBVIEW_CONFIG")
        expect(fields).toContain("AI_CONFIG.routing.policy.objective")
    })
    it("warns that native AI is off for any value of ai.enabled other than true", () => {
        const fm = { onDevice: { ios: [{ id: "m" }] } }
        const warned = (enabled: unknown) => run({ providers, routing: fm }, { enabled } as any).warnings.some((x) => x.field === "WEBVIEW_CONFIG.ai.enabled")
        expect(warned(true)).toBe(false)
        for (const off of ["true", "false", 1, false, undefined]) expect(warned(off), String(off)).toBe(true)
    })
    it("warns that on-device models need WEBVIEW_CONFIG.ai.enabled, and that foundation-models is iOS-only", () => {
        const r = run(good, { enabled: false })
        expect(r.warnings.some((x) => x.field === "WEBVIEW_CONFIG.ai.enabled")).toBe(true)
        const a = run({ providers, routing: { onDevice: { android: [{ id: "fm", engine: "foundation-models" }] } } })
        expect(a.warnings.some((x) => x.field === "AI_CONFIG.routing.onDevice.android[0].engine")).toBe(true)
    })
    it("accepts the platform-speech engine on iOS and Android, warns when its modalities or tasks are overridden, and flags it in a browser", () => {
        const ok = run({ providers, routing: { onDevice: { ios: [{ id: "ios-speech", engine: "platform-speech" }], android: [{ id: "android-speech", engine: "platform-speech", modalities: ["audio"], tasks: ["speech.transcribe"] }] } } })
        expect(routingFields(ok).filter((f) => !f.field.endsWith("routing.onDevice"))).toEqual([])
        const changed = run({ providers, routing: { onDevice: { ios: [{ id: "ios-speech", engine: "platform-speech", modalities: ["text", "audio"] }] } } })
        expect(changed.warnings.some((x) => x.field === "AI_CONFIG.routing.onDevice.ios[0]" && /ignored/.test(x.message ?? ""))).toBe(true)
        const web = run({ providers, routing: { onDevice: { web: [{ id: "w", engine: "platform-speech" }] } } })
        expect(web.warnings.some((x) => x.field === "AI_CONFIG.routing.onDevice.web[0].engine" && /only exists in the iOS and Android apps/.test(x.message ?? ""))).toBe(true)
        expect(web.issues.some((x) => x.field === "AI_CONFIG.routing.onDevice.web[0].engine")).toBe(false)
    })
    it("platformSpeech must be a boolean", () => {
        expect(run({ providers, routing: { platformSpeech: false } }).issues.some((x) => x.field === "AI_CONFIG.routing.platformSpeech")).toBe(false)
        expect(run({ providers, routing: { platformSpeech: "no" } }).issues.some((x) => x.field === "AI_CONFIG.routing.platformSpeech")).toBe(true)
    })
    it("accepts the four on-device targets and tasks", () => {
        const r = run({
            providers,
            routing: {
                onDevice: {
                    ios: [{ id: "g", tasks: ["text.generate", "vision.read"] }],
                    "web-desktop": [{ id: "prompt-api", tasks: ["text.generate"] }],
                    "web-mobile": [{ id: "small", tasks: ["text.generate"] }],
                },
                cloud: [{ id: "flash", provider: "gemini", tasks: ["image.generate", "embed"] }],
            },
        })
        expect(routingFields(r).filter((f) => !f.field.endsWith("routing.onDevice"))).toEqual([])
    })
    it("rejects unknown or empty tasks and warns about an unknown platform key", () => {
        const r = run({ providers, routing: { onDevice: { tvos: [{ id: "a" }], ios: [{ id: "b", tasks: ["telepathy"] }, { id: "c", tasks: [] }, { id: "d", tasks: "embed" }] } } })
        const fields = r.issues.map((i) => i.field)
        expect(fields).toContain("AI_CONFIG.routing.onDevice.ios[0].tasks")
        expect(fields).toContain("AI_CONFIG.routing.onDevice.ios[1].tasks")
        expect(fields).toContain("AI_CONFIG.routing.onDevice.ios[2].tasks")
        expect(r.warnings.some((x) => x.field === "AI_CONFIG.routing.onDevice.tvos")).toBe(true)
    })
    it("web-desktop / web-mobile models count as in-browser, never used in a native build", () => {
        const webOnly = { providers, routing: { onDevice: { "web-mobile": [{ id: "w", modalities: ["text"] }] } } }
        expect(run(webOnly).warnings.some((x) => x.field === "AI_CONFIG.routing.onDevice")).toBe(true)
    })
    it("accepts prompt-api and transformers for browser entries, flags unknown engines and native engines on the web", () => {
        const ok = run({ providers, routing: { onDevice: { "web-desktop": [{ id: "c", engine: "prompt-api" }, { id: "t", engine: "transformers", model: "m" }] } } })
        expect(routingFields(ok).filter((f) => f.field.includes(".engine"))).toEqual([])
        const bad = run({ providers, routing: { onDevice: { "web-desktop": [{ id: "a", engine: "litert" }, { id: "b", engine: "wasm" }] } } })
        const fields = bad.issues.map((i) => i.field)
        expect(fields).toContain("AI_CONFIG.routing.onDevice.web-desktop[0].engine")
        expect(fields).toContain("AI_CONFIG.routing.onDevice.web-desktop[1].engine")
    })
    it("warns that prompt-api is desktop-only, and accepts image/audio modalities for it (the engine takes them)", () => {
        const r = run({ providers, routing: { onDevice: { "web-mobile": [{ id: "m", engine: "prompt-api" }], web: [{ id: "i", engine: "prompt-api", modalities: ["text", "image"] }] } } })
        expect(r.warnings.some((w) => w.field === "AI_CONFIG.routing.onDevice.web-mobile[0].engine")).toBe(true)
        expect(r.warnings.some((w) => w.field === "AI_CONFIG.routing.onDevice.web[0].modalities")).toBe(false)
    })
    it("rejects a non-object routing block and negative numbers", () => {
        expect(run({ providers, routing: [] }).issues.some((i) => i.field === "AI_CONFIG.routing")).toBe(true)
        const r = run({ providers, routing: { policy: { constraints: { maxLatencyMs: -1 } }, onDevice: { web: [{ id: "w", tps: -5 }] } } })
        const fields = r.issues.map((i) => i.field)
        expect(fields).toContain("AI_CONFIG.routing.policy.constraints.maxLatencyMs")
        expect(fields).toContain("AI_CONFIG.routing.onDevice.web[0].tps")
    })
})

describe("check_config: WebBridge.init() in the client entry (#529)", () => {
    const entry = (body: string) => `import WebBridge from "catalyst-core/WebBridge"\n${body}`
    const inside = entry(`window.addEventListener("load", () => { hydrationReady().then(() => { WebBridge.init(); hydrateRoot(el, app) }) })`)
    function project(files: Record<string, string>): string {
        const root = makeProject({ enabled: false }, {}, false)
        for (const [rel, body] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
            fs.writeFileSync(path.join(root, rel), body)
        }
        return root
    }
    const bridge = (files: Record<string, string>) => {
        const r = handle_check_config({ project_path: project(files) })
        return { warn: r.warnings.find((w) => w.field.includes("WebBridge")), ok: r.passed.find((p) => p.field.includes("WebBridge")) }
    }
    const hooks = { "src/js/Page.js": `import { useCamera } from "catalyst-core/hooks"\n` }

    it("names the entry file it actually checked, not always client/index.js", () => {
        const ok = bridge({ ...hooks, "client/index.tsx": inside })
        expect(ok.ok?.field).toBe("client/index.tsx: WebBridge.init()")
        const bad = bridge({ ...hooks, "client/index.ts": entry("hydrateRoot(el, app)") })
        expect(bad.warn?.field).toBe("client/index.ts: WebBridge.init()")
        const none = bridge({ ...hooks })
        expect(none.warn?.field).toContain("client entry")
        expect(none.warn?.message).toContain("client/index.tsx")
    })

    it("passes when init is inside hydrationReady", () => {
        const r = bridge({ ...hooks, "client/index.js": inside })
        expect(r.warn).toBeUndefined()
        expect(r.ok).toBeDefined()
    })
    it("warns when native hooks are used and init is missing, with the snippet", () => {
        const r = bridge({ ...hooks, "client/index.js": entry(`hydrationReady().then(() => hydrateRoot(el, app))`) })
        expect(r.warn?.message).toContain("never calls WebBridge.init()")
        expect(r.warn?.message).toContain("hydrationReady().then")
    })
    it("warns when no client entry exists", () => {
        expect(bridge(hooks).warn?.message).toContain("no client entry")
    })
    it("warns when init runs before hydrationReady (module scope)", () => {
        const r = bridge({ ...hooks, "client/index.js": entry(`WebBridge.init()\nhydrationReady().then(() => hydrateRoot(el, app))`) })
        expect(r.warn?.message).toContain("before hydrationReady()")
        expect(r.warn?.message).toContain("useContext")
    })
    it("warns when WebBridge is not imported", () => {
        const r = bridge({ ...hooks, "client/index.js": `hydrationReady().then(() => { WebBridge.init() })` })
        expect(r.warn?.message).toContain("does not import WebBridge")
    })
    it("an unrelated WebBridge from another package does not satisfy the check", () => {
        const wrong = bridge({ ...hooks, "client/index.js": `import WebBridge from "another-package"\nhydrationReady().then(() => { WebBridge.init() })` })
        expect(wrong.warn?.message).toContain("does not import WebBridge")
        const right = bridge({ ...hooks, "client/index.js": `import WebBridge from "catalyst-core/WebBridge"\nhydrationReady().then(() => { WebBridge.init() })` })
        expect(right.warn).toBeUndefined()
        const cjs = bridge({ ...hooks, "client/index.js": `const WebBridge = require("catalyst-core/WebBridge")\nhydrationReady().then(() => { WebBridge.init() })` })
        expect(cjs.warn).toBeUndefined()
    })
    it("stays quiet without native hooks, and when only useAI is imported", () => {
        expect(bridge({ "client/index.js": entry(`hydrateRoot(el, app)`) }).warn).toBeUndefined()
        const onlyAI = { "src/a.js": `import { useAI } from "catalyst-core/hooks"\n`, "client/index.js": entry(`hydrateRoot(el, app)`) }
        expect(bridge(onlyAI).warn).toBeUndefined()
    })
    it("does not count useVision either, alone or with useAI", () => {
        const only = { "src/a.js": `import { useVision, useAI } from "catalyst-core/hooks"\n`, "client/index.js": entry(`hydrateRoot(el, app)`) }
        expect(bridge(only).warn).toBeUndefined()
    })
    it("counts useAI alongside another hook as native use", () => {
        const mixed = { "src/a.js": `import { useAI, useCamera } from "catalyst-core/hooks"\n`, "client/index.js": entry(`hydrateRoot(el, app)`) }
        expect(bridge(mixed).warn).toBeDefined()
    })
})

describe("check_config: AI_CONFIG.pricing", () => {
    const providers = { openai: { apiKey: "k", defaultModel: "brand-new-model" }, gemini: { apiKey: "k", defaultModel: "gemini-3.5-flash" } }
    // A catalyst-ai whose built-in table knows only gemini-3.5-flash, so which models are "covered" is deterministic.
    function projectWithBuiltIns(aiConfig: unknown): string {
        const root = makeProject({ enabled: true }, aiConfig, true)
        fs.mkdirSync(path.join(root, "node_modules", "catalyst-ai", "src"), { recursive: true })
        fs.writeFileSync(path.join(root, "node_modules", "catalyst-ai", "src", "pricing.js"), 'module.exports = { PRICING: { "gemini-3.5-flash": {} } }')
        return root
    }
    const fieldsOf = (r: ReturnType<typeof handle_check_config>) => [...r.issues, ...r.warnings].map((f) => f.field)

    it("warns about a cloud model nobody has priced, but not about built-in or configured ones", () => {
        const r = handle_check_config({ project_path: projectWithBuiltIns({ providers }) })
        expect(fieldsOf(r)).toContain("AI_CONFIG.pricing.brand-new-model")
        expect(fieldsOf(r)).not.toContain("AI_CONFIG.pricing.gemini-3.5-flash")
        const priced = handle_check_config({ project_path: projectWithBuiltIns({ providers, pricing: { "brand-new-model": { input: 2, output: 10 } } }) })
        expect(fieldsOf(priced)).not.toContain("AI_CONFIG.pricing.brand-new-model")
        expect(priced.passed.some((p) => p.field === "AI_CONFIG.pricing")).toBe(true)
    })
    it("also checks models named in routing.cloud", () => {
        const r = handle_check_config({ project_path: projectWithBuiltIns({ providers: { openai: { apiKey: "k" } }, routing: { cloud: [{ id: "x", provider: "openai", model: "routed-model" }] } }) })
        expect(fieldsOf(r)).toContain("AI_CONFIG.pricing.routed-model")
    })
    it("rejects a non-object block and bad numbers", () => {
        expect(handle_check_config({ project_path: projectWithBuiltIns({ providers, pricing: [] }) }).issues.map((i) => i.field)).toContain("AI_CONFIG.pricing")
        const bad = handle_check_config({ project_path: projectWithBuiltIns({ providers, pricing: { a: { input: -1, output: 2 }, b: { input: 1 }, c: "x", d: { input: 1, output: 2, cachedInput: "y" } } }) })
        const fields = bad.issues.map((i) => i.field)
        expect(fields).toContain("AI_CONFIG.pricing.a.input")
        expect(fields).toContain("AI_CONFIG.pricing.b.output")
        expect(fields).toContain("AI_CONFIG.pricing.c")
        expect(fields).toContain("AI_CONFIG.pricing.d.cachedInput")
    })
    it("says nothing about unpriced models when catalyst-ai is not installed (it cannot know what is covered)", () => {
        const r = handle_check_config({ project_path: makeProject({ enabled: true }, { providers }, false) })
        expect(fieldsOf(r).filter((f) => f.startsWith("AI_CONFIG.pricing"))).toEqual([])
    })
})

describe("built-in prices are read as text, never by running the project's code", () => {
    const { priceKeysFromSource, readBuiltInPriceKeys }: any = require("../tools/config.js")

    it("lists the keys of the PRICING table and of every Object.assign(PRICING, ...) block", () => {
        const source = `// header
const PRICING = {
    // a comment: with a colon
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gemini-3.5-flash": { input: 1.5, output: 9 },
}
Object.assign(PRICING, {
    "claude-opus-5": { input: 5, output: 25 },
})
const OTHER = { "not-a-model": { input: 1 } }`
        expect(priceKeysFromSource(source)).toEqual(["gpt-4o-mini", "gemini-3.5-flash", "claude-opus-5"])
    })

    it("returns null for a file that has no price table, or no file at all", () => {
        expect(priceKeysFromSource("module.exports = {}")).toBeNull()
        expect(priceKeysFromSource(undefined)).toBeNull()
    })

    it("finds the installed catalyst-ai, including a hoisted one, without executing it", () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-prices-"))
        const marker = path.join(base, "executed.txt")
        const pkg = path.join(base, "node_modules", "catalyst-ai", "src")
        fs.mkdirSync(pkg, { recursive: true })
        fs.writeFileSync(
            path.join(pkg, "pricing.js"),
            `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran")\nconst PRICING = { "model-a": { input: 1, output: 2 } }\n`
        )
        const app = path.join(base, "packages", "app")
        fs.mkdirSync(app, { recursive: true })
        expect(readBuiltInPriceKeys(base)).toEqual(["model-a"])
        expect(readBuiltInPriceKeys(app)).toEqual(["model-a"]) // hoisted to a parent node_modules
        expect(fs.existsSync(marker)).toBe(false) // the project's code was only read, never run
    })

    it("reads the real catalyst-ai table: the same names the package exports", async () => {
        const real = fs.readFileSync(path.join(__dirname, "..", "..", "..", "catalyst-ai", "src", "pricing.js"), "utf8")
        const { PRICING } = await import("../../../catalyst-ai/src/pricing.js")
        expect([...priceKeysFromSource(real)].sort()).toEqual(Object.keys(PRICING).sort())
    })
})

describe("which hook imports count as native hook use", () => {
    const { usesNativeHooks }: any = require("../lib/helpers.js")
    const cases: Array<[string, boolean]> = [
        ['import { useCamera } from "catalyst-core/hooks"', true],
        ['import { useAI, useCamera } from "catalyst-core/hooks"', true],
        ['import { useAI } from "catalyst-core/hooks"', false],
        ['import { useAI as ai, useVision } from "catalyst-core/hooks"', false],
        // erased by the compiler: not runtime use of any hook
        ['import type { useCamera } from "catalyst-core/hooks"', false],
        ['import { type useCamera, useAI } from "catalyst-core/hooks"', false],
        // the same exemption for the CommonJS form
        ['const { useAI } = require("catalyst-core/hooks")', false],
        ['const { useAI: ai, useVision } = require("catalyst-core/hooks")', false],
        ['const { useCamera } = require("catalyst-core/hooks")', true],
        // the whole module: which hooks are used cannot be told
        ['const hooks = require("catalyst-core/hooks")', true],
        ['import hooks from "catalyst-core/hooks"', true],
        ['import * as hooks from "catalyst-core/hooks"', true],
        ['import { useCamera } from "somewhere-else"', false],
    ]
    it.each(cases)("%s -> %s", (source, expected) => {
        expect(usesNativeHooks(source)).toBe(expected)
    })

    it("the answer does not depend on what was checked before (no regex state is shared between calls)", () => {
        for (let i = 0; i < 3; i++) for (const [source, expected] of cases) expect(usesNativeHooks(source)).toBe(expected)
    })
})

describe("check_config: the 1.3.0 switches (CSP nonce, offline snapshots, location)", () => {
    function projectWith(config: Record<string, unknown>): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-flags-"))
        fs.mkdirSync(path.join(root, "config"))
        fs.writeFileSync(path.join(root, "config", "config.json"), JSON.stringify(config))
        return root
    }
    const check = (config: Record<string, unknown>, platform: "android" | "ios" | "both" = "both") => {
        const r = handle_check_config({ project_path: projectWith({ WEBVIEW_CONFIG: { LOCAL_IP: "192.168.0.11" }, ...config }), platform } as any)
        const find = (field: string) => ({ warn: r.warnings.find((w) => w.field === field), ok: r.passed.find((p) => p.field === field) })
        return { r, find }
    }

    it("CSP_NONCE_ENABLE: true passes; the string \"true\" is called out because it leaves the nonce OFF", () => {
        expect(check({ CSP_NONCE_ENABLE: true }).find("CSP_NONCE_ENABLE").ok).toBeTruthy()
        expect(check({ CSP_NONCE_ENABLE: false }).find("CSP_NONCE_ENABLE")).toEqual({ warn: undefined, ok: undefined })
        const bad = check({ CSP_NONCE_ENABLE: "true" }).find("CSP_NONCE_ENABLE")
        expect(bad.warn?.message).toMatch(/Only the boolean true turns the CSP nonce on, so it stays OFF/)
        expect(check({ CSP_NONCE_ENABLE: 1 }).find("CSP_NONCE_ENABLE").warn).toBeTruthy()
        expect(check({}).find("CSP_NONCE_ENABLE")).toEqual({ warn: undefined, ok: undefined }) // absent is fine
    })

    it("OFFLINE_SNAPSHOTS_ENABLE: booleans and \"false\" are fine; a value that would leave the worker ON is called out", () => {
        for (const ok of [true, false, "false", "true"]) expect(check({ OFFLINE_SNAPSHOTS_ENABLE: ok }).find("OFFLINE_SNAPSHOTS_ENABLE").warn, String(ok)).toBeUndefined()
        for (const bad of [0, "no", null, "off"]) {
            expect(check({ OFFLINE_SNAPSHOTS_ENABLE: bad }).find("OFFLINE_SNAPSHOTS_ENABLE").warn?.message, String(bad)).toMatch(/leaves them ON/)
        }
    })

    it("location.enabled: a string, even \"false\", is called out because the build would turn location ON", () => {
        const wrong = check({ WEBVIEW_CONFIG: { LOCAL_IP: "192.168.0.11", location: { enabled: "false" } } }).find("WEBVIEW_CONFIG.location.enabled")
        expect(wrong.warn?.message).toMatch(/even "false", turns location ON/)
        expect(check({ WEBVIEW_CONFIG: { LOCAL_IP: "192.168.0.11", location: { enabled: 1 } } }).find("WEBVIEW_CONFIG.location.enabled").warn).toBeTruthy()
    })

    it("location: a non-object, and a usageDescription that is not text, are reported", () => {
        expect(check({ WEBVIEW_CONFIG: { LOCAL_IP: "192.168.0.11", location: true } }).find("WEBVIEW_CONFIG.location").warn?.message).toMatch(/should be an object/)
        expect(check({ WEBVIEW_CONFIG: { LOCAL_IP: "192.168.0.11", location: { enabled: true, usageDescription: 5 } } }).find("WEBVIEW_CONFIG.location.usageDescription").warn?.message).toMatch(/should be a string/)
    })

    it("location enabled with text passes; without text, iOS (not Android-only) is told it will use the generic default", () => {
        const withText = check({ WEBVIEW_CONFIG: { LOCAL_IP: "192.168.0.11", location: { enabled: true, usageDescription: "Show stores near you" } } })
        expect(withText.find("WEBVIEW_CONFIG.location").ok).toBeTruthy()
        expect(withText.find("WEBVIEW_CONFIG.location.usageDescription").warn).toBeUndefined()
        const noText = { WEBVIEW_CONFIG: { LOCAL_IP: "192.168.0.11", location: { enabled: true } } }
        expect(check(noText, "ios").find("WEBVIEW_CONFIG.location.usageDescription").warn?.message).toMatch(/generic default text/)
        expect(check(noText, "android").find("WEBVIEW_CONFIG.location.usageDescription").warn).toBeUndefined()
    })

    it("location off or absent says nothing", () => {
        expect(check({ WEBVIEW_CONFIG: { LOCAL_IP: "192.168.0.11", location: { enabled: false } } }).find("WEBVIEW_CONFIG.location")).toEqual({ warn: undefined, ok: undefined })
        expect(check({}).find("WEBVIEW_CONFIG.location")).toEqual({ warn: undefined, ok: undefined })
    })

    it("the web switches are still checked when WEBVIEW_CONFIG is missing", () => {
        const r = handle_check_config({ project_path: projectWith({ CSP_NONCE_ENABLE: "true" }) } as any)
        expect(r.issues.some((i) => i.field === "WEBVIEW_CONFIG")).toBe(true)
        expect(r.warnings.some((w) => w.field === "CSP_NONCE_ENABLE")).toBe(true)
    })
})

describe("check_config: review backlog", () => {
    const tmp = (files: Record<string, string>) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-backlog-"))
        for (const [rel, body] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
            fs.writeFileSync(path.join(root, rel), body)
        }
        return root
    }
    const entry = (body: string) => `import WebBridge from "catalyst-core/WebBridge"\n${body}`
    const hooks = { "src/js/Page.js": `import { useCamera } from "catalyst-core/hooks"\n` }
    const inspect = (files: Record<string, string>) => require("../lib/helpers.js").inspectWebBridgeInit(tmp(files))

    it("a project with no native hooks is left alone, however it calls WebBridge.init()", () => {
        expect(inspect({ "client/index.js": `WebBridge.init()\nhydrateRoot(el, app)` }).state).toBe("no-hooks") // not even the missing import
        expect(inspect({ "client/index.js": `import WebBridge from "x"\nhydrationReady().then(() => WebBridge.init())` }).state).toBe("no-hooks")
    })

    it("a commented-out WebBridge.init() is not the call", () => {
        const body = `hydrationReady().then(() => {\n    // WebBridge.init()\n    /* WebBridge.init() */\n    hydrateRoot(el, app)\n})`
        expect(inspect({ ...hooks, "client/index.js": entry(body) }).state).toBe("missing-init")
    })
    it("init that comes after hydrateRoot is misplaced: the first render has already run without the bridge", () => {
        expect(inspect({ ...hooks, "client/index.js": entry(`hydrationReady().then(() => { hydrateRoot(el, app); WebBridge.init() })`) }).state).toBe("misplaced")
        expect(inspect({ ...hooks, "client/index.js": entry(`hydrationReady().then(() => { WebBridge.init(); hydrateRoot(el, app) })`) }).state).toBe("ok")
        // 0.2.x waits for loadableReady, not hydrationReady: still fine while init comes first
        expect(inspect({ ...hooks, "client/index.js": entry(`loadableReady(() => { WebBridge.init(); hydrateRoot(el, app) })`) }).state).toBe("ok")
    })

    it("a namespace import of the hooks counts as using native hooks", () => {
        const { usesNativeHooks } = require("../lib/helpers.js")
        expect(usesNativeHooks(`import * as Hooks from "catalyst-core/hooks"\nHooks.useCamera()`)).toBe(true)
    })

    it("reads each source file once however many questions are asked of it", () => {
        const root = tmp({ ...hooks, "src/js/Other.js": "export const x = 1", "client/index.js": entry(`hydrationReady().then(() => { WebBridge.init(); hydrateRoot(el, app) })`) })
        const reads: string[] = []
        const original = fs.readFileSync
        const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((p: any, ...rest: any[]) => { reads.push(String(p)); return (original as any)(p, ...rest) }) as any)
        try {
            require("../lib/helpers.js").inspectWebBridgeInit(root)
        } finally {
            spy.mockRestore()
        }
        const mine = reads.filter((p) => p.startsWith(root))
        expect(new Set(mine).size).toBe(mine.length) // no file twice
    })

    it("an unknown engine in a native entry lists every accepted engine, including auto", () => {
        const root = tmp({ "config/config.json": JSON.stringify({ WEBVIEW_CONFIG: { LOCAL_IP: "192.168.0.11", ai: { enabled: true } }, AI_CONFIG: { enabled: true, routing: { onDevice: { ios: [{ id: "x", engine: "mystery" }] } } } }) })
        fs.mkdirSync(path.join(root, "node_modules", "catalyst-ai"), { recursive: true })
        fs.writeFileSync(path.join(root, "node_modules", "catalyst-ai", "package.json"), "{}")
        const r = handle_check_config({ project_path: root })
        const issue = r.issues.find((i) => /Unknown engine "mystery"/.test(i.message ?? ""))
        expect(issue?.message).toMatch(/auto, litert, foundation-models, platform-speech/)
    })

    it("a warning about the Android list is not shown when the target is iOS, but a structural error still is", () => {
        const config = { WEBVIEW_CONFIG: { LOCAL_IP: "192.168.0.11", ai: { enabled: true } }, AI_CONFIG: { enabled: true, routing: { onDevice: { android: [{ id: "a", engine: "foundation-models" }, { id: "" }] } } } }
        const root = tmp({ "config/config.json": JSON.stringify(config) })
        fs.mkdirSync(path.join(root, "node_modules", "catalyst-ai"), { recursive: true })
        fs.writeFileSync(path.join(root, "node_modules", "catalyst-ai", "package.json"), "{}")
        const forIos = handle_check_config({ project_path: root, platform: "ios" } as any)
        const forAndroid = handle_check_config({ project_path: root, platform: "android" } as any)
        const mentionsFm = (r: any) => [...r.warnings, ...r.issues].some((f: any) => /foundation-models is iOS-only/.test(f.message))
        expect(mentionsFm(forAndroid)).toBe(true)
        expect(mentionsFm(forIos)).toBe(false) // an inactive platform's entry is not reported as a problem for this build
        expect(forIos.issues.some((i: any) => /needs a string "id"/.test(i.message))).toBe(true) // but a broken entry is
    })

    it("the image-capable provider list matches the adapters that the route really has", () => {
        const source = fs.readFileSync(path.join(__dirname, "..", "..", "..", "catalyst-ai", "src", "imageGen.js"), "utf8")
        const adapters = /return \{ ([^}]*) \}\s*\n\}\s*\n\s*module\.exports/.exec(source)?.[1] ?? ""
        const names = [...adapters.matchAll(/(\w+):/g)].map((m) => m[1]).sort()
        expect(names).toEqual(["gemini", "openai"])
        const configSource = fs.readFileSync(path.join(__dirname, "..", "tools", "config.js"), "utf8")
        const listed = /const IMAGE_PROVIDERS = \[([^\]]*)\]/.exec(configSource)?.[1] ?? ""
        expect([...listed.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort()).toEqual(names) // a new adapter must be added to check_config too
    })
})

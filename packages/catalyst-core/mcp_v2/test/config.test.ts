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
    it("stays quiet without native hooks, and when only useAI is imported", () => {
        expect(bridge({ "client/index.js": entry(`hydrateRoot(el, app)`) }).warn).toBeUndefined()
        const onlyAI = { "src/a.js": `import { useAI } from "catalyst-core/hooks"\n`, "client/index.js": entry(`hydrateRoot(el, app)`) }
        expect(bridge(onlyAI).warn).toBeUndefined()
    })
    it("counts useAI alongside another hook as native use", () => {
        const mixed = { "src/a.js": `import { useAI, useCamera } from "catalyst-core/hooks"\n`, "client/index.js": entry(`hydrateRoot(el, app)`) }
        expect(bridge(mixed).warn).toBeDefined()
    })
})

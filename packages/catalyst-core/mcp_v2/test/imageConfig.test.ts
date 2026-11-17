// check_config coverage for provider imageModel and per-image pricing (AI_CONFIG).
const fs = require("fs")
const os = require("os")
const path = require("path")
const { handle_check_config }: typeof import("../tools/config.js") = require("../tools/config.js")

type Result = ReturnType<typeof handle_check_config>

function run(ai: Record<string, unknown>): Result {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-img-"))
    fs.mkdirSync(path.join(root, "config"))
    const config = { WEBVIEW_CONFIG: { LOCAL_IP: "192.168.0.11" }, AI_CONFIG: { enabled: true, ...ai } }
    fs.writeFileSync(path.join(root, "config", "config.json"), JSON.stringify(config))
    return handle_check_config({ project_path: root })
}
const field = (r: Result, f: string) => [...r.issues, ...r.warnings].filter((x) => x.field === f)

describe("check_config: image models and per-image pricing", () => {
    it("accepts a valid imageModel on a provider that can draw", () => {
        const r = run({ providers: { openai: { apiKey: "k", defaultModel: "gpt-5", imageModel: "gpt-image-1" } }, pricing: { "gpt-image-1": { perImage: 0.04 } } })
        expect(field(r, "AI_CONFIG.providers.openai.imageModel")).toEqual([])
        expect(field(r, "AI_CONFIG.pricing.gpt-image-1")).toEqual([])
        expect(r.passed.some((p) => p.field === "AI_CONFIG.providers.*.imageModel")).toBe(true)
        expect(r.passed.some((p) => p.field === "AI_CONFIG.pricing")).toBe(true)
    })
    it("rejects a malformed imageModel", () => {
        for (const imageModel of ["bad model", "x/y", "", 5, null]) {
            const r = run({ providers: { openai: { apiKey: "k", imageModel } } })
            expect(field(r, "AI_CONFIG.providers.openai.imageModel")[0]).toMatchObject({ severity: "error" })
        }
    })
    it("warns when a provider that cannot draw sets imageModel", () => {
        const r = run({ providers: { anthropic: { apiKey: "k", imageModel: "claude-image" } } })
        const [w] = field(r, "AI_CONFIG.providers.anthropic.imageModel")
        expect(w.message).toMatch(/cannot generate images/)
        expect(r.issues.some((i) => i.field.includes("imageModel"))).toBe(false)
    })
    it("warns that an unpriced image model has unknown cost", () => {
        const r = run({ providers: { gemini: { apiKey: "k", imageModel: "gemini-img" } } })
        expect(field(r, "AI_CONFIG.pricing.gemini-img")[0].message).toMatch(/cost is reported as unknown/)
    })
    it("validates perImage, and allows perImage-only entries", () => {
        const bad = run({ pricing: { a: { input: 1, output: 2, perImage: -1 }, b: { perImage: "x" } } })
        expect(field(bad, "AI_CONFIG.pricing.a.perImage")).toHaveLength(1)
        expect(field(bad, "AI_CONFIG.pricing.b.perImage")).toHaveLength(1)
        const ok = run({ pricing: { a: { perImage: 0.04 } } })
        expect(ok.issues.filter((i) => i.field.startsWith("AI_CONFIG.pricing"))).toEqual([])
        // token prices are still required when perImage is not the only thing set
        expect(field(run({ pricing: { c: { input: 1 } } }), "AI_CONFIG.pricing.c.output")).toHaveLength(1)
    })
    it("still validates routing tasks alongside image models", () => {
        const routing = {
            cloud: [
                { id: "c", provider: "openai", model: "gpt-image-1", modalities: ["text"], tasks: ["image.generate"] },
                { id: "d", provider: "openai", model: "m", tasks: ["draw"] },
            ],
        }
        const r = run({ providers: { openai: { apiKey: "k", imageModel: "gpt-image-1" } }, routing })
        expect(field(r, "AI_CONFIG.routing.cloud[0].tasks")).toEqual([])
        expect(field(r, "AI_CONFIG.routing.cloud[1].tasks")[0]).toMatchObject({ severity: "error" })
    })
})

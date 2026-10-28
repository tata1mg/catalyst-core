import { describe, expect, it } from "vitest"
import { chooseCandidate, normalizeRouting, recordObserved, type Signals } from "../../src/native/bridge/hooks/aiRouter"

const config = {
    policy: { objective: "balanced" },
    onDevice: {
        ios: [
            { id: "gemma-e2b", engine: "litert", modalities: ["text", "image", "audio"], ttftMs: 900, tps: 25, loadMs: 3000 },
            { id: "gemma-e4b", engine: "litert", model: "e4b", modalities: ["text", "image"], ttftMs: 1800, tps: 12, loadMs: 6000 },
            { id: "apple-fm", engine: "foundation-models", modalities: ["text"], ttftMs: 400, tps: 40, loadMs: 0 },
        ],
        android: [{ id: "gemma-android", modalities: ["text", "image", "audio"], ttftMs: 1200, tps: 18 }],
        web: [{ id: "gemma-web", model: "onnx/gemma", modalities: ["text", "image", "audio"], ttftMs: 2000, tps: 9 }],
    },
    cloud: [
        { id: "gemini", provider: "gemini", model: "gemini-3.5-flash", modalities: ["text", "image", "audio"], ttftMs: 700, tps: 120, price: { input: 1.5, output: 9 } },
        { id: "gpt-mini", provider: "openai", model: "gpt-4o-mini", modalities: ["text", "image"], ttftMs: 600, tps: 90, price: { input: 0.15, output: 0.6 } },
    ],
}
const sig = (o: Partial<Signals> = {}): Signals => ({ platform: "ios", nativeAvailable: true, webgpu: true, online: true, webModelLoaded: true, loadedId: null, ...o })
const setup = (platform: any = "ios", override: any = null, c: any = config) => normalizeRouting(c, platform, override, () => {})
const pick = (mods: any[], s: Signals, o: any = null, consent = {}, observed = {}, c: any = config) => {
    const r = setup(s.platform, o, c)
    return chooseCandidate(mods, r.candidates, s, r.policy, observed, consent)
}

describe("normalizeRouting", () => {
    it("takes the platform's models plus web and cloud, nothing from other platforms", () => {
        const ids = setup("ios").candidates.map((c) => c.id)
        expect(ids).toEqual(["gemma-e2b", "gemma-e4b", "apple-fm", "gemma-web", "gemini", "gpt-mini"])
        expect(setup("android").candidates.map((c) => c.id)).toContain("gemma-android")
        expect(setup("web").candidates.map((c) => c.id)).toEqual(["gemma-web", "gemini", "gpt-mini"])
    })
    it("drops bad entries with a warning instead of throwing", () => {
        const warnings: string[] = []
        const r = normalizeRouting({ cloud: [{ id: "x" }, { provider: "p" }, { id: "ok", provider: "p" }] }, "web", null, (m) => warnings.push(m))
        expect(r.candidates.map((c) => c.id)).toEqual(["ok"])
        expect(warnings).toHaveLength(2)
    })
    it("defaults: cloud asks, cloud media denied; per-call override wins", () => {
        expect(setup().policy).toMatchObject({ cloud: "ask", cloudMedia: "deny", objective: "balanced" })
        expect(setup("ios", { cloud: "allow", objective: "cost" }).policy).toMatchObject({ cloud: "allow", objective: "cost" })
    })
    it("explicit weights override the objective preset", () => {
        expect(setup("ios", { objective: "cost", weights: { tps: 1 } }).policy.weights).toMatchObject({ cost: 0.8, tps: 1 })
    })
})

describe("chooseCandidate: availability and privacy", () => {
    it("picks an on-device model that serves the modalities", () => {
        const d = pick(["text", "audio"], sig())
        expect(d.candidate?.id).toBe("gemma-e2b")
        expect(d.skipped.find((s) => s.id === "apple-fm")?.why).toBe("no audio support")
    })
    it("skips native models when the bridge is missing", () => {
        expect(pick(["text"], sig({ nativeAvailable: false })).candidate?.id).toBe("gemma-web")
    })
    it("never goes to cloud for media by default, even offline-capable otherwise", () => {
        const d = pick(["image"], sig({ nativeAvailable: false, webgpu: false }))
        expect(d).toMatchObject({ action: "deny", candidate: null })
    })
    it("asks before cloud for text, runs after consent", () => {
        const s = sig({ nativeAvailable: false, webgpu: false })
        expect(pick(["text"], s)).toMatchObject({ action: "ask" })
        expect(pick(["text"], s, null, { cloud: true })).toMatchObject({ action: "run" })
    })
    it("honours the configured provider list and offline state", () => {
        const s = sig({ nativeAvailable: false, webgpu: false })
        const d = pick(["text"], { ...s, cloudProviders: ["openai"] }, { cloud: "allow" })
        expect(d.candidate?.id).toBe("gpt-mini")
        expect(pick(["text"], { ...s, online: false }, { cloud: "allow" }).action).toBe("deny")
    })
    it("asks for download consent before the web model", () => {
        const s = sig({ nativeAvailable: false, webModelLoaded: false })
        expect(pick(["text"], s, { cloud: "deny" })).toMatchObject({ action: "ask", candidate: { id: "gemma-web" } })
        expect(pick(["text"], s, { cloud: "deny" }, { download: true }).action).toBe("run")
        expect(pick(["text"], s, { cloud: "deny", autoDownload: true }).action).toBe("run")
    })
})

describe("chooseCandidate: metrics", () => {
    const open = { cloud: "allow", cloudMedia: "allow" }
    it("cost objective keeps free on-device models ahead of billed cloud", () => {
        expect(pick(["text"], sig(), { ...open, objective: "cost" }).candidate?.target).toBe("onDevice")
    })
    it("speed objective can prefer the faster cloud model", () => {
        expect(pick(["text"], sig({ loadedId: "gemma-e2b" }), { ...open, objective: "speed", weights: { cost: 0, latency: 0, tps: 1 } }).candidate?.id).toBe("gemini")
    })
    it("a latency limit rules out slow candidates", () => {
        const d = pick(["text"], sig({ nativeAvailable: false }), { ...open, constraints: { maxLatencyMs: 5000 } })
        expect(d.candidate?.target).toBe("cloud")
        expect(d.skipped.find((s) => s.id === "gemma-web")?.why).toMatch(/latency/)
    })
    it("a tps floor and a cost cap apply", () => {
        const d = pick(["text"], sig({ nativeAvailable: false, webgpu: false }), { ...open, constraints: { minTps: 100 } })
        expect(d.candidate?.id).toBe("gemini")
        const e = pick(["text"], sig({ nativeAvailable: false, webgpu: false }), { ...open, constraints: { maxCostUsd: 0.0005 } })
        expect(e.candidate?.id).toBe("gpt-mini")
    })
    it("a model that is not loaded pays its load time", () => {
        const cold = pick(["text"], sig({ loadedId: null }), { cloud: "deny" })
        const warm = pick(["text"], sig({ loadedId: "gemma-e4b" }), { cloud: "deny" })
        const e4b = (d: any) => d.scores.find((s: any) => s.id === "gemma-e4b").estimate.latencyMs
        expect(e4b(cold) - e4b(warm)).toBe(6000)
    })
    it("observed metrics replace the config numbers as samples accumulate", () => {
        const slow = recordObserved(recordObserved(recordObserved(undefined, { ttftMs: 9000, tps: 2 }), { ttftMs: 9000, tps: 2 }), { ttftMs: 9000, tps: 2 })
        const before = pick(["text"], sig({ loadedId: "apple-fm" }), { cloud: "deny" })
        const after = pick(["text"], sig({ loadedId: "apple-fm" }), { cloud: "deny" }, {}, { "apple-fm": slow })
        expect(before.candidate?.id).toBe("apple-fm")
        expect(after.scores.find((s) => s.id === "apple-fm")?.estimate).toMatchObject({ source: "observed" })
        expect(after.candidate?.id).not.toBe("apple-fm")
    })
    it("ties go to the device", () => {
        const c = { cloud: [{ id: "c", provider: "p", ttftMs: 1000, tps: 20 }], onDevice: { web: [{ id: "w", ttftMs: 1000, tps: 20, loadMs: 0 }] } }
        const d = pick(["text"], sig({ platform: "web", loadedId: "w" }), { cloud: "allow" }, {}, {}, c)
        expect(d.candidate?.id).toBe("w")
    })
})

describe("default order", () => {
    const open = { cloud: "allow", cloudMedia: "allow" }
    it("objective \"order\" takes the first available candidate in the configured order", () => {
        const d = pick(["text"], sig(), { ...open, objective: "order", order: ["gemini", "onDevice"] })
        expect(d.candidate?.id).toBe("gemini")
        expect(d.reason).toMatch(/configured order/)
    })
    it("skips unavailable entries and falls to the next in order", () => {
        const d = pick(["image"], sig({ nativeAvailable: false }), { ...open, objective: "order", order: ["apple-fm", "gemini", "gemma-web"] })
        expect(d.candidate?.id).toBe("gemini")
    })
    it("unlisted candidates follow in config order; groups expand in config order", () => {
        const d = pick(["text"], sig(), { ...open, objective: "order", order: ["cloud"] })
        expect(d.candidate?.id).toBe("gemini")
        expect(pick(["text"], sig(), { ...open, objective: "order", order: ["gpt-mini"] }).candidate?.id).toBe("gpt-mini")
    })
    it("default order is on-device before cloud and breaks score ties", () => {
        expect(pick(["text"], sig(), { ...open, objective: "order" }).candidate?.target).toBe("onDevice")
        const c = { cloud: [{ id: "c", provider: "p", ttftMs: 1000, tps: 20 }], onDevice: { web: [{ id: "w", ttftMs: 1000, tps: 20, loadMs: 0 }] } }
        const flipped = pick(["text"], sig({ platform: "web", loadedId: "w" }), { cloud: "allow", order: ["cloud", "onDevice"] }, {}, {}, c)
        expect(flipped.candidate?.id).toBe("c")
    })
})

describe("recordObserved", () => {
    it("averages, ignores empty metrics, counts samples", () => {
        const a = recordObserved(undefined, { ttftMs: 1000, tps: 10 })!
        const b = recordObserved(a, { ttftMs: 2000, tps: null })!
        expect(b.n).toBe(2)
        expect(b.ttftMs).toBeCloseTo(1300)
        expect(b.tps).toBe(10)
        expect(recordObserved(a, null)).toBe(a)
        expect(recordObserved(undefined, { ttftMs: null, tps: null })).toBeUndefined()
    })
})

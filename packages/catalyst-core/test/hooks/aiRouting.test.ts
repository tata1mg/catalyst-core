import { describe, expect, it } from "vitest"
import { chooseCandidate, normalizeRouting, recordObserved, withPlatformSpeech, withoutLiveEngines, routingFor, PLATFORM_SPEECH, type Signals } from "../../src/native/bridge/hooks/aiRouter"

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
    it("takes that target's on-device models plus cloud, nothing from the other targets", () => {
        expect(setup("ios").candidates.map((c) => c.id)).toEqual(["gemma-e2b", "gemma-e4b", "apple-fm", "gemini", "gpt-mini"])
        expect(setup("android").candidates.map((c) => c.id)).toEqual(["gemma-android", "gemini", "gpt-mini"])
        expect(setup("web").candidates.map((c) => c.id)).toEqual(["gemma-web", "gemini", "gpt-mini"])
    })
    it("a native app never gets the in-browser models: the native module owns the on-device model there", () => {
        for (const platform of ["ios", "android"] as const) {
            const ids = setup(platform).candidates.map((c) => c.id)
            expect(ids).not.toContain("gemma-web")
            expect(setup(platform).candidates.some((c) => c.mode === "local")).toBe(false)
        }
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
    it("with the native module missing, an app does not fall back to a web model", () => {
        // an iOS build without the AI plugin: no on-device model can run, and the browser one is not an option here
        const d = pick(["text"], sig({ nativeAvailable: false }))
        expect(d.candidate?.mode).not.toBe("local")
        expect(d).toMatchObject({ action: "ask", candidate: { target: "cloud" } }) // cloud, and only with consent
        expect(d.skipped.map((s) => s.id)).not.toContain("gemma-web")
        expect(d.skipped.find((s) => s.id === "gemma-e2b")?.why).toBe("native bridge unavailable")
        const denied = pick(["text"], sig({ nativeAvailable: false }), { cloud: "deny" })
        expect(denied).toMatchObject({ action: "deny", candidate: null })
    })
    it("a plain browser (even on a phone) uses the web models", () => {
        const d = pick(["text"], sig({ platform: "web", nativeAvailable: false }))
        expect(d.candidate?.id).toBe("gemma-web")
        expect(d.skipped.map((s) => s.id)).not.toContain("gemma-e2b")
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
        const s = sig({ platform: "web", nativeAvailable: false, webModelLoaded: false })
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
        const d = pick(["text"], sig({ platform: "web", nativeAvailable: false }), { ...open, constraints: { maxLatencyMs: 5000 } })
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
        const c = { cloud: [{ id: "c", provider: "p", ttftMs: 1000, tps: 20, price: { input: 0, output: 0 } }], onDevice: { web: [{ id: "w", ttftMs: 1000, tps: 20, loadMs: 0 }] } }
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
        const c = { cloud: [{ id: "c", provider: "p", ttftMs: 1000, tps: 20, price: { input: 0, output: 0 } }], onDevice: { web: [{ id: "w", ttftMs: 1000, tps: 20, loadMs: 0 }] } }
        const flipped = pick(["text"], sig({ platform: "web", loadedId: "w" }), { cloud: "allow", order: ["cloud", "onDevice"] }, {}, {}, c)
        expect(flipped.candidate?.id).toBe("c")
    })
})

describe("default order by metric", () => {
    const open = { cloud: "allow", cloudMedia: "allow", objective: "order" }
    const cloudOnly = sig({ nativeAvailable: false, webgpu: false })
    it("\"cost\" puts the cheapest candidate first", () => {
        expect(pick(["text"], cloudOnly, { ...open, order: ["cost"] }).candidate?.id).toBe("gpt-mini")
    })
    it("\"tps\" and \"latency\" sort by speed", () => {
        expect(pick(["text"], cloudOnly, { ...open, order: ["tps"] }).candidate?.id).toBe("gemini")
        expect(pick(["text"], cloudOnly, { ...open, order: ["latency"] }).candidate?.id).toBe("gemini") // ~2.8s vs ~3.4s
    })
    it("applies left to right: group first, then the metric within it", () => {
        const d = pick(["text"], sig({ loadedId: "gemma-e2b" }), { ...open, order: ["onDevice", "tps"] })
        expect(d.candidate?.id).toBe("apple-fm") // fastest of the on-device models
        expect(pick(["text"], sig({ loadedId: "gemma-e2b" }), { ...open, order: ["cloud", "cost"] }).candidate?.id).toBe("gpt-mini")
    })
    it("a later key only matters where earlier ones tie", () => {
        // on-device models all cost 0, so "cost" ties and "latency" decides among them
        const d = pick(["text"], sig({ loadedId: "apple-fm" }), { ...open, order: ["cost", "latency"] })
        expect(d.candidate?.id).toBe("apple-fm")
    })
    it("breaks near-ties for a scored objective", () => {
        const c = { cloud: [{ id: "a", provider: "p", ttftMs: 1000, tps: 20, price: { input: 5, output: 5 } }, { id: "b", provider: "p", ttftMs: 1000, tps: 20, price: { input: 1, output: 1 } }] }
        expect(pick(["text"], cloudOnly, { cloud: "allow", order: ["cost"] }, {}, {}, c).candidate?.id).toBe("b")
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

describe("tasks", () => {
    const tasked = {
        onDevice: {
            ios: [
                { id: "gemma", engine: "litert", modalities: ["text", "image", "audio"], tasks: ["text.generate", "vision.read", "speech.transcribe"] },
                { id: "kokoro", modalities: ["text"], tasks: ["speech.synthesize"] },
            ],
        },
        cloud: [
            { id: "gemini", provider: "gemini", modalities: ["text"], tasks: ["text.generate", "image.generate", "embed"] },
            { id: "legacy", provider: "openai", modalities: ["text", "image"] },
        ],
    }
    const first = { cloud: "allow", objective: "order" }
    const run = (mods: any[] = ["text"]) => pick(mods, sig(), first, {}, {}, tasked)

    it("a candidate that lists no tasks serves what its modalities imply", () => {
        const byId = Object.fromEntries(setup("ios", null, tasked).candidates.map((c) => [c.id, c.tasks]))
        expect(byId.legacy).toEqual(["text.generate", "vision.read"])
        expect(setup("ios", null, config).candidates.find((c) => c.id === "gemma-e2b")?.tasks).toEqual(["text.generate", "vision.read", "speech.transcribe"])
    })
    it("routes by the requested task, not just by modalities", () => {
        const r = setup("ios", first, tasked)
        const ask = (task: any) => chooseCandidate(["text"], r.candidates, sig(), r.policy, {}, {}, task)
        expect(ask("speech.synthesize").candidate?.id).toBe("kokoro")
        expect(ask("image.generate").candidate?.id).toBe("gemini")
        expect(ask("embed").candidate?.id).toBe("gemini")
        expect(ask("text.generate").candidate?.id).toBe("gemma")
        expect(ask("speech.synthesize").skipped.find((s) => s.id === "gemma")?.why).toBe("does not do speech.synthesize")
    })
    it("with no task, a call is text generation, as before", () => {
        expect(run().candidate?.id).toBe("gemma")
    })
    it("nothing declares the task: denied rather than sent to a model that cannot do it", () => {
        const r = setup("ios", first, tasked)
        expect(chooseCandidate(["text"], r.candidates, sig(), r.policy, {}, {}, "vision.read" as any).candidate?.id).toBe("gemma")
        const none = normalizeRouting({ cloud: [{ id: "c", provider: "p", modalities: ["text"], tasks: ["text.generate"] }] }, "ios", { cloud: "allow" }, () => {})
        expect(chooseCandidate(["text"], none.candidates, sig(), none.policy, {}, {}, "embed")).toMatchObject({ action: "deny", candidate: null })
    })
    it("drops unknown task names with a warning and keeps the valid ones", () => {
        const warnings: string[] = []
        const r = normalizeRouting({ cloud: [{ id: "a", provider: "p", tasks: ["embed", "telepathy"] }, { id: "b", provider: "p", tasks: ["telepathy"] }] }, "ios", null, (m) => warnings.push(m))
        expect(r.candidates.find((c) => c.id === "a")?.tasks).toEqual(["embed"])
        expect(r.candidates.find((c) => c.id === "b")?.tasks).toEqual(["text.generate"])
        expect(warnings).toHaveLength(2)
    })
})

describe("web desktop and mobile", () => {
    const split = {
        onDevice: {
            "web-desktop": [{ id: "prompt-api", modalities: ["text"] }, { id: "gemma-web", modalities: ["text", "image"] }],
            "web-mobile": [{ id: "small-web", modalities: ["text"] }],
            web: [{ id: "shared-web", modalities: ["text"] }],
        },
        cloud: [],
    }
    const ids = (platform: any, c: any = split) => normalizeRouting(c, platform, null, () => {}).candidates.map((x) => x.id)

    it("each browser reads its own list", () => {
        expect(ids("web-desktop")).toEqual(["prompt-api", "gemma-web"])
        expect(ids("web-mobile")).toEqual(["small-web"])
    })
    it("falls back to the shared web list, and plain \"web\" means that list", () => {
        const onlyShared = { onDevice: { web: [{ id: "shared-web" }] } }
        expect(ids("web-desktop", onlyShared)).toEqual(["shared-web"])
        expect(ids("web-mobile", onlyShared)).toEqual(["shared-web"])
        expect(ids("web", onlyShared)).toEqual(["shared-web"])
    })
    it("web entries run in the browser (local mode), never the native bridge", () => {
        const [c] = normalizeRouting(split, "web-mobile", null, () => {}).candidates
        expect(c.mode).toBe("local")
        const native = normalizeRouting({ onDevice: { ios: [{ id: "x" }] } }, "ios", null, () => {}).candidates[0]
        expect(native.mode).toBe("native")
    })
    it("a native app never reads either browser list", () => {
        expect(ids("ios")).toEqual([])
        expect(ids("android")).toEqual([])
    })
})

describe("Chrome Prompt API candidate", () => {
    const chrome = {
        onDevice: {
            "web-desktop": [
                { id: "chrome-ai", engine: "prompt-api", modalities: ["text"], ttftMs: 300, tps: 30 },
                { id: "gemma-web", model: "onnx/gemma", modalities: ["text"] },
            ],
            "web-mobile": [{ id: "chrome-ai", engine: "prompt-api", modalities: ["text"] }, { id: "gemma-web", model: "onnx/gemma", modalities: ["text"] }],
        },
        cloud: [],
    }
    const desktop = (s: Partial<Signals> = {}, consent = {}) =>
        pick(["text"], sig({ platform: "web-desktop", nativeAvailable: false, webgpu: false, ...s }), { objective: "order" }, consent, {}, chrome)

    it("runs when Chrome reports the model available, with no WebGPU needed", () => {
        const d = desktop({ promptApi: "available" })
        expect(d).toMatchObject({ action: "run", candidate: { id: "chrome-ai", engine: "prompt-api", mode: "local" } })
    })
    it("is skipped when the API is missing or was not checked", () => {
        for (const promptApi of [undefined, "unavailable"] as const) {
            const d = desktop({ promptApi })
            expect(d.skipped.find((s) => s.id === "chrome-ai")?.why).toBe("Chrome Prompt API unavailable")
            expect(d.candidate?.id).not.toBe("chrome-ai")
        }
    })
    it("asks for download consent while Chrome still has to fetch the model, then runs", () => {
        for (const promptApi of ["downloadable", "downloading"] as const) {
            const asked = desktop({ promptApi, webgpu: false })
            expect(asked).toMatchObject({ action: "ask", candidate: { id: "chrome-ai" }, reason: "Chrome's built-in model must be downloaded first" })
            expect(desktop({ promptApi }, { download: true })).toMatchObject({ action: "run", candidate: { id: "chrome-ai" } })
        }
    })
    it("stays desktop-only: dropped from the mobile list with a warning", () => {
        const warnings: string[] = []
        const ids = normalizeRouting(chrome, "web-mobile", null, (m) => warnings.push(m)).candidates.map((c) => c.id)
        expect(ids).toEqual(["gemma-web"])
        expect(warnings.join()).toMatch(/desktop-only/)
        expect(normalizeRouting(chrome, "web-desktop", null, () => {}).candidates.map((c) => c.id)).toEqual(["chrome-ai", "gemma-web"])
    })
    it("the Transformers.js candidate beside it still needs WebGPU", () => {
        const d = desktop({ promptApi: "unavailable", webgpu: false })
        expect(d.skipped.find((s) => s.id === "gemma-web")?.why).toBe("WebGPU unavailable")
    })
})

describe("a download the user agreed to does not count against the latency limit", () => {
    const web = (tps: number) => ({
        onDevice: { web: [{ id: "gemma-web", model: "m", modalities: ["text", "image"], ttftMs: 2000, tps, loadMs: 260000 }] },
        cloud: [],
    })
    const run = (c: any, consent = {}) =>
        pick(["text", "image"], sig({ platform: "web", nativeAvailable: false, webModelLoaded: false }), { objective: "order", constraints: { maxLatencyMs: 15000 } }, consent, {}, c)

    it("asks first, and the same call runs after consent although the load alone is far over the limit", () => {
        const asked = run(web(40)) // ~8.4 s to answer once loaded
        expect(asked).toMatchObject({ action: "ask", candidate: { id: "gemma-web" } })
        const approved = run(web(40), { download: true })
        expect(approved).toMatchObject({ action: "run", candidate: { id: "gemma-web" } })
        expect(approved.estimate!.latencyMs).toBeGreaterThan(260000) // the estimate still tells the truth about the first call
    })
    it("does not ask for a download the limits would reject anyway, and says why at once", () => {
        const d = run(web(9)) // ~30 s to answer even once loaded
        expect(d.action).toBe("deny")
        expect(d.skipped.find((s) => s.id === "gemma-web")?.why).toMatch(/^latency ~30444ms over limit/)
        expect(d.skipped.map((s) => s.why)).not.toContain("model not downloaded")
        expect(run(web(9), { download: true }).action).toBe("deny")
    })
    it("autoDownload counts as agreement", () => {
        const d = pick(["text", "image"], sig({ platform: "web", nativeAvailable: false, webModelLoaded: false }), { objective: "order", autoDownload: true, constraints: { maxLatencyMs: 15000 } }, {}, {}, web(40))
        expect(d).toMatchObject({ action: "run", candidate: { id: "gemma-web" } })
    })
    it("a native model's load still counts (it is not a download the user agreed to)", () => {
        const native = { onDevice: { ios: [{ id: "gemma", engine: "litert", modalities: ["text"], ttftMs: 900, tps: 40, loadMs: 20000 }] }, cloud: [] }
        const d = pick(["text"], sig({ platform: "ios", loadedId: null }), { objective: "order", constraints: { maxLatencyMs: 15000 } }, {}, {}, native)
        expect(d.skipped.find((s) => s.id === "gemma")?.why).toMatch(/over limit/)
    })
})

describe("Chrome Prompt API: no consent request for a model the limits would reject", () => {
    const cfg = (tps: number) => ({ onDevice: { "web-desktop": [{ id: "chrome-ai", engine: "prompt-api", modalities: ["text"], ttftMs: 300, tps }] }, cloud: [] })
    const run = (tps: number, consent = {}) =>
        pick(["text"], sig({ platform: "web-desktop", nativeAvailable: false, webgpu: false, promptApi: "downloadable" }), { objective: "order", constraints: { maxLatencyMs: 15000 } }, consent, {}, cfg(tps))
    it("asks when it would fit, and runs after consent even though the default load estimate is over the limit", () => {
        expect(run(40).action).toBe("ask") // ~6.7 s once downloaded
        expect(run(40, { download: true }).action).toBe("run")
    })
    it("says why at once when it would not fit (256 tokens at 5 tok/s is ~51 s)", () => {
        const d = run(5)
        expect(d.action).toBe("deny")
        expect(d.skipped.find((s) => s.id === "chrome-ai")?.why).toMatch(/^latency ~\d+ms over limit/)
    })
})

describe("platform speech recogniser (live, on-device only)", () => {
    const withSpeech = { ...config, onDevice: { ...config.onDevice, ios: [{ id: "ios-speech", engine: "platform-speech", modalities: ["text"], tasks: ["text.generate"] }, ...config.onDevice.ios] } }
    const transcribe = (s: Signals, o: any = null, c: any = config) => {
        const r = setup(s.platform, o, c)
        const candidates = withPlatformSpeech(r.candidates, s.platform, c)
        return chooseCandidate(["audio"], candidates, s, r.policy, {}, {}, "speech.transcribe")
    }

    it("a config may list it: whatever the entry says, it is audio in, speech.transcribe only, and loads no model", () => {
        const speech = setup("ios", null, withSpeech).candidates.find((c) => c.id === "ios-speech")!
        expect(speech).toMatchObject({ engine: PLATFORM_SPEECH, mode: "native", target: "onDevice", modalities: ["audio"], tasks: ["speech.transcribe"] })
        expect(speech.priors.loadMs).toBe(0)
    })

    it("it only exists in the apps: dropped from a browser list with a warning", () => {
        const warnings: string[] = []
        const r = normalizeRouting({ onDevice: { web: [{ id: "x", engine: "platform-speech" }, { id: "ok", model: "m", modalities: ["text"] }] } }, "web-desktop", null, (m) => warnings.push(m))
        expect(r.candidates.map((c) => c.id)).toEqual(["ok"])
        expect(warnings.join()).toMatch(/only exists in the iOS and Android apps/)
    })

    it("withPlatformSpeech adds it first on iOS and Android, never in a browser", () => {
        for (const platform of ["ios", "android"] as const) {
            const ids = withPlatformSpeech(setup(platform).candidates, platform, config).map((c) => c.id)
            expect(ids[0]).toBe("platform-speech")
            expect(ids.slice(1)).toEqual(setup(platform).candidates.map((c) => c.id))
        }
        for (const platform of ["web", "web-desktop", "web-mobile"] as const) {
            expect(withPlatformSpeech(setup(platform).candidates, platform, config).some((c) => c.engine === PLATFORM_SPEECH)).toBe(false)
        }
    })

    it("routing.platformSpeech: false turns it off, and a listed entry is used instead of a second one", () => {
        const off = withPlatformSpeech(setup("ios").candidates, "ios", { ...config, platformSpeech: false })
        expect(off.some((c) => c.engine === PLATFORM_SPEECH)).toBe(false)
        const listed = withPlatformSpeech(setup("ios", null, withSpeech).candidates, "ios", withSpeech)
        expect(listed.filter((c) => c.engine === PLATFORM_SPEECH).map((c) => c.id)).toEqual(["ios-speech"])
    })

    it("withoutLiveEngines removes only that engine, so generate() never routes a clip to it", () => {
        const all = withPlatformSpeech(setup("ios").candidates, "ios", config)
        const kept = withoutLiveEngines(all)
        expect(kept.map((c) => c.id)).toEqual(setup("ios").candidates.map((c) => c.id))
    })

    it("transcribing: chosen first when the shell can recognise speech, with no model-load penalty in its estimate", () => {
        const d = transcribe(sig({ platformSpeech: true }))
        expect(d.action).toBe("run")
        expect(d.candidate?.id).toBe("platform-speech")
        expect(d.estimate!.latencyMs).toBeLessThan(5000) // the 8 s default load for an unloaded on-device model is not charged
    })

    it("transcribing: skipped when the shell cannot (or has not said), and the next engine serves it", () => {
        for (const platformSpeech of [false, undefined]) {
            const d = transcribe(sig({ platformSpeech }))
            expect(d.skipped.find((x) => x.id === "platform-speech")?.why).toBe("platform speech recognition unavailable")
            expect(d.candidate?.id).toBe("gemma-e2b")
        }
    })

    it("it needs the shell's speech support, not the native AI plugin: skipped or chosen independently of nativeAvailable", () => {
        expect(transcribe(sig({ platformSpeech: true, nativeAvailable: false })).candidate?.id).toBe("platform-speech")
        expect(transcribe(sig({ platformSpeech: false, nativeAvailable: true })).candidate?.id).not.toBe("platform-speech")
    })

    it("it is not a choice for other tasks, even when it is the only candidate that is available", () => {
        const candidates = withPlatformSpeech(setup("ios").candidates, "ios", config)
        const r = setup("ios")
        for (const task of ["text.generate", "vision.read"] as const) {
            const d = chooseCandidate(task === "vision.read" ? ["image"] : ["text"], candidates, sig({ platformSpeech: true }), r.policy, {}, {}, task)
            expect(d.candidate?.id).not.toBe("platform-speech")
            expect(d.skipped.find((x) => x.id === "platform-speech")?.why).toBe(`does not do ${task}`)
        }
    })

    it("voice never leaves the phone through it: with the cloud denied, it still runs; nothing is asked", () => {
        const d = transcribe(sig({ platformSpeech: true }), { cloud: "deny", cloudMedia: "deny" })
        expect(d.action).toBe("run")
        expect(d.candidate?.id).toBe("platform-speech")
    })

    it("a clip handed to generate() never goes to it, even when the config lists it first and the shell supports it", () => {
        const listedFirst = { ...config, onDevice: { ...config.onDevice, ios: [{ id: "ios-speech", engine: "platform-speech" }, ...config.onDevice.ios] } }
        const clip = routingFor(listedFirst, "ios", null, false)
        expect(clip.candidates.some((c) => c.engine === PLATFORM_SPEECH)).toBe(false)
        const d = chooseCandidate(["audio"], clip.candidates, sig({ platformSpeech: true }), clip.policy, {}, {}, "speech.transcribe")
        expect(d.candidate?.id).toBe("gemma-e2b") // Gemma hears the clip; the live recogniser cannot
        const live = routingFor(listedFirst, "ios", null, true)
        expect(chooseCandidate(["audio"], live.candidates, sig({ platformSpeech: true }), live.policy, {}, {}, "speech.transcribe").candidate?.id).toBe("ios-speech")
    })
})

describe("platformSpeech opt-out", () => {
    const base = { onDevice: { ios: [{ id: "ios-speech", engine: "platform-speech", modalities: ["text"] }, { id: "gemma", model: "m", modalities: ["text", "audio"] }] } }
    const ids = (raw: any, override: any = null) => routingFor(raw, "ios", override, true).candidates.map((c) => c.id)

    it("platformSpeech: false removes a platform-speech entry the config lists itself, not just the default one", () => {
        expect(ids(base)).toContain("ios-speech")
        expect(ids({ ...base, platformSpeech: false })).toEqual(["gemma"])
    })

    it("a per-call override of false disables the default entry even when the config does not say so", () => {
        expect(ids({ onDevice: { ios: [{ id: "gemma", model: "m", modalities: ["text", "audio"] }] } })).toContain("platform-speech")
        expect(ids({ onDevice: { ios: [{ id: "gemma", model: "m", modalities: ["text", "audio"] }] } }, { platformSpeech: false })).toEqual(["gemma"])
    })

    it("a per-call override of true wins over a config that turned it off", () => {
        expect(ids({ ...base, platformSpeech: false }, { platformSpeech: true })).toContain("ios-speech")
    })
})

describe("a cloud model with no price has an unknown cost, not a free one", () => {
    const cloud = { cloud: [{ id: "unpriced", provider: "p", model: "m", ttftMs: 600, tps: 60 }, { id: "priced", provider: "p", model: "m2", ttftMs: 600, tps: 60, price: { input: 1, output: 4 } }] }
    const cloudOnly = sig({ nativeAvailable: false, webgpu: false })
    const open = { cloud: "allow", cloudMedia: "allow" }

    it("cannot pass a maxCostUsd limit it cannot be checked against", () => {
        const d = pick(["text"], cloudOnly, { ...open, constraints: { maxCostUsd: 100 } }, {}, {}, cloud)
        expect(d.candidate?.id).toBe("priced")
        expect(d.skipped.find((s: any) => s.id === "unpriced")?.why).toMatch(/cost unknown/)
    })

    it("does not win a cost objective by being counted as free", () => {
        expect(pick(["text"], cloudOnly, { ...open, objective: "cost" }, {}, {}, cloud).candidate?.id).toBe("priced")
        expect(pick(["text"], cloudOnly, { ...open, objective: "order", order: ["cost"] }, {}, {}, cloud).candidate?.id).toBe("priced")
    })

    it("is still used when nothing else can run", () => {
        const only = { cloud: [cloud.cloud[0]] }
        expect(pick(["text"], cloudOnly, open, {}, {}, only).candidate?.id).toBe("unpriced")
    })

    it("does not affect on-device models, which are free", () => {
        const mixed = { ...cloud, onDevice: { ios: [{ id: "local", ttftMs: 900, tps: 20, loadMs: 0 }] } }
        const d = pick(["text"], sig(), { ...open, objective: "order", constraints: { maxCostUsd: 0.01 } }, {}, {}, mixed)
        expect(d.candidate?.id).toBe("local")
    })
})

describe("web models are downloaded one at a time", () => {
    const web = { onDevice: { web: [{ id: "a", model: "model-a", ttftMs: 800, tps: 20, loadMs: 0 }, { id: "b", model: "model-b", ttftMs: 800, tps: 20, loadMs: 0 }] } }
    const onWeb = (o: Partial<Signals>) => sig({ platform: "web", nativeAvailable: false, ...o })

    it("model A being loaded does not make model B free of the download consent", () => {
        const both = pick(["text"], onWeb({ webModelLoaded: true, webLoadedModel: "model-a" }), { objective: "order", order: ["b", "a"] }, {}, {}, web)
        expect(both.candidate?.id).toBe("a") // B is first in the order, but it would download: A, already loaded, is what can run now
        expect(both.skipped.find((s: any) => s.id === "b")?.why).toMatch(/not downloaded/)

        const onlyB = { onDevice: { web: [web.onDevice.web[1]] } }
        const asked = pick(["text"], onWeb({ webModelLoaded: true, webLoadedModel: "model-a" }), { objective: "order" }, {}, {}, onlyB)
        expect(asked.action).toBe("ask") // B alone: it needs the user's yes first
        expect(asked.candidate?.id).toBe("b")
    })

    it("the loaded model itself runs without asking", () => {
        const d = pick(["text"], onWeb({ webModelLoaded: true, webLoadedModel: "model-a" }), { objective: "order", order: ["a"] }, {}, {}, web)
        expect(d.action).toBe("run")
        expect(d.candidate?.id).toBe("a")
    })

    it("without a model name the old behaviour stands: some model being loaded counts for all", () => {
        const d = pick(["text"], onWeb({ webModelLoaded: true }), { objective: "order", order: ["b"] }, {}, {}, web)
        expect(d.action).toBe("run")
    })
})

describe("a per-hook routing override", () => {
    it("merges constraints and weights field by field instead of replacing them", () => {
        const configured = { policy: { constraints: { maxLatencyMs: 5000, minTps: 10 }, weights: { cost: 3, latency: 1, tps: 1 } }, onDevice: { ios: [{ id: "a", engine: "litert", modalities: ["text"] }] } }
        const r = setup("ios", { constraints: { maxCostUsd: 0.01 }, weights: { cost: 9 } }, configured)
        expect(r.policy.constraints).toEqual({ maxLatencyMs: 5000, minTps: 10, maxCostUsd: 0.01 })
        expect(r.policy.weights.cost).toBe(9)
        expect(r.policy.weights.latency).toBe(1)
    })
})

describe("review round: router edge cases", () => {
    it("an objective that is only an inherited property name falls back to balanced", () => {
        expect(setup("ios", { objective: "constructor" }).policy).toMatchObject({ objective: "balanced" })
        expect(setup("ios", { objective: { toString: null } }).policy).toMatchObject({ objective: "balanced" })
    })

    it("a call with nothing measured is not counted as an observation", () => {
        const first = recordObserved(undefined, { ttftMs: 500, tps: 20 })
        expect(first?.n).toBe(1)
        expect(recordObserved(first, { ttftMs: null, tps: null })).toBe(first) // same object: nothing new learned
        expect(recordObserved(first, { ttftMs: 0, tps: -1 })).toBe(first)
        expect(recordObserved(first, { ttftMs: 400, tps: null })?.n).toBe(2)
    })

    it("a cloud model that the cost limit refuses is not offered for consent", () => {
        const only = { ...config, onDevice: { ios: [], android: [], web: [] }, cloud: [config.cloud[0]] }
        const refused = pick(["text"], sig(), { constraints: { maxCostUsd: 0.0000001 } }, {}, {}, only)
        expect(refused.action).not.toBe("ask") // asking would end with a yes for a model the limit then rejects
        const allowed = pick(["text"], sig(), null, {}, {}, only)
        expect(allowed.action).toBe("ask") // without the limit it is still asked for
    })
})


import { describe, expect, it } from "vitest"
import { mergeRouting, resolveRoute, type RouteSignals } from "../../src/native/bridge/hooks/aiProviders"

const all = { text: true, image: true, audio: true }
const signals = (o: Partial<RouteSignals> = {}): RouteSignals => ({
    native: true, webgpu: true, online: true, webModelCached: true, cloudConfigured: true,
    caps: { native: all, local: all, cloud: all }, ...o,
})
const cfg = (o = {}) => mergeRouting(null, o)

describe("resolveRoute", () => {
    it("prefers native when available", () => {
        expect(resolveRoute(["text"], signals(), cfg()).mode).toBe("native")
    })
    it("falls to the web engine when the bridge is missing", () => {
        const d = resolveRoute(["text"], signals({ native: false }), cfg())
        expect(d).toMatchObject({ mode: "local", action: "run" })
        expect(d.skipped[0]).toEqual({ mode: "native", why: "native bridge unavailable" })
    })
    it("skips engines that lack a modality", () => {
        const d = resolveRoute(["image"], signals({ caps: { native: { text: true }, local: all, cloud: all } }), cfg())
        expect(d.mode).toBe("local")
    })
    it("asks before using cloud for text by default", () => {
        const s = signals({ native: false, webgpu: false })
        expect(resolveRoute(["text"], s, cfg())).toMatchObject({ mode: "cloud", action: "ask" })
        expect(resolveRoute(["text"], s, cfg(), { cloud: true })).toMatchObject({ mode: "cloud", action: "run" })
    })
    it("denies cloud for media by default, even with consent flag set to allow for text", () => {
        const s = signals({ native: false, webgpu: false })
        expect(resolveRoute(["image"], s, cfg({ cloud: "allow" }), { cloud: true })).toMatchObject({ mode: null, action: "deny" })
    })
    it("lets media use cloud only when cloudMedia is opened up", () => {
        const s = signals({ native: false, webgpu: false })
        expect(resolveRoute(["audio"], s, cfg({ cloud: "allow", cloudMedia: "allow" }))).toMatchObject({ mode: "cloud", action: "run" })
    })
    it("never goes to cloud offline or when unconfigured", () => {
        const s = signals({ native: false, webgpu: false })
        expect(resolveRoute(["text"], { ...s, online: false }, cfg({ cloud: "allow" })).action).toBe("deny")
        expect(resolveRoute(["text"], { ...s, cloudConfigured: false }, cfg({ cloud: "allow" })).action).toBe("deny")
    })
    it("asks for download consent when the web model is not cached", () => {
        const s = signals({ native: false, webModelCached: false })
        expect(resolveRoute(["text"], s, cfg({ cloud: "deny" }))).toMatchObject({ mode: "local", action: "ask" })
        expect(resolveRoute(["text"], s, cfg({ cloud: "deny" }), { download: true })).toMatchObject({ mode: "local", action: "run" })
        expect(resolveRoute(["text"], s, cfg({ cloud: "deny", autoDownload: true })).action).toBe("run")
    })
    it("honours preference order", () => {
        expect(resolveRoute(["text"], signals(), cfg({ prefer: ["local", "native"] })).mode).toBe("local")
    })
    it("ignores invalid config values", () => {
        expect(mergeRouting(null, { prefer: ["bogus"] as any, cloud: "x" as any })).toMatchObject({ cloud: "ask", prefer: ["native", "local", "cloud"] })
    })
    it("a per-call override wins over the default config", () => {
        expect(mergeRouting({ cloud: "deny" }, { cloud: "allow" }).cloud).toBe("allow")
    })
})

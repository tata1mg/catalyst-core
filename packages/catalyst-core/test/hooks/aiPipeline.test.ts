import { describe, expect, it, vi } from "vitest"
import { codeStage, imageStage, jsonStage, runPipeline, speechStage, transcribeStage, validatePipeline } from "../../src/native/bridge/hooks/aiPipeline"
import type { PipelineStep, Stage } from "../../src/native/bridge/hooks/aiPipeline"

const schema = { type: "object" as const, required: ["scene"], properties: { scene: { type: "string" as const } } }
const audio = new Uint8Array([1, 2, 3])

const full = (over: { generate?: any; requestImage?: any } = {}): Stage[] => [
    transcribeStage(async () => "a cat on a roof"),
    jsonStage({ schema, generate: over.generate ?? (async () => '{"scene":"cat on roof"}') }),
    imageStage({ requestImage: over.requestImage ?? (async () => ({ images: [{ url: "data:image/png;base64,AAA", mimeType: "image/png" }] })), prompt: (j: any) => j.scene }),
]

describe("construction", () => {
    it("names both stages on a type mismatch", () => {
        const a: Stage = { name: "a", input: "audio", output: "text", run: () => "x" }
        const b: Stage = { name: "b", input: "json", output: "image", run: () => "x" }
        expect(() => validatePipeline([a, b])).toThrow('Stage "a" outputs "text" but stage "b" expects "json"')
    })
    it("rejects empty, duplicate, unknown-type and run-less stages", () => {
        expect(() => validatePipeline([])).toThrow(/at least one/)
        const s: Stage = { name: "s", input: "text", output: "text", run: (t) => t }
        expect(() => validatePipeline([s, s])).toThrow(/Duplicate stage name "s"/)
        expect(() => validatePipeline([{ ...s, input: "video" as any }])).toThrow(/unknown input type "video"/)
        expect(() => validatePipeline([{ ...s, run: undefined as any }])).toThrow(/needs a run function/)
    })
    it("runPipeline rejects a mismatched chain", async () => {
        await expect(runPipeline([codeStage("a", "text", "text", (t) => t), codeStage("b", "json", "json", (t) => t)], "x")).rejects.toThrow(/"a" outputs "text" but stage "b" expects "json"/)
    })
})

describe("happy path and events", () => {
    it("runs audio -> text -> json -> image with start/end events per stage", async () => {
        const events: PipelineStep[] = []
        const res = await runPipeline(full(), audio, { cloudPolicy: "allow", onStep: (s) => events.push(s) })
        expect(res.status).toBe("done")
        expect((res.output as any).mimeType).toBe("image/png")
        expect(events.map((e) => `${e.type}:${e.stage}`)).toEqual([
            "start:transcribe", "end:transcribe", "start:json", "end:json", "start:image", "end:image",
        ])
        const jsonEnd = events.find((e) => e.type === "end" && e.stage === "json") as any
        expect(jsonEnd.preview).toBe('{"scene":"cat on roof"}')
        expect(typeof jsonEnd.durationMs).toBe("number")
        const start = events[0] as any
        expect(start.preview).toBe("audio (3 bytes)")
        const imgEnd = events[5] as any
        expect(imgEnd.preview).toContain("image/png")
        expect(imgEnd.preview).not.toContain("AAA")
        expect(res.steps).toEqual(events)
    })
    it("code steps are first-class and a throwing listener does not break the run", async () => {
        const res = await runPipeline([codeStage("upper", "text", "text", (t: string) => t.toUpperCase()), codeStage("wrap", "text", "json", (t: string) => ({ t }))], "hi", {
            onStep: () => {
                throw new Error("boom")
            },
        })
        expect(res.output).toEqual({ t: "HI" })
    })
    it("speechStage produces audio-out", async () => {
        const res = await runPipeline([speechStage(async () => new Uint8Array([9]))], "hello")
        expect(res.status).toBe("done")
    })
})

describe("runtime type checks", () => {
    it("fails at the stage whose output has the wrong type", async () => {
        const res = await runPipeline([codeStage("bad", "text", "json", () => undefined), codeStage("next", "json", "text", () => "x")], "in")
        expect(res.status).toBe("error")
        expect(res.stage).toBe("bad")
        expect(res.error?.message).toMatch(/Stage "bad" returned the wrong type: expected json/)
        expect(res.steps.some((s) => s.stage === "next")).toBe(false)
    })
    it("checks every type", async () => {
        const wrong = async (output: any, value: any) => (await runPipeline([codeStage("s", "text", output, () => value)], "x")).status
        expect(await wrong("text", 5)).toBe("error")
        expect(await wrong("image", { nothing: 1 })).toBe("error")
        expect(await wrong("audio", 5)).toBe("error")
        expect(await wrong("audio-out", "")).toBe("error")
        expect(await wrong("image", "data:image/png;base64,AA")).toBe("done")
        expect(await wrong("audio", { uri: "file:///a.wav" })).toBe("done")
        expect(await wrong("json", [1, 2])).toBe("done")
        const cyclic: any = {}
        cyclic.self = cyclic
        expect(await wrong("json", cyclic)).toBe("error")
    })
    it("checks the pipeline input against the first stage", async () => {
        const res = await runPipeline(full(), "not audio", { cloudPolicy: "allow" })
        // a non-empty string is an acceptable audio URI; an object without a reference is not
        expect(res.status).toBe("done")
        const bad = await runPipeline(full(), { nope: 1 })
        expect(bad.status).toBe("error")
        expect(bad.error?.message).toMatch(/Pipeline input for stage "transcribe"/)
    })
    it("turns a stage exception into an error status with the stage name", async () => {
        const res = await runPipeline([codeStage("x", "text", "text", () => { throw new Error("nope") })], "a")
        expect(res.status).toBe("error")
        expect(res.stage).toBe("x")
        expect(res.error?.message).toBe("nope")
        expect(res.steps.at(-1)).toMatchObject({ type: "error", stage: "x", error: "nope" })
    })
})

describe("jsonStage", () => {
    it("retries once with a corrective prompt then succeeds", async () => {
        const generate = vi.fn().mockResolvedValueOnce("I think it is a cat").mockResolvedValueOnce('```json\n{"scene":"cat"}\n```')
        const res = await runPipeline(full({ generate }), audio, { cloudPolicy: "allow" })
        expect(res.status).toBe("done")
        expect(generate).toHaveBeenCalledTimes(2)
        const second = generate.mock.calls[1][0] as string
        expect(second).toContain("I think it is a cat")
        expect(second).toContain("That reply was not usable")
    })
    it("fails after the one retry, naming the schema problem", async () => {
        const generate = vi.fn().mockResolvedValue('{"scene": 3}')
        const res = await runPipeline(full({ generate }), audio, { cloudPolicy: "allow" })
        expect(generate).toHaveBeenCalledTimes(2)
        expect(res.status).toBe("error")
        expect(res.stage).toBe("json")
        expect(res.error?.message).toMatch(/after one retry.*\$\.scene should be string/)
    })
    it("accepts { output, costUsd } and surfaces generator errors without retrying", async () => {
        const ok = await runPipeline([jsonStage({ schema, generate: async () => ({ output: '{"scene":"x"}', costUsd: 0.01 }) })], "t")
        expect(ok.spentUsd).toBeCloseTo(0.01)
        const generate = vi.fn().mockResolvedValue({ output: "", error: new Error("offline") })
        const bad = await runPipeline([jsonStage({ schema, generate })], "t")
        expect(bad.error?.message).toBe("offline")
        expect(generate).toHaveBeenCalledTimes(1)
    })
    it("puts the text in the prompt as data", async () => {
        const generate = vi.fn().mockResolvedValue('{"scene":"x"}')
        await runPipeline([jsonStage({ schema, generate })], "my transcript")
        expect(generate.mock.calls[0][0]).toContain("my transcript")
        expect(generate.mock.calls[0][0]).toContain('"required":["scene"]')
    })
})

describe("imageStage", () => {
    it("calls requestImage with the prompt, signal and options, and reports cost", async () => {
        const requestImage = vi.fn(async () => ({ images: [{ url: "u" }], usage: { n: 1 } }))
        const res = await runPipeline([imageStage({ requestImage, prompt: (j: any) => `draw ${j.scene}`, requestOptions: { size: "1024x1024" }, cost: () => 0.04 })], { scene: "cat" })
        expect(requestImage).toHaveBeenCalledWith(expect.objectContaining({ prompt: "draw cat", size: "1024x1024", signal: expect.any(AbortSignal) }))
        expect(res.spentUsd).toBeCloseTo(0.04)
    })
    it("forwards input images derived from the stage input, and omits the key when none", async () => {
        const requestImage = vi.fn(async () => ({ images: [{ url: "u" }] }))
        const stage = imageStage({ requestImage, prompt: () => "edit", images: (j: any) => j.src })
        await runPipeline([stage], { src: ["data:image/png;base64,AAA"] })
        expect(requestImage).toHaveBeenLastCalledWith(expect.objectContaining({ images: ["data:image/png;base64,AAA"] }))
        await runPipeline([stage], { src: [] })
        expect((requestImage.mock.calls as any[][])[1][0]).not.toHaveProperty("images")
    })
    it("errors when no image comes back", async () => {
        const res = await runPipeline([imageStage({ requestImage: async () => ({ images: [] }), prompt: () => "p" })], {}, { cloudPolicy: "allow" })
        expect(res.error?.message).toMatch(/no images/)
    })
})

describe("cancellation", () => {
    it("is cancelled before the first stage when already aborted", async () => {
        const c = new AbortController()
        c.abort()
        const run = vi.fn()
        const res = await runPipeline([codeStage("a", "text", "text", run)], "x", { signal: c.signal })
        expect(res.status).toBe("cancelled")
        expect(run).not.toHaveBeenCalled()
    })
    it("aborts mid-stage, passes the signal along, and skips later stages", async () => {
        const c = new AbortController()
        let seen: AbortSignal | undefined
        const later = vi.fn(() => "x")
        const res = await runPipeline(
            [
                codeStage("slow", "text", "text", (_t, ctx) => {
                    seen = ctx.signal
                    return new Promise<string>(() => {}) // a stage that ignores the signal
                }),
                codeStage("later", "text", "text", later),
            ],
            "x",
            { signal: c.signal, onStep: (s) => s.type === "start" && setTimeout(() => c.abort(), 0) } // after the stage has begun: this test is about aborting MID-stage
        )
        expect(res.status).toBe("cancelled")
        expect(res.stage).toBe("slow")
        expect(seen).toBe(c.signal)
        expect(later).not.toHaveBeenCalled()
    })
    it("cancelling between stages stops before the next one", async () => {
        const c = new AbortController()
        const second = vi.fn(() => "y")
        const res = await runPipeline([codeStage("one", "text", "text", () => { c.abort(); return "x" }), codeStage("two", "text", "text", second)], "x", { signal: c.signal })
        expect(res.status).toBe("cancelled")
        expect(second).not.toHaveBeenCalled()
    })
})

describe("spend cap", () => {
    const costly = (name: string, usd: number, fn = vi.fn(() => "t")) => codeStage(name, "text", "text", (t: string, ctx) => { ctx.addCost(usd); return fn() })
    it("stops before the next stage once the cap is reached", async () => {
        const third = vi.fn(() => "t")
        const res = await runPipeline([costly("a", 0.03), costly("b", 0.03), costly("c", 0.03, third)], "x", { maxCostUsd: 0.05 })
        expect(res.status).toBe("max-spend")
        expect(res.stage).toBe("c")
        expect(res.spentUsd).toBeCloseTo(0.06)
        expect(third).not.toHaveBeenCalled()
        expect(res.steps.at(-1)).toMatchObject({ type: "blocked", reason: "max-spend", stage: "c" })
    })
    it("does not stop when under the cap, ignores bad cost values, and has no cap by default", async () => {
        const res = await runPipeline([costly("a", 0.01), codeStage("b", "text", "text", (t, ctx) => { ctx.addCost(NaN); ctx.addCost(-1); return t })], "x", { maxCostUsd: 1 })
        expect(res.status).toBe("done")
        expect(res.spentUsd).toBeCloseTo(0.01)
        expect((await runPipeline([costly("a", 99), costly("b", 1)], "x")).status).toBe("done")
    })
    it("records per-stage cost on the end event", async () => {
        const res = await runPipeline([costly("a", 0.02)], "x")
        expect(res.steps.find((s) => s.type === "end")).toMatchObject({ costUsd: 0.02 })
    })
})

describe("cloud consent", () => {
    it("denies a cloud stage on audio-derived data by default, before calling it", async () => {
        const requestImage = vi.fn()
        const res = await runPipeline(full({ requestImage }), audio)
        expect(res.status).toBe("denied")
        expect(res.stage).toBe("image")
        expect(requestImage).not.toHaveBeenCalled()
        expect(res.steps.at(-1)).toMatchObject({ type: "blocked", reason: "denied" })
    })
    it("stops with needs-consent under policy ask, and passes with allow", async () => {
        const requestImage = vi.fn(async () => ({ images: [{ url: "u" }] }))
        const asked = await runPipeline(full({ requestImage }), audio, { cloudPolicy: "ask" })
        expect(asked.status).toBe("needs-consent")
        expect(requestImage).not.toHaveBeenCalled()
        const allowed = await runPipeline(full({ requestImage }), audio, { cloudPolicy: "allow" })
        expect(allowed.status).toBe("done")
        expect(requestImage).toHaveBeenCalledTimes(1)
    })
    it("blocks a cloud transcriber (it sees the audio itself)", async () => {
        const fn = vi.fn(async () => "t")
        const res = await runPipeline([transcribeStage(fn, { cloud: true })], audio)
        expect(res.status).toBe("denied")
        expect(fn).not.toHaveBeenCalled()
    })
    it("allows cloud stages on data that did not come from audio unless a policy says otherwise", async () => {
        const stage = (): Stage => ({ name: "c", input: "text", output: "text", cloud: true, run: (t: string) => t })
        expect((await runPipeline([stage()], "typed text")).status).toBe("done")
        expect((await runPipeline([stage()], "typed text", { cloudPolicy: "ask" })).status).toBe("needs-consent")
    })
    it("on-device stages are never blocked", async () => {
        const res = await runPipeline([transcribeStage(async () => "t"), codeStage("local", "text", "text", (t) => t)], audio, { cloudPolicy: "deny" })
        expect(res.status).toBe("done")
    })
})

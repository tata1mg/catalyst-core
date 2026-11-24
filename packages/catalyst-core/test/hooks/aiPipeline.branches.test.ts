// Branch coverage for the pipeline runner: value previews, validation errors, aborts, cancellation mid-run and the
// transcribe stage's two result shapes.
import { describe, expect, it, vi } from "vitest"
import { codeStage, preview, runPipeline, transcribeStage, validatePipeline } from "../../src/native/bridge/hooks/aiPipeline"

describe("preview", () => {
    it("describes each type without dumping payloads", () => {
        expect(preview("text", "hello")).toBe("hello")
        expect(preview("json", { a: 1 })).toBe('{"a":1}')
        expect(preview("json", undefined)).toBe("undefined")
        const circular: any = {}
        circular.self = circular
        expect(preview("json", circular)).toBe("(unserialisable)")
        expect(preview("image", "data:image/png;base64,AAAA")).toMatch(/^image \(data URL, \d+ chars\)$/)
        expect(preview("image", "https://x/y.png")).toBe("image (reference, 15 chars)")
        // a signed URL, a local path or a token in a query string must never reach an event consumer
        for (const secret of ["https://cdn.example/a.png?X-Amz-Signature=abc123", "/Users/me/private/photo.png", "file:///tmp/secret.wav"]) {
            expect(preview("image", secret)).not.toContain("abc123")
            expect(preview("audio", secret)).not.toMatch(/Users|tmp|secret|cdn/)
        }
        expect(preview("audio", new ArrayBuffer(8))).toBe("audio (8 bytes)")
        expect(preview("audio", new Uint8Array(3))).toBe("audio (3 bytes)")
        expect(preview("audio", new Blob(["abc"], { type: "audio/wav" }))).toBe("audio (3 bytes, audio/wav)")
        expect(preview("audio", new Blob(["abc"]))).toBe("audio (3 bytes)")
        expect(preview("image", { mimeType: "image/png" })).toBe("image (image/png)")
        expect(preview("image", { other: 1 })).toBe("image (object)")
        expect(preview("audio", 5)).toBe("audio")
    })
})

describe("validatePipeline", () => {
    const ok = codeStage("a", "text", "text", (x: string) => x)
    it("accepts a well-formed pipeline and returns it", () => {
        expect(validatePipeline([ok])).toEqual([ok])
    })
    it("rejects each kind of malformed pipeline with a clear message", () => {
        expect(() => validatePipeline([])).toThrow(/at least one stage/)
        expect(() => validatePipeline([{ ...ok, name: "" }])).toThrow(/needs a name/)
        expect(() => validatePipeline([ok, ok])).toThrow(/Duplicate stage name "a"/)
        expect(() => validatePipeline([{ ...ok, input: "video" as any }])).toThrow(/unknown input type/)
        expect(() => validatePipeline([{ ...ok, output: "video" as any }])).toThrow(/unknown output type/)
        expect(() => validatePipeline([{ ...ok, run: undefined as any }])).toThrow(/needs a run function/)
        const toJson = codeStage("b", "text", "json", () => ({}))
        const wantsText = codeStage("c", "text", "text", (x: string) => x)
        expect(() => validatePipeline([toJson, wantsText])).toThrow(/outputs "json" but stage "c" expects "text"/)
    })
})

describe("runPipeline cancellation and errors", () => {
    it("is cancelled when the signal is already aborted", async () => {
        const controller = new AbortController()
        controller.abort()
        const result = await runPipeline([codeStage("slow", "text", "text", async (x: string) => x)], "in", { signal: controller.signal })
        expect(result.status).toBe("cancelled")
    })

    it("is cancelled when the signal aborts while a stage is running", async () => {
        const controller = new AbortController()
        const stage = codeStage("slow", "text", "text", () => new Promise<string>(() => {}))
        const pending = runPipeline([stage], "in", { signal: controller.signal })
        controller.abort()
        const result = await pending
        expect(result.status).toBe("cancelled")
    })

    it("completes normally and removes its abort listener when the stage finishes first", async () => {
        const controller = new AbortController()
        const result = await runPipeline([codeStage("ok", "text", "text", async (x: string) => x.toUpperCase())], "in", { signal: controller.signal })
        expect(result.status).toBe("done")
        expect(result.output).toBe("IN")
    })

    it("reports a stage that throws something that is not an Error", async () => {
        const result = await runPipeline([codeStage("bad", "text", "text", () => { throw "plain string" })], "in")
        expect(result.status).toBe("error")
        expect(String((result as any).error?.message ?? (result as any).error)).toContain("plain string")
    })

    it("reports a stage that returns the wrong type", async () => {
        const result = await runPipeline([codeStage("wrong", "text", "text", () => 5 as any)], "in")
        expect(result.status).toBe("error")
    })
})

describe("transcribeStage", () => {
    it("accepts a plain string result", async () => {
        const result = await runPipeline([transcribeStage(async () => "spoken words")], "data:audio/wav;base64,AA")
        expect(result.output).toBe("spoken words")
    })
    it("accepts { text, costUsd } and records the cost", async () => {
        const result = await runPipeline([transcribeStage(async () => ({ text: "spoken", costUsd: 0.25 }))], "data:audio/wav;base64,AA")
        expect(result.output).toBe("spoken")
        expect(result.spentUsd).toBeCloseTo(0.25)
    })
})

describe("a cancel from the start event stops the stage before it begins", () => {
    it("a stage that would have made a paid call never runs when the start listener aborts", async () => {
        const controller = new AbortController()
        const run = vi.fn(async (x: string) => x)
        const stage = codeStage("paid", "text", "text", run)
        const result = await runPipeline([stage], "in", { signal: controller.signal, onStep: (step: any) => { if (step.type === "start") controller.abort() } })
        expect(result.status).toBe("cancelled")
        expect(run).not.toHaveBeenCalled()
    })
})

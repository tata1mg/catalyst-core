import { describe, expect, it } from "vitest"
import { buildPrompt, correctionPrompt, extractJson, validate, type Schema } from "../../src/native/bridge/hooks/vision/schema"
import { toImageDataUrl } from "../../src/native/bridge/hooks/vision/source"

const report: Schema = {
    type: "object",
    required: ["title", "results"],
    properties: {
        title: { type: "string" },
        collectedOn: { type: "string", nullable: true },
        results: {
            type: "array",
            items: {
                type: "object",
                required: ["name", "value", "unit"],
                properties: {
                    name: { type: "string" },
                    value: { type: "number" },
                    unit: { type: "string" },
                    flag: { type: "string", enum: ["low", "normal", "high"] },
                },
            },
        },
    },
}

describe("validate", () => {
    it("accepts a conforming value", () => {
        const value = { title: "Lipid panel", collectedOn: null, results: [{ name: "HDL", value: 41, unit: "mg/dL", flag: "low" }] }
        expect(validate(report, value)).toEqual([])
    })
    it("names every problem with its path", () => {
        const bad = { results: [{ name: "HDL", value: "41", unit: "mg/dL", flag: "weird" }, "oops"] }
        const problems = validate(report, bad)
        expect(problems).toContain("$.title is missing")
        expect(problems).toContain("$.results[0].value should be number, got string")
        expect(problems.some((p) => p.startsWith("$.results[0].flag should be one of"))).toBe(true)
        expect(problems).toContain("$.results[1] should be object, got string")
    })
    it("checks integer vs number, nullable and multiple types", () => {
        expect(validate({ type: "integer" }, 3)).toEqual([])
        expect(validate({ type: "integer" }, 3.5)).toHaveLength(1)
        expect(validate({ type: "number" }, NaN)).toHaveLength(1)
        expect(validate({ type: "string", nullable: true }, null)).toEqual([])
        expect(validate({ type: "string" }, null)).toHaveLength(1)
        expect(validate({ type: ["string", "number"] }, 5)).toEqual([])
    })
    it("does not treat arrays as objects or null as an object", () => {
        expect(validate({ type: "object" }, [])).toHaveLength(1)
        expect(validate({ type: "object" }, null)).toHaveLength(1)
    })
})

describe("extractJson", () => {
    it("parses bare JSON", () => {
        expect(extractJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    })
    it("unwraps a code fence", () => {
        expect(extractJson('Here you go:\n```json\n{"a": [1, 2]}\n```\nHope it helps')).toEqual({ ok: true, value: { a: [1, 2] } })
    })
    it("finds the first balanced value inside prose, ignoring braces in strings", () => {
        const text = 'Sure! The result is {"note": "use } carefully", "n": 2} and that is all.'
        expect(extractJson(text)).toEqual({ ok: true, value: { note: "use } carefully", n: 2 } })
    })
    it("handles escaped quotes", () => {
        expect(extractJson('x {"q": "say \\"hi\\""} y')).toEqual({ ok: true, value: { q: 'say "hi"' } })
    })
    it("fails clearly on empty and on non-JSON", () => {
        expect(extractJson("   ")).toEqual({ ok: false, error: "the reply was empty" })
        expect(extractJson("I cannot read this image.")).toMatchObject({ ok: false })
        expect(extractJson('{"a": 1')).toMatchObject({ ok: false })
    })
})

describe("prompts", () => {
    it("embeds the schema and forbids prose", () => {
        const p = buildPrompt({ type: "object" }, "Read the lab report.")
        expect(p).toContain("Read the lab report.")
        expect(p).toContain('{"type":"object"}')
        expect(p).toContain("ONLY a JSON value")
        expect(p).toContain("never invent")
    })
    it("falls back to a default instruction", () => {
        expect(buildPrompt({ type: "string" })).toContain("extract the requested information")
    })
    it("lists at most six problems in the correction", () => {
        const c = correctionPrompt(Array.from({ length: 10 }, (_, i) => `p${i}`))
        expect(c).toContain("p5")
        expect(c).not.toContain("p6")
    })
})

describe("toImageDataUrl", () => {
    const png = "data:image/png;base64,iVBORw0KGgo="
    it("passes an image data URL through", async () => {
        expect(await toImageDataUrl(png)).toBe(png)
        expect(await toImageDataUrl({ fileSrc: png, mimeType: "image/png" })).toBe(png)
    })
    it("rejects non-image data URLs", async () => {
        await expect(toImageDataUrl("data:text/plain;base64,aGk=")).rejects.toThrow(/not a base64 image/)
        await expect(toImageDataUrl("data:image/png,not-base64")).rejects.toThrow(/not a base64 image/)
    })
    it("converts a Blob", async () => {
        const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" })
        expect(await toImageDataUrl(blob)).toBe("data:image/jpeg;base64,AQIDBA==")
    })
    it("rejects a non-image Blob and an empty source", async () => {
        await expect(toImageDataUrl(new Blob(["hi"], { type: "text/plain" }))).rejects.toThrow(/Expected an image/)
        await expect(toImageDataUrl("")).rejects.toThrow(/No image/)
    })
    it("fetches other URLs and uses the photo's mime type when the response has none", async () => {
        const original = globalThis.fetch
        globalThis.fetch = (async () => new Response(new Uint8Array([9, 8, 7]), { status: 200 })) as typeof fetch
        try {
            expect(await toImageDataUrl({ fileSrc: "https://localhost:1/framework-x/file-1", mimeType: "image/jpeg" })).toBe("data:image/jpeg;base64,CQgH")
            globalThis.fetch = (async () => new Response("no", { status: 404 })) as typeof fetch
            await expect(toImageDataUrl("blob:abc")).rejects.toThrow(/HTTP 404/)
            globalThis.fetch = (async () => { throw new Error("offline") }) as typeof fetch
            await expect(toImageDataUrl("blob:abc")).rejects.toThrow(/offline/)
        } finally {
            globalThis.fetch = original
        }
    })
    it("handles a multi-megabyte photo without overflowing the call stack", async () => {
        const big = new Blob([new Uint8Array(3_000_000)], { type: "image/jpeg" })
        const url = await toImageDataUrl(big)
        expect(url.startsWith("data:image/jpeg;base64,")).toBe(true)
        expect(url.length).toBeGreaterThan(4_000_000)
    })
})

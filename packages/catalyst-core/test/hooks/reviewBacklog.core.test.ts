// @vitest-environment jsdom
// Review backlog, core hooks: the touch check, scalar replies, text prompts, image stage cost and edits, and image sources that can be
// stopped and are refused when too large.
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { isMobileWeb } from "../../src/native/bridge/hooks/aiProviders"
import { buildPrompt, extractJson, validate } from "../../src/native/bridge/hooks/vision/schema"
import { MAX_SOURCE_BYTES, toImageDataUrl } from "../../src/native/bridge/hooks/vision/source"
import { imageStage, jsonStage, runPipeline } from "../../src/native/bridge/hooks/aiPipeline"

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("isMobileWeb", () => {
    it("a Mac that reports even one touch point is an iPad, a Mac with none is a Mac", () => {
        expect(isMobileWeb({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 1 })).toBe(true)
        expect(isMobileWeb({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 5 })).toBe(true)
        expect(isMobileWeb({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 0 })).toBe(false)
        expect(isMobileWeb({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows)", maxTouchPoints: 1 })).toBe(false)
    })
})

describe("extractJson with a scalar answer", () => {
    it("finds a number, a boolean or a quoted string inside prose when the reply has no object or array", () => {
        expect(extractJson("The answer is 42")).toEqual({ ok: true, value: 42 })
        expect(extractJson("Total: -3.5e2 units")).toEqual({ ok: true, value: -350 })
        expect(extractJson("Yes, it is true.")).toEqual({ ok: true, value: true })
        expect(extractJson('I would say "approved" here')).toEqual({ ok: true, value: "approved" })
        const found: any = extractJson("It is 7")
        expect(validate({ type: "number" }, found.value)).toEqual([])
    })

    it("does not turn a truncated or malformed object into its first string or number", () => {
        expect(extractJson('{"title": "x", "total": 4').ok).toBe(false)
        expect(extractJson('[1, 2').ok).toBe(false)
        expect(extractJson("{ nothing useful").ok).toBe(false)
    })

    it("still prefers an object or array when the reply has one", () => {
        expect(extractJson("I counted 3 items: {\"n\": 3}")).toEqual({ ok: true, value: { n: 3 } })
    })
})

describe("prompts for text", () => {
    it("a text source never talks about an image", () => {
        const text = buildPrompt({ type: "object" }, undefined, "text")
        expect(text).toMatch(/Read the text/)
        expect(text).toMatch(/present in the text/)
        expect(text).not.toMatch(/image/i)
        expect(buildPrompt({ type: "object" })).toMatch(/visible in the image/) // the default is unchanged
    })

    it("jsonStage asks about the transcript, not an image", async () => {
        let seen = ""
        const stage = jsonStage({ schema: { type: "object" }, generate: async (prompt) => { seen = prompt; return "{}" } })
        await runPipeline([stage], "hello there", { cloudPolicy: "allow" })
        expect(seen).toMatch(/present in the text/)
        expect(seen).not.toMatch(/in the image/)
    })
})

describe("imageStage", () => {
    const stage = (options: any) => imageStage({ prompt: () => "a cat", cloud: false, ...options })
    const run = (s: any, cap?: number) => runPipeline([s], {}, { maxCostUsd: cap })

    it("counts the cost the image result reports, so a spend cap can see it", async () => {
        const single = await run(stage({ requestImage: async () => ({ images: [{ url: "u" }], cost: 0.04 }) }))
        expect(single.status).toBe("done")
        expect(single.spentUsd).toBeCloseTo(0.04, 6)
    })

    it("a cost callback still wins over the reported cost, and a result with no cost adds none", async () => {
        const mapped = await run(stage({ requestImage: async () => ({ images: [{ url: "u" }], cost: 0.04 }), cost: () => 0.5 }))
        expect(mapped.spentUsd).toBeCloseTo(0.5, 6)
        const free = await run(stage({ requestImage: async () => ({ images: [{ url: "u" }], cost: null }) }))
        expect(free.spentUsd).toBe(0)
    })

    it("an empty `images` answer means generate, even when requestOptions carries stale images", async () => {
        const calls: any[] = []
        const requestImage = async (args: any) => { calls.push(args); return { images: [{ url: "u" }] } }
        await run(stage({ requestImage, requestOptions: { images: ["data:image/png;base64,AAAA"], size: "512x512" }, images: () => [] }))
        await run(stage({ requestImage, requestOptions: { images: ["data:image/png;base64,AAAA"] } })) // no callback at all
        await run(stage({ requestImage, images: () => ["data:image/png;base64,BBBB"] }))
        expect(calls[0]).not.toHaveProperty("images")
        expect(calls[0]).toMatchObject({ size: "512x512" }) // other options are kept
        expect(calls[1]).not.toHaveProperty("images")
        expect(calls[2].images).toEqual(["data:image/png;base64,BBBB"])
    })
})

describe("image sources", () => {
    it("refuses a file that is too large before reading any of it", async () => {
        const big = new Blob(["x"], { type: "image/jpeg" })
        Object.defineProperty(big, "size", { value: MAX_SOURCE_BYTES + 1 })
        const read = vi.spyOn(big, "arrayBuffer")
        await expect(toImageDataUrl(big)).rejects.toThrow(/too large/)
        expect(read).not.toHaveBeenCalled()
    })

    it("refuses a remote image whose announced size is too large, without downloading the body", async () => {
        const body = vi.fn()
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => String(MAX_SOURCE_BYTES + 1) }, blob: body })))
        await expect(toImageDataUrl("https://example.test/huge.jpg")).rejects.toThrow(/too large/)
        expect(body).not.toHaveBeenCalled()
    })

    it("a signal that aborts stops a download that is stalled", async () => {
        vi.stubGlobal("fetch", vi.fn((_u: string, init: any) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))))))
        const controller = new AbortController()
        const pending = toImageDataUrl("https://example.test/slow.jpg", { signal: controller.signal })
        controller.abort()
        await expect(pending).rejects.toThrow(/cancelled or took too long/)
    })

    it("a download that never answers is given up on at the deadline", async () => {
        vi.useFakeTimers()
        try {
            vi.stubGlobal("fetch", vi.fn((_u: string, init: any) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))))))
            const pending = toImageDataUrl("https://example.test/never.jpg").catch((e: Error) => e.message)
            await vi.advanceTimersByTimeAsync(30_001)
            expect(await pending).toMatch(/cancelled or took too long/)
        } finally {
            vi.useRealTimers()
        }
    })
})

describe("useVision stops the image download of a scan that is gone", () => {
    it("clear() aborts a download that is still running", async () => {
        const ai: any = { generate: vi.fn(), cancel: vi.fn(), output: "", route: null }
        vi.doMock("../../src/native/bridge/hooks/useAI.js", () => ({ useAI: () => ai }))
        vi.resetModules()
        const { useVision } = await import("../../src/native/bridge/hooks/useVision")
        let signal: AbortSignal | undefined
        vi.stubGlobal("fetch", vi.fn((_u: string, init: any) => { signal = init.signal; return new Promise(() => {}) }))
        const { result } = renderHook(() => useVision({ schema: { type: "object" } }))
        act(() => { void result.current.scan("https://example.test/photo.jpg") })
        await vi.waitFor(() => expect(signal).toBeDefined())
        expect(signal!.aborted).toBe(false)
        act(() => result.current.clear())
        expect(signal!.aborted).toBe(true)
        vi.doUnmock("../../src/native/bridge/hooks/useAI.js")
    })
})

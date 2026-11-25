// Server-side guards from the review backlog: message shape, honest speech formats, one image-cost rule in two places,
// a pricing check that fails on bad config, a config write that cannot half-finish, and image input that must be a list.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const router: typeof import("../src/route.js") = require("../src/route.js")
const { createSpeechAdapters } = require("../src/speechGen.js")
const serverPricing = require("../src/pricing.js")
const metrics = import("../src/metrics.js")
const cli = require("../scripts/pricing-cli.js")

function post(urlPath: string, provider: string, body: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
        const res: any = { statusCode: 200, jsonBody: undefined, setHeader() {}, on() {}, status(c: number) { this.statusCode = c; return this }, json(b: unknown) { this.jsonBody = b; resolve(res) } }
        router.handle({ method: "POST", url: urlPath, params: { provider }, body, headers: {}, on() {} } as any, res, (err: unknown) => { if (err) reject(err) })
    })
}

describe("message shape", () => {
    const ORIGINAL = process.env.AI_CONFIG
    beforeEach(() => {
        process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: { anthropic: { apiKey: "a", defaultModel: "claude-x" } } })
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: {} }))))
    })
    afterEach(() => { vi.unstubAllGlobals(); if (ORIGINAL === undefined) delete process.env.AI_CONFIG; else process.env.AI_CONFIG = ORIGINAL })

    it.each([
        [[null], /each message must be an object/],
        [[[]], /each message must be an object/],
        [[{ role: "tool", content: "x" }], /role must be/],
        [[{ role: "USER", content: "x" }], /role must be/],
        [[{ content: "x" }], /role must be/],
        [[{ role: "user", content: 5 }], /content must be a string or an array/],
        [[{ role: "user" }], /content must be a string or an array/],
    ])("refuses %j with a 400 instead of coercing it (or a 500 from inside an adapter)", async (messages, pattern) => {
        const res = await post("/anthropic/generate", "anthropic", { messages })
        expect(res.statusCode).toBe(400)
        expect(String(res.jsonBody.error)).toMatch(pattern as RegExp)
        expect(fetch).not.toHaveBeenCalled()
    })

    it("accepts system, user and assistant messages", async () => {
        const res = await post("/anthropic/generate", "anthropic", { messages: [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }, { role: "assistant", content: "hello" }, { role: "user", content: [{ type: "text", text: "again" }] }] })
        expect(res.statusCode).toBe(200)
    })
})

describe("speech format honesty", () => {
    const { gemini } = createSpeechAdapters({ throwProviderError: async () => { throw new Error("provider") }, createError: (m: string) => new Error(m) })
    const reply = (mimeType: string | undefined) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { ...(mimeType && { mimeType }), data: "AAAA" } }] } }] }))
    afterEach(() => vi.unstubAllGlobals())

    it("wraps recognised raw PCM as WAV and refuses a codec it does not know, instead of labelling its bytes as audio", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => reply("audio/L16;codec=pcm;rate=24000")))
        expect((await gemini({ apiKey: "k", model: "m", text: "hi" })).audio.mimeType).toBe("audio/wav")
        for (const bad of ["audio/webm", "audio/flac", undefined]) {
            vi.stubGlobal("fetch", vi.fn(async () => reply(bad)))
            await expect(gemini({ apiKey: "k", model: "m", text: "hi" }), String(bad)).rejects.toThrow(/unrecognised format/)
        }
    })
})

describe("one image-cost rule in two places", () => {
    it("pricing.js (server) and metrics.js (client) agree on every case", async () => {
        const { imageCost, setPricingOverrides, lookupPricing } = await metrics
        const prices: Record<string, any> = {
            both: { input: 2, output: 8, perImage: 0.04 },
            perImageOnly: { perImage: 0.04 },
            tokensOnly: { input: 2, output: 8 },
        }
        setPricingOverrides(prices)
        try {
            const usages = [undefined, { images: 0 }, { images: 2 }, { images: 2, promptTokens: 1000, completionTokens: 500 }, { images: 0, promptTokens: 1000 }, { promptTokens: 10, completionTokens: 5 }]
            for (const model of [...Object.keys(prices), "unpriced"]) {
                for (const usage of usages) {
                    const fromClient = imageCost(usage as any, model)
                    const fromServer = serverPricing.imageCost(usage, lookupPricing(model))
                    expect(fromServer, `${model} ${JSON.stringify(usage)}`).toEqual(fromClient)
                }
            }
        } finally {
            setPricingOverrides({})
        }
    })
})

describe("pricing CLI", () => {
    let dir: string
    afterEach(() => { if (dir) { try { fs.chmodSync(path.join(dir, "config"), 0o700) } catch { /* gone */ } fs.rmSync(dir, { recursive: true, force: true }) } })
    const write = (pricing: unknown) => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "cai-pricing-r3-"))
        fs.mkdirSync(path.join(dir, "config"))
        fs.writeFileSync(path.join(dir, "config", "config.json"), JSON.stringify({ AI_CONFIG: { enabled: true, providers: { openai: { apiKey: "sk-secret", defaultModel: "gpt-5" } }, ...(pricing !== undefined && { pricing }) } }))
    }
    const io = () => { const out: string[] = [], err: string[] = []; return { out, err, io: { cwd: dir, out: (s: string) => out.push(s), err: (s: string) => err.push(s), ask: async () => "" } } }

    it("--check fails when an entry is ignored as invalid, even though a built-in price hides it", async () => {
        write({ "gpt-5": { input: "cheap" } }) // gpt-5 has a built-in price, so the table alone would look fine
        const h = io()
        expect(await cli.run(["--check"], h.io)).toBe(1)
        expect(h.err.join("")).toMatch(/invalid and ignored/)
    })

    it("--check still passes for a valid configuration", async () => {
        write({ "gpt-5": { input: 1, output: 2 } })
        expect(await cli.run(["--check"], io().io)).toBe(0)
    })

    it("a failed write leaves config.json exactly as it was, with no temporary file behind", async () => {
        write(undefined)
        const file = path.join(dir, "config", "config.json")
        const before = fs.readFileSync(file, "utf8")
        fs.chmodSync(path.join(dir, "config"), 0o500) // the directory refuses new files, so the temporary file cannot be created
        const h = io()
        const code = await cli.run(["--set", "gpt-5=1,2"], h.io)
        fs.chmodSync(path.join(dir, "config"), 0o700)
        expect(code).toBe(2)
        expect(h.err.join("")).toMatch(/Could not write .*left as it was/)
        expect(fs.readFileSync(file, "utf8")).toBe(before)
        expect(fs.readdirSync(path.join(dir, "config"))).toEqual(["config.json"])
    })

    it("a successful write replaces the file whole and leaves no temporary file", async () => {
        write(undefined)
        expect(await cli.run(["--set", "gpt-5=1,2"], io().io)).toBe(0)
        expect(fs.readdirSync(path.join(dir, "config"))).toEqual(["config.json"])
        expect(JSON.parse(fs.readFileSync(path.join(dir, "config", "config.json"), "utf8")).AI_CONFIG.pricing["gpt-5"]).toMatchObject({ input: 1, output: 2 })
    })
})

describe("requestImage input", () => {
    it("rejects `images` that is not a list, with a message that says so", async () => {
        const { requestImage } = await import("../src/useImageGen.js")
        for (const bad of ["abc", { length: 1, 0: "x" }, 5, true]) {
            await expect(requestImage({ prompt: "p", images: bad as any }), String(bad)).rejects.toThrow(/images must be an array/)
        }
    })
})

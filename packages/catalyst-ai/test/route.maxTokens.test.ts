// POST /:provider/generate: genConfig.maxTokens is validated before a paid call is made.
const router: typeof import("../src/route.js") = require("../src/route.js")

function post(provider: string, body: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
        const res: any = {
            statusCode: 200, jsonBody: undefined, setHeader() {}, on() {},
            status(code: number) { this.statusCode = code; return this },
            json(b: unknown) { this.jsonBody = b; resolve(res) },
        }
        router.handle({ method: "POST", url: `/${provider}/generate`, params: { provider }, body, headers: {}, on() {} } as any, res, (err: unknown) => { if (err) reject(err) })
    })
}

describe("POST /:provider/generate: maxTokens", () => {
    const ORIGINAL = process.env.AI_CONFIG
    beforeEach(() => {
        process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: { anthropic: { apiKey: "a", defaultModel: "claude-x" } } })
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })))
    })
    afterEach(() => {
        vi.unstubAllGlobals()
        if (ORIGINAL === undefined) delete process.env.AI_CONFIG
        else process.env.AI_CONFIG = ORIGINAL
    })

    it.each([0, -5, 1.5, "100", 10_000_000])("refuses maxTokens %s as a client mistake (400), before any provider call", async (maxTokens) => {
        const res = await post("anthropic", { messages: [{ role: "user", content: "hi" }], genConfig: { maxTokens } })
        expect(res.statusCode).toBe(400)
        expect(String(res.jsonBody.error)).toMatch(/genConfig\.maxTokens/)
        expect(fetch).not.toHaveBeenCalled()
    })

    it("accepts a sensible value and an absent one", async () => {
        const ok = await post("anthropic", { messages: [{ role: "user", content: "hi" }], genConfig: { maxTokens: 256 } })
        expect(ok.statusCode).toBe(200)
        const none = await post("anthropic", { messages: [{ role: "user", content: "hi" }] })
        expect(none.statusCode).toBe(200)
    })
})

// Requests the media routes must refuse, each with the right status: a provider that cannot do the job, a provider that does not
// exist, and a model name that is not a plain identifier. None of them may reach a provider, so none needs the network.
const router: typeof import("../src/route.js") = require("../src/route.js")

function post(urlPath: string, provider: string, body: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
        const res: any = {
            statusCode: 200, jsonBody: undefined, setHeader() {}, on() {},
            status(code: number) { this.statusCode = code; return this },
            json(b: unknown) { this.jsonBody = b; resolve(res) },
        }
        router.handle({ method: "POST", url: urlPath, params: { provider }, body, headers: {}, on() {} } as any, res, (err: unknown) => { if (err) reject(err) })
    })
}

describe("media routes refuse what they cannot do", () => {
    const ORIGINAL = process.env.AI_CONFIG
    beforeEach(() => {
        process.env.AI_CONFIG = JSON.stringify({
            enabled: true,
            providers: {
                openai: { apiKey: "sk-o", imageModel: "img-o", speechModel: "tts-o" },
                gemini: { apiKey: "g-key", liveModel: "live-g" },
                anthropic: { apiKey: "a-key", defaultModel: "claude-x" },
            },
        })
        vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no provider call is expected") }))
    })
    afterEach(() => {
        vi.unstubAllGlobals()
        if (ORIGINAL === undefined) delete process.env.AI_CONFIG
        else process.env.AI_CONFIG = ORIGINAL
    })

    it("image: a provider that cannot draw is a 400 naming it, and an unknown provider is a 404", async () => {
        const cannot = await post("/anthropic/image", "anthropic", { prompt: "a cat" })
        expect(cannot.statusCode).toBe(400)
        expect(String(cannot.jsonBody.error)).toMatch(/anthropic.*does not generate images/)
        expect((await post("/mistral/image", "mistral", { prompt: "a cat" })).statusCode).toBe(404)
    })

    it("speech: a provider that cannot speak is a 400 naming it, and an unknown provider is a 404", async () => {
        const cannot = await post("/anthropic/speech", "anthropic", { text: "hello" })
        expect(cannot.statusCode).toBe(400)
        expect(String(cannot.jsonBody.error)).toMatch(/anthropic.*does not synthesize speech/)
        expect((await post("/mistral/speech", "mistral", { text: "hello" })).statusCode).toBe(404)
    })

    it("live token: a model name with URL characters is a 400 before any request", async () => {
        const bad = await post("/gemini/live-token", "gemini", { model: "../../etc?x=1" })
        expect(bad.statusCode).toBe(400)
        expect(String(bad.jsonBody.error)).toMatch(/model contains invalid characters/)
        expect(fetch).not.toHaveBeenCalled()
    })

    it("exposes its internals for the contract tests", () => {
        const internal = (router as any)._internal
        expect(typeof internal.getAIConfig).toBe("function")
        expect(typeof internal.isAIEnabled).toBe("function")
        expect(typeof internal.getProviderConfig).toBe("function")
    })
})

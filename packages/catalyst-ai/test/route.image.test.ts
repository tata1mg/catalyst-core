const router: typeof import("../src/route.js") = require("../src/route.js")

function makeReq(provider: string, body: unknown) {
    return { method: "POST", url: `/${provider}/image`, params: { provider }, body, headers: {}, on() {} }
}

function makeRes(onDone: () => void) {
    return {
        statusCode: 200,
        jsonBody: undefined as any,
        headers: {} as Record<string, string>,
        setHeader() {},
        status(code: number) {
            this.statusCode = code
            return this
        },
        json(body: unknown) {
            this.jsonBody = body
            onDone()
        },
    }
}

function post(provider: string, body: unknown): Promise<ReturnType<typeof makeRes>> {
    return new Promise((resolve, reject) => {
        const res = makeRes(() => resolve(res))
        router.handle(makeReq(provider, body) as any, res as any, (err: unknown) => {
            if (err) reject(err)
        })
    })
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe("POST /:provider/image", () => {
    const ORIGINAL = process.env.AI_CONFIG
    beforeEach(() => {
        process.env.AI_CONFIG = JSON.stringify({
            enabled: true,
            providers: {
                openai: { apiKey: "sk-o", imageModel: "img-o" },
                gemini: { apiKey: "g-key", imageModel: "img-g" },
                anthropic: { apiKey: "a-key", defaultModel: "claude-x" },
            },
        })
    })
    afterEach(() => {
        vi.unstubAllGlobals()
        if (ORIGINAL === undefined) delete process.env.AI_CONFIG
        else process.env.AI_CONFIG = ORIGINAL
    })

    it("returns 403 when AI is disabled", async () => {
        process.env.AI_CONFIG = JSON.stringify({ enabled: false })
        expect((await post("openai", { prompt: "a cat" })).statusCode).toBe(403)
    })

    it("404s an unknown provider and 400s one that cannot draw", async () => {
        expect((await post("nope", { prompt: "a cat" })).statusCode).toBe(404)
        const res = await post("anthropic", { prompt: "a cat" })
        expect(res.statusCode).toBe(400)
        expect(res.jsonBody.error).toMatch(/does not generate images/)
    })

    it.each([
        [{}, /prompt/],
        [{ prompt: "   " }, /prompt/],
        [{ prompt: "x".repeat(4001) }, /at most/],
        [{ prompt: "a", n: 0 }, /n must/],
        [{ prompt: "a", n: 5 }, /n must/],
        [{ prompt: "a", size: "huge" }, /size must/],
        [{ prompt: "a", model: "bad/model" }, /invalid characters/],
    ])("rejects an invalid body %#", async (body, pattern) => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        const res = await post("openai", body)
        expect(res.statusCode).toBe(400)
        expect(res.jsonBody.error).toMatch(pattern)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("400s when no image model is configured or given", async () => {
        process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: { openai: { apiKey: "k", defaultModel: "chat-only" } } })
        const res = await post("openai", { prompt: "a cat" })
        expect(res.statusCode).toBe(400)
        expect(res.jsonBody.error).toMatch(/imageModel/)
    })

    it("OpenAI: sends the configured image model and returns base64 images with usage", async () => {
        const fetchMock = vi.fn().mockResolvedValue(json({ data: [{ b64_json: "AAAA" }], usage: { input_tokens: 12, output_tokens: 1056 } }))
        vi.stubGlobal("fetch", fetchMock)
        const res = await post("openai", { prompt: "a red cube", n: 1, size: "1024x1024" })
        expect(res.statusCode).toBe(200)
        expect(res.jsonBody).toEqual({
            images: [{ mimeType: "image/png", data: "AAAA" }],
            usage: { model: "img-o", images: 1, promptTokens: 12, completionTokens: 1056 },
            model: "img-o",
        })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe("https://api.openai.com/v1/images/generations")
        expect(init.headers.Authorization).toBe("Bearer sk-o")
        expect(JSON.parse(init.body)).toEqual({ model: "img-o", prompt: "a red cube", n: 1, size: "1024x1024" })
    })

    it("OpenAI: a result with only provider URLs is an error, never proxied", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: [{ url: "https://x/y.png" }] })))
        const res = await post("openai", { prompt: "a cat" })
        expect(res.statusCode).toBe(500)
        expect(res.jsonBody.error).toMatch(/no image data/)
    })

    it("Gemini: returns the inline image and its mime type", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            json({
                candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/jpeg", data: "BBBB" } }] } }],
                usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1290 },
            })
        )
        vi.stubGlobal("fetch", fetchMock)
        const res = await post("gemini", { prompt: "a blue sphere" })
        expect(res.statusCode).toBe(200)
        expect(res.jsonBody.images).toEqual([{ mimeType: "image/jpeg", data: "BBBB" }])
        expect(res.jsonBody.usage).toEqual({ model: "img-g", images: 1, promptTokens: 5, completionTokens: 1290 })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/img-g:generateContent")
        expect(init.headers["x-goog-api-key"]).toBe("g-key")
        expect(JSON.parse(init.body).generationConfig.responseModalities).toContain("IMAGE")
    })

    it("Gemini: n > 1 is refused before any paid call; a text-only reply explains itself", async () => {
        const fetchMock = vi.fn().mockResolvedValue(json({ candidates: [{ content: { parts: [{ text: "I can't draw that" }] } }] }))
        vi.stubGlobal("fetch", fetchMock)
        const many = await post("gemini", { prompt: "a cat", n: 2 })
        expect(many.statusCode).toBe(400) // a mistake in the request, not an internal failure
        expect(many.jsonBody.code).toBe("AI-003")
        expect(many.jsonBody.error).toMatch(/one image per request/)
        expect(fetchMock).not.toHaveBeenCalled()
        const none = await post("gemini", { prompt: "a cat" })
        expect(none.jsonBody.error).toMatch(/no image: I can't draw that/)
    })

    it("maps an unknown mime type to png and surfaces provider errors without the key", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/svg+xml", data: "CC" } }] } }] })))
        expect((await post("gemini", { prompt: "a cat" })).jsonBody.images[0].mimeType).toBe("image/png")
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("quota exceeded", { status: 429 })))
        const err = await post("openai", { prompt: "a cat" })
        expect(err.statusCode).toBe(500)
        expect(JSON.stringify(err.jsonBody)).not.toContain("sk-o")
    })

    it("Gemini has no size setting, so a size other than auto is refused instead of quietly returning default dimensions", async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        const sized = await post("gemini", { prompt: "a cat", size: "1024x1024" })
        expect(sized.statusCode).toBe(400)
        expect(sized.jsonBody.code).toBe("AI-003")
        expect(sized.jsonBody.error).toMatch(/size/)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("refuses base64 that cannot decode ('A', '=', stray padding) before any provider call", async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        for (const data of ["A", "=", "AA=A", "A===", "", "!!!!"]) {
            const res = await post("openai", { prompt: "edit", images: [{ mimeType: "image/png", data }] })
            expect(res.statusCode, data).toBe(400)
            expect(res.jsonBody.code).toBe("AI-003")
        }
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

describe("the default request is valid for every provider", () => {
    it("{ prompt } alone (what requestImage sends) passes both validators, so omitted options are never rejected", () => {
        const img: any = require("../src/imageGen.js")
        for (const provider of ["openai", "gemini"]) {
            expect(img.validateImageRequest({ prompt: "A red square" }), provider).toBeNull()
            expect(img.validateProviderRequest(provider, { prompt: "A red square" }), provider).toBeNull()
        }
    })
})

describe("limits that agree on both sides", () => {
    it("image edits are bounded in total, like chat media, so an accepted request fits the body parser", () => {
        const img: any = require("../src/imageGen.js")
        const { DEFAULT_LIMITS } = require("../src/cloudMedia.js")
        const b64 = (bytes: number) => "A".repeat(Math.ceil((bytes * 4) / 3))
        const one = { mimeType: "image/png", data: b64(6 * 1024 * 1024) }
        expect(img.validateImageRequest({ prompt: "p", images: [one, one] })).toBeNull() // 12 MiB: fits
        expect(img.validateImageRequest({ prompt: "p", images: [one, one, one] })).toMatch(/too large together/) // 18 MiB: over the 14 MiB budget
        expect(DEFAULT_LIMITS.totalBytes).toBe(14 * 1024 * 1024)
    })

    it("the client refuses audio over what the server would refuse", () => {
        const client: any = require("../src/contentParts.js")
        const server = require("../src/cloudMedia.js")
        return import("../src/contentParts.js").then((c) => expect(c.DEFAULT_LIMITS.audioBytes).toBe(server.DEFAULT_LIMITS.audioBytes))
    })
})

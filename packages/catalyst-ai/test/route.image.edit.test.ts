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

// Image input (edit/transform) on POST /:provider/image. Provider request shapes are asserted against mocked fetch only.
describe("POST /:provider/image with input images (edit)", () => {
    const ORIGINAL = process.env.AI_CONFIG
    const png = { mimeType: "image/png", data: Buffer.from("png-bytes").toString("base64") }
    const jpg = { mimeType: "image/jpeg", data: Buffer.from("jpg-bytes").toString("base64") }
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

    it("OpenAI: POSTs multipart to /images/edits with image[] files, prompt and model", async () => {
        const fetchMock = vi.fn().mockResolvedValue(json({ data: [{ b64_json: "AAAA" }], usage: { input_tokens: 3, output_tokens: 7 } }))
        vi.stubGlobal("fetch", fetchMock)
        const res = await post("openai", { prompt: "make it blue", size: "1024x1024", images: [png, jpg] })
        expect(res.statusCode).toBe(200)
        expect(res.jsonBody.images).toEqual([{ mimeType: "image/png", data: "AAAA" }])
        expect(res.jsonBody.usage).toEqual({ model: "img-o", images: 1, inputImages: 2, promptTokens: 3, completionTokens: 7 })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe("https://api.openai.com/v1/images/edits")
        expect(init.headers.Authorization).toBe("Bearer sk-o")
        expect(init.headers["Content-Type"]).toBeUndefined()
        const form = init.body as FormData
        expect(form).toBeInstanceOf(FormData)
        expect(form.get("model")).toBe("img-o")
        expect(form.get("prompt")).toBe("make it blue")
        expect(form.get("size")).toBe("1024x1024")
        const files = form.getAll("image[]") as File[]
        expect(files.map((f) => [f.type, f.name])).toEqual([
            ["image/png", "image-0.png"],
            ["image/jpeg", "image-1.jpg"],
        ])
        expect(Buffer.from(await files[0].arrayBuffer()).toString()).toBe("png-bytes")
    })

    it("Gemini: puts the input images as inlineData parts before the text prompt", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "OUT" } }] } }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 1 } })
        )
        vi.stubGlobal("fetch", fetchMock)
        const res = await post("gemini", { prompt: "add a hat", images: [png, jpg] })
        expect(res.statusCode).toBe(200)
        expect(res.jsonBody.images).toEqual([{ mimeType: "image/png", data: "OUT" }])
        expect(res.jsonBody.usage).toEqual({ model: "img-g", images: 1, inputImages: 2, promptTokens: 9, completionTokens: 1 })
        const body = JSON.parse(fetchMock.mock.calls[0][1].body)
        expect(body.contents[0].parts).toEqual([{ inlineData: png }, { inlineData: jpg }, { text: "add a hat" }])
    })

    it("text-only requests are unchanged (no inputImages, generations endpoint)", async () => {
        const fetchMock = vi.fn().mockResolvedValue(json({ data: [{ b64_json: "A" }] }))
        vi.stubGlobal("fetch", fetchMock)
        const res = await post("openai", { prompt: "a cat" })
        expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/images/generations")
        expect(res.jsonBody.usage).not.toHaveProperty("inputImages")
    })

    it("Anthropic still refuses, even with images", async () => {
        const res = await post("anthropic", { prompt: "edit", images: [png] })
        expect(res.statusCode).toBe(400)
        expect(res.jsonBody.error).toMatch(/does not generate images/)
    })

    it.each([
        ["more than 4 images", { images: Array(5).fill(png) }, /at most 4/],
        ["an empty array", { images: [] }, /non-empty/],
        ["a non-array", { images: "x" }, /non-empty array/],
        ["a bad mime type", { images: [{ mimeType: "image/gif", data: "AAAA" }] }, /mimeType/],
        ["non-base64 data", { images: [{ mimeType: "image/png", data: "not base64!" }] }, /base64/],
        ["a missing data field", { images: [{ mimeType: "image/png" }] }, /base64/],
        ["an oversize image", { images: [{ mimeType: "image/png", data: "A".repeat(12 * 1024 * 1024) }] }, /too large/],
    ])("rejects %s without calling the provider", async (_name, extra, pattern) => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        for (const provider of ["openai", "gemini"]) {
            const res = await post(provider, { prompt: "edit", ...extra })
            expect(res.statusCode).toBe(400)
            expect(res.jsonBody.error).toMatch(pattern)
        }
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

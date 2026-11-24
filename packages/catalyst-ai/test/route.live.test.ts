const router: typeof import("../src/route.js") = require("../src/route.js")

function makeReq(provider: string, body: unknown) {
    return { method: "POST", url: `/${provider}/live-token`, params: { provider }, body, headers: {}, on() {} }
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

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })

describe("POST /gemini/live-token", () => {
    const ORIGINAL = process.env.AI_CONFIG
    beforeEach(() => {
        process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: { gemini: { apiKey: "g-key", liveModel: "live-m" } } })
    })
    afterEach(() => {
        vi.unstubAllGlobals()
        if (ORIGINAL === undefined) delete process.env.AI_CONFIG
        else process.env.AI_CONFIG = ORIGINAL
    })

    it("mints a one-use token constrained to the configured live model and returns the setup to send first", async () => {
        const fetchMock = vi.fn().mockResolvedValue(json({ name: "auth_tokens/abc" }))
        vi.stubGlobal("fetch", fetchMock)
        const res = await post("gemini", {})
        expect(res.statusCode).toBe(200)
        expect(res.jsonBody.token).toBe("auth_tokens/abc")
        expect(res.jsonBody.model).toBe("live-m")
        expect(res.jsonBody.url).toMatch(/BidiGenerateContentConstrained$/)
        expect(res.jsonBody.setup.model).toBe("models/live-m")
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/auth_tokens")
        expect(init.headers["x-goog-api-key"]).toBe("g-key")
        const sent = JSON.parse(init.body)
        expect(sent.uses).toBe(1)
        expect(sent.bidiGenerateContentSetup).toEqual(res.jsonBody.setup)
        expect(new Date(sent.newSessionExpireTime).getTime()).toBeLessThan(new Date(sent.expireTime).getTime())
        expect(JSON.stringify(res.jsonBody)).not.toContain("g-key")
    })

    it("400s without a model, or with an invalid one, before calling Google", async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: { gemini: { apiKey: "k" } } })
        expect((await post("gemini", {})).jsonBody.error).toMatch(/liveModel/)
        expect((await post("gemini", { model: "bad/model" })).statusCode).toBe(400)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("403 when AI is disabled, 404 when gemini is not configured, 500 when Google gives no token", async () => {
        process.env.AI_CONFIG = JSON.stringify({ enabled: false })
        expect((await post("gemini", {})).statusCode).toBe(403)
        process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: {} })
        expect((await post("gemini", {})).statusCode).toBe(404)
        process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: { gemini: { apiKey: "k", liveModel: "m" } } })
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({})))
        expect((await post("gemini", {})).statusCode).toBe(500)
    })
})

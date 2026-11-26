const router: typeof import("../src/route.js") = require("../src/route.js")
const { pcmToWav } = require("../src/speechGen.js")

function makeReq(provider: string, body: unknown) {
    return { method: "POST", url: `/${provider}/speech`, params: { provider }, body, headers: {}, on() {} }
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

describe("pcmToWav", () => {
    it("writes a valid 44-byte RIFF/WAVE header for 24kHz mono 16-bit PCM", () => {
        const pcm = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0])
        const wav = pcmToWav(pcm)
        expect(wav.length).toBe(44 + pcm.length)
        expect(wav.toString("ascii", 0, 4)).toBe("RIFF")
        expect(wav.readUInt32LE(4)).toBe(36 + pcm.length)
        expect(wav.toString("ascii", 8, 12)).toBe("WAVE")
        expect(wav.toString("ascii", 12, 16)).toBe("fmt ")
        expect(wav.readUInt32LE(16)).toBe(16)
        expect(wav.readUInt16LE(20)).toBe(1)
        expect(wav.readUInt16LE(22)).toBe(1)
        expect(wav.readUInt32LE(24)).toBe(24000)
        expect(wav.readUInt32LE(28)).toBe(48000)
        expect(wav.readUInt16LE(32)).toBe(2)
        expect(wav.readUInt16LE(34)).toBe(16)
        expect(wav.toString("ascii", 36, 40)).toBe("data")
        expect(wav.readUInt32LE(40)).toBe(pcm.length)
        expect(wav.subarray(44).equals(pcm)).toBe(true)
    })
})

describe("POST /:provider/speech", () => {
    const ORIGINAL = process.env.AI_CONFIG
    beforeEach(() => {
        process.env.AI_CONFIG = JSON.stringify({
            enabled: true,
            providers: {
                openai: { apiKey: "sk-o", speechModel: "tts-o", defaultModel: "chat-o" },
                gemini: { apiKey: "g-key", speechModel: "tts-g" },
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
        expect((await post("openai", { text: "hi" })).statusCode).toBe(403)
    })

    it("404s an unknown provider and 400s one that cannot speak", async () => {
        expect((await post("nope", { text: "hi" })).statusCode).toBe(404)
        const res = await post("anthropic", { text: "hi" })
        expect(res.statusCode).toBe(400)
        expect(res.jsonBody.error).toMatch(/does not synthesize speech/)
    })

    it.each([
        [{}, /text/],
        [{ text: "   " }, /text/],
        [{ text: "x".repeat(4001) }, /at most/],
        [{ text: "a", voice: "bad voice!" }, /voice/],
        [{ text: "a", format: "flac" }, /format must/],
        [{ text: "a", model: "bad/model" }, /invalid characters/],
    ])("rejects an invalid body %#", async (body, pattern) => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        const res = await post("openai", body)
        expect(res.statusCode).toBe(400)
        expect(res.jsonBody.error).toMatch(pattern)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("400s when no speech model is configured or given (the chat defaultModel is not used)", async () => {
        process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: { openai: { apiKey: "k", defaultModel: "chat-only" } } })
        const res = await post("openai", { text: "hi" })
        expect(res.statusCode).toBe(400)
        expect(res.jsonBody.error).toMatch(/speechModel/)
    })

    it("OpenAI: sends the configured model and returns base64 audio", async () => {
        const bytes = Buffer.from([0xff, 0xfb, 0x90, 0x00])
        const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }))
        vi.stubGlobal("fetch", fetchMock)
        const res = await post("openai", { text: "hello", voice: "nova", format: "mp3" })
        expect(res.statusCode).toBe(200)
        expect(res.jsonBody.audio).toEqual({ mimeType: "audio/mpeg", data: bytes.toString("base64") })
        expect(res.jsonBody.model).toBe("tts-o")
        expect(res.jsonBody.usage).toMatchObject({ model: "tts-o", characters: 5 })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe("https://api.openai.com/v1/audio/speech")
        expect(init.headers.Authorization).toBe("Bearer sk-o")
        expect(JSON.parse(init.body)).toEqual({ model: "tts-o", input: "hello", voice: "nova", response_format: "mp3" })
    })

    it("OpenAI: a request model overrides the config; opus maps to audio/ogg; empty audio is an error", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(new Response(Buffer.from([1, 2]), { status: 200 }))
        vi.stubGlobal("fetch", fetchMock)
        const res = await post("openai", { text: "hi", model: "tts-other", format: "opus" })
        expect(res.jsonBody.audio.mimeType).toBe("audio/ogg")
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("tts-other")
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Buffer.alloc(0), { status: 200 })))
        const empty = await post("openai", { text: "hi" })
        expect(empty.statusCode).toBe(500)
        expect(empty.jsonBody.error).toMatch(/no audio/)
    })

    it("Gemini: requests AUDIO with the voice and wraps raw PCM into a WAV", async () => {
        const pcm = Buffer.from([1, 0, 2, 0])
        const fetchMock = vi.fn().mockResolvedValue(
            json({
                candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm.toString("base64") } }] } }],
                usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 80 },
            })
        )
        vi.stubGlobal("fetch", fetchMock)
        const res = await post("gemini", { text: "hello", voice: "Puck" })
        expect(res.statusCode).toBe(200)
        expect(res.jsonBody.audio.mimeType).toBe("audio/wav")
        const wav = Buffer.from(res.jsonBody.audio.data, "base64")
        expect(wav.toString("ascii", 0, 4)).toBe("RIFF")
        expect(wav.readUInt32LE(24)).toBe(24000)
        expect(wav.subarray(44).equals(pcm)).toBe(true)
        expect(res.jsonBody.usage).toEqual({ model: "tts-g", characters: 5, promptTokens: 4, completionTokens: 80 })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/tts-g:generateContent")
        expect(init.headers["x-goog-api-key"]).toBe("g-key")
        const body = JSON.parse(init.body)
        expect(body.generationConfig.responseModalities).toEqual(["AUDIO"])
        expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Puck")
    })

    it("Gemini: honours a non-24k rate; refuses non-wav formats before any call; explains a text-only reply", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(
            json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=16000", data: "AAAA" } }] } }] })
        )
        vi.stubGlobal("fetch", fetchMock)
        const res = await post("gemini", { text: "hi" })
        expect(Buffer.from(res.jsonBody.audio.data, "base64").readUInt32LE(24)).toBe(16000)

        const refused = vi.fn()
        vi.stubGlobal("fetch", refused)
        const mp3 = await post("gemini", { text: "hi", format: "mp3" })
        expect(mp3.statusCode).toBe(400) // the client asked for something Gemini cannot return: a request error, not an internal one
        expect(mp3.jsonBody.code).toBe("AI-003")
        expect(mp3.jsonBody.error).toMatch(/wav/)
        expect((await post("gemini", { text: "hi", format: "opus" })).statusCode).toBe(400)
        expect(refused).not.toHaveBeenCalled()

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ candidates: [{ content: { parts: [{ text: "cannot say that" }] } }] })))
        const none = await post("gemini", { text: "hi" })
        expect(none.jsonBody.error).toMatch(/no audio: cannot say that/)
    })

    it("surfaces provider errors without leaking the key", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("quota exceeded", { status: 429 })))
        const err = await post("openai", { text: "hi" })
        expect(err.statusCode).toBe(500)
        expect(JSON.stringify(err.jsonBody)).not.toContain("sk-o")
    })
})

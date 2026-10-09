// Cloud route end to end with media (task 1.4): real router, stubbed provider fetch. Covers the validation ladder for
// media (refusals happen before any provider call) and the exact request each provider receives.
const router: typeof import("../src/route.js") = require("../src/route.js")

const PNG = "data:image/png;base64,iVBORw0KGgo="
const WAV = "data:audio/wav;base64,UklGRiQAAABXQVZF"

function makeReq(body: unknown, provider: string, kind: "generate" | "stream") {
    return { method: "POST", url: `/${provider}/${kind}`, params: { provider }, body, headers: {}, on() {} }
}
function makeRes(onDone: () => void) {
    const writes: string[] = []
    const res: any = {
        statusCode: 200, jsonBody: undefined, writes, headers: {} as Record<string, string>, writableEnded: false,
        setHeader(k: string, v: string) { this.headers[k] = v },
        flushHeaders() {},
        write(c: string) { writes.push(c); return true },
        end() { this.writableEnded = true; onDone() },
        status(c: number) { this.statusCode = c; return this },
        json(b: unknown) { this.jsonBody = b; onDone() },
        on() {},
    }
    return res
}
const invoke = (req: any) => new Promise<any>((resolve, reject) => { const res = makeRes(() => resolve(res)); router.handle(req, res, (e: any) => e && reject(e)) })
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe("cloud route with media", () => {
    const ORIGINAL = process.env.AI_CONFIG
    beforeEach(() => {
        process.env.AI_CONFIG = JSON.stringify({
            enabled: true,
            providers: { openai: { apiKey: "sk", defaultModel: "gpt-4o-mini" }, gemini: { apiKey: "gm", defaultModel: "gemini-3.5-flash" } },
        })
    })
    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.AI_CONFIG
        else process.env.AI_CONFIG = ORIGINAL
        vi.unstubAllGlobals()
    })

    const withImage = [{ role: "user", content: [{ type: "text", text: "what is this?" }, { type: "image", data: PNG }] }]
    const withAudio = [{ role: "user", content: [{ type: "audio", data: WAV }, { type: "text", text: "transcribe" }] }]

    it("openai chat: sends image_url to the provider", async () => {
        const fetchMock = vi.fn().mockResolvedValue(ok({ choices: [{ message: { content: "a cat" } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }))
        vi.stubGlobal("fetch", fetchMock)
        const res = await invoke(makeReq({ messages: withImage }, "openai", "generate"))
        expect(res.statusCode).toBe(200)
        const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
        expect(sent.messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: PNG } })
    })

    it("openai chat with an audio model: sends input_audio", async () => {
        const fetchMock = vi.fn().mockResolvedValue(ok({ choices: [{ message: { content: "hello" } }] }))
        vi.stubGlobal("fetch", fetchMock)
        await invoke(makeReq({ messages: withAudio, model: "gpt-audio-1.5" }, "openai", "generate"))
        const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
        expect(sent.messages[0].content[0]).toEqual({ type: "input_audio", input_audio: { data: "UklGRiQAAABXQVZF", format: "wav" } })
    })

    it("gemini generateContent: sends inlineData for image and audio", async () => {
        const fetchMock = vi.fn().mockResolvedValue(ok({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }))
        vi.stubGlobal("fetch", fetchMock)
        await invoke(makeReq({ messages: [{ role: "user", content: [{ type: "image", data: PNG }, { type: "audio", data: WAV }] }] }, "gemini", "generate"))
        const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
        expect(sent.contents[0].parts).toEqual([
            { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } },
            { inlineData: { mimeType: "audio/wav", data: "UklGRiQAAABXQVZF" } },
        ])
    })

    it("gemini stateful interactions: sends typed blocks as input", async () => {
        const fetchMock = vi.fn().mockResolvedValue(ok({ id: "i1", steps: [{ type: "model_output", content: [{ text: "ok" }] }] }))
        vi.stubGlobal("fetch", fetchMock)
        await invoke(makeReq({ messages: withImage, conversationId: null }, "gemini", "generate"))
        const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
        expect(sent.input).toEqual([{ type: "text", text: "what is this?" }, { type: "image", mime_type: "image/png", data: "iVBORw0KGgo=" }])
    })

    it("openai stateful responses: sends input_image", async () => {
        const fetchMock = vi.fn().mockResolvedValue(ok({ id: "r1", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] }))
        vi.stubGlobal("fetch", fetchMock)
        await invoke(makeReq({ messages: withImage, conversationId: null }, "openai", "generate"))
        const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
        expect(sent.input[0].content[1]).toEqual({ type: "input_image", image_url: PNG })
    })

    it("refuses unsupported combinations with 400 before any provider call", async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        // gpt-4o-mini has no audio
        let res = await invoke(makeReq({ messages: withAudio }, "openai", "generate"))
        expect(res.statusCode).toBe(400)
        expect(JSON.stringify(res.jsonBody)).toMatch(/unsupported-modality/)
        // stateful gemini audio is unconfirmed
        res = await invoke(makeReq({ messages: withAudio, conversationId: null }, "gemini", "generate"))
        expect(res.statusCode).toBe(400)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("refuses malformed parts with 400 and never echoes the media back", async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        const res = await invoke(makeReq({ messages: [{ role: "user", content: [{ type: "image", data: "http://evil/x.png" }] }] }, "gemini", "generate"))
        expect(res.statusCode).toBe(400)
        expect(JSON.stringify(res.jsonBody)).not.toContain("evil")
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("stream path validates too", async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        const res = await invoke(makeReq({ messages: withAudio }, "openai", "stream"))
        expect(res.statusCode).toBe(400)
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

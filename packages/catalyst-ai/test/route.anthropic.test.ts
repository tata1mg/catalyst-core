// Claude (Anthropic Messages API) through the real cloud router, with the provider fetch stubbed: exact request shape,
// SSE framing, usage normalisation, media and structured-output mapping, refusals and errors.
const router: typeof import("../src/route.js") = require("../src/route.js")
const { PRICING } = require("../src/pricing.js")

const PNG = "data:image/png;base64,iVBORw0KGgo="
const PDF = "data:application/pdf;base64,JVBERi0xLjQK"
const WAV = "data:audio/wav;base64,UklGRiQAAABXQVZF"

function makeReq(body: unknown, kind: "generate" | "stream") {
    return { method: "POST", url: `/anthropic/${kind}`, params: { provider: "anthropic" }, body, headers: {}, on() {} }
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
const sse = (...events: object[]) =>
    new Response(
        new ReadableStream({
            start(c) {
                const enc = new TextEncoder()
                for (const e of events) c.enqueue(enc.encode(`event: ${(e as any).type}\ndata: ${JSON.stringify(e)}\n\n`))
                c.close()
            },
        }),
        { status: 200 }
    )
const frames = (res: any) => res.writes.map((w: string) => w.replace(/^data: /, "").trim()).map((w: string) => (w === "[DONE]" ? w : JSON.parse(w)))

describe("anthropic provider", () => {
    const ORIGINAL = process.env.AI_CONFIG
    let fetchMock: ReturnType<typeof vi.fn>
    const sent = () => ({ url: fetchMock.mock.calls[0][0], init: fetchMock.mock.calls[0][1], body: JSON.parse(fetchMock.mock.calls[0][1].body) })

    beforeEach(() => {
        process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: { anthropic: { apiKey: "sk-ant", defaultModel: "claude-opus-5-5" } } })
        fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
    })
    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.AI_CONFIG
        else process.env.AI_CONFIG = ORIGINAL
        vi.unstubAllGlobals()
    })

    it("generate: posts to the Messages API with the right headers and returns text plus normalised usage", async () => {
        fetchMock.mockResolvedValue(ok({
            content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Hel" }, { type: "text", text: "lo" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 5, output_tokens: 7 },
        }))
        const res = await invoke(makeReq({ messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }] }, "generate"))
        const { url, init, body } = sent()
        expect(url).toBe("https://api.anthropic.com/v1/messages")
        expect(init.headers).toMatchObject({ "x-api-key": "sk-ant", "anthropic-version": "2023-06-01" })
        expect(body).toMatchObject({ model: "claude-opus-5-5", max_tokens: 16000, system: "Be brief.", messages: [{ role: "user", content: "hi" }] })
        expect(body.stream).toBeUndefined()
        expect(res.jsonBody).toMatchObject({
            output: "Hello",
            conversationId: null,
            model: "claude-opus-5-5",
            usage: { promptTokens: 105, cachedTokens: 90, completionTokens: 7, reasoningTokens: 0 },
        })
    })

    it("stream: forwards text deltas only, then usage, then [DONE]", async () => {
        fetchMock.mockResolvedValue(sse(
            { type: "message_start", message: { usage: { input_tokens: 12, cache_read_input_tokens: 0, output_tokens: 1 } } },
            { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "secret" } },
            { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hi" } },
            { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: " there" } },
            { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } },
            { type: "message_stop" }
        ))
        const res = await invoke(makeReq({ messages: [{ role: "user", content: "hi" }] }, "stream"))
        expect(sent().body).toMatchObject({ stream: true, max_tokens: 64000 })
        expect(frames(res)).toEqual([
            { token: "Hi" },
            { token: " there" },
            { usage: { model: "claude-opus-5-5", promptTokens: 12, cachedTokens: 0, completionTokens: 4, reasoningTokens: 0 } },
            "[DONE]",
        ])
        expect(JSON.stringify(res.writes)).not.toContain("secret")
    })

    it("stream: an error event or a refusal becomes an error frame, never a silent empty reply", async () => {
        fetchMock.mockResolvedValue(sse({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }))
        const failed = await invoke(makeReq({ messages: [{ role: "user", content: "hi" }] }, "stream"))
        expect(frames(failed).at(-1)).toMatchObject({ error: "Overloaded" })

        fetchMock.mockResolvedValue(sse(
            { type: "message_start", message: { usage: { input_tokens: 3 } } },
            { type: "message_delta", delta: { stop_reason: "refusal", stop_details: { category: "cyber" } }, usage: { output_tokens: 0 } }
        ))
        const refused = await invoke(makeReq({ messages: [{ role: "user", content: "hi" }] }, "stream"))
        expect(frames(refused).at(-1)).toMatchObject({ error: "The model declined this request (cyber)" })
    })

    it("generate: a refusal is an error, and an HTTP error is wrapped as a provider error", async () => {
        fetchMock.mockResolvedValue(ok({ content: [], stop_reason: "refusal", stop_details: { category: "bio" }, usage: {} }))
        const refused = await invoke(makeReq({ messages: [{ role: "user", content: "hi" }] }, "generate"))
        expect(refused.statusCode).toBe(500)
        expect(refused.jsonBody).toMatchObject({ error: "The model declined this request (bio)" })

        fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401 }))
        const denied = await invoke(makeReq({ messages: [{ role: "user", content: "hi" }] }, "generate"))
        expect(denied.statusCode).toBe(500)
        expect(denied.jsonBody.error).not.toContain("sk-ant")
    })

    it("sampling parameters are sent only to models that still accept them", async () => {
        fetchMock.mockResolvedValue(ok({ content: [{ type: "text", text: "x" }], usage: {} }))
        const call = async (model: string) => {
            fetchMock.mockClear()
            await invoke(makeReq({ model, messages: [{ role: "user", content: "hi" }], genConfig: { temperature: 0.2, topP: 0.9, maxTokens: 512 } }, "generate"))
            return sent().body
        }
        for (const model of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-opus-4-8"]) {
            const body = await call(model)
            expect(body).not.toHaveProperty("temperature")
            expect(body).not.toHaveProperty("top_p")
            expect(body.max_tokens).toBe(512)
        }
        for (const model of ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"]) {
            expect(await call(model)).toMatchObject({ temperature: 0.2, top_p: 0.9 })
        }
    })

    it("images and PDFs become base64 source blocks placed before the text", async () => {
        fetchMock.mockResolvedValue(ok({ content: [{ type: "text", text: "x" }], usage: {} }))
        await invoke(makeReq({
            messages: [{ role: "user", content: [{ type: "text", text: "summarise" }, { type: "image", data: PNG }, { type: "document", data: PDF }] }],
        }, "generate"))
        expect(sent().body.messages[0].content).toEqual([
            { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQK" } },
            { type: "text", text: "summarise" },
        ])
    })

    it("refuses audio, wrong PDF types and other providers' PDFs before any paid call", async () => {
        const audio = await invoke(makeReq({ messages: [{ role: "user", content: [{ type: "audio", data: WAV }] }] }, "generate"))
        expect(audio.statusCode).toBe(400)
        const notPdf = await invoke(makeReq({ messages: [{ role: "user", content: [{ type: "document", data: "data:text/plain;base64,aGk=" }] }] }, "generate"))
        expect(notPdf.statusCode).toBe(400)
        expect(fetchMock).not.toHaveBeenCalled()

        process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: { openai: { apiKey: "sk", defaultModel: "gpt-4o-mini" } } })
        const openai = await invoke({ ...makeReq({ messages: [{ role: "user", content: [{ type: "document", data: PDF }] }] }, "generate"), url: "/openai/generate", params: { provider: "openai" } })
        expect(openai.statusCode).toBe(400)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("responseSchema turns on structured outputs", async () => {
        fetchMock.mockResolvedValue(ok({ content: [{ type: "text", text: "{}" }], usage: {} }))
        const schema = { type: "object", properties: { total: { type: "number" } }, required: ["total"], additionalProperties: false }
        await invoke(makeReq({ messages: [{ role: "user", content: "read it" }], genConfig: { responseSchema: schema } }, "generate"))
        expect(sent().body.output_config).toEqual({ format: { type: "json_schema", schema } })
        fetchMock.mockClear()
        await invoke(makeReq({ messages: [{ role: "user", content: "read it" }] }, "generate"))
        expect(sent().body).not.toHaveProperty("output_config")
    })

    it("every conversation turn is sent (the Messages API is stateless), even when a conversationId is passed", async () => {
        fetchMock.mockResolvedValue(ok({ content: [{ type: "text", text: "x" }], usage: {} }))
        await invoke(makeReq({
            conversationId: "abc",
            messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }],
        }, "generate"))
        expect(sent().body.messages.map((m: any) => m.role + ":" + m.content)).toEqual(["user:a", "assistant:b", "user:c"])
    })

    it("lists the provider and prices Claude models", async () => {
        expect(PRICING["claude-opus-5-5"]).toMatchObject({ input: 4, output: 20 })
        expect(PRICING["claude-sonnet-5-5"].cachedInput).toBeLessThan(PRICING["claude-sonnet-5-5"].input)
        expect(PRICING["gpt-5"]).toBeDefined() // existing entries untouched
    })
})

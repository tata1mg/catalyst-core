// describe/it/expect/vi come from vitest's `globals: true` config (see
// vitest.config.mjs).
//
// This file exercises the route HANDLERS themselves (GET /providers, POST
// /:provider/stream, POST /:provider/generate) and the provider adapters
// they dispatch to (openaiStream/openaiGenerate/geminiStream/geminiGenerate)
// — none of which are exposed via router._internal (see route.test.ts for
// the pure-logic helpers that are). Those handlers were route.js's biggest
// uncovered surface (lines ~477-599 of 626).
//
// Approach: drive the real Express router directly via router.handle(req,
// res, next) with small hand-built req/res doubles, rather than supertest +
// a real HTTP server/socket. POST /:provider/stream is a long-lived SSE
// response — supertest buffers responses and doesn't give clean access to
// "what was written and when", whereas a mock res.write() capture does
// exactly that with no socket lifecycle to manage. An Express router is
// just a callable function with .handle(req, res, next); it doesn't need a
// real net.Socket underneath to run its own routing/handler logic.
//
// Outbound provider calls (OpenAI/Gemini) go through global fetch, which is
// stubbed per-test with vi.stubGlobal. Streaming responses use a real
// ReadableStream (Node's native Response/ReadableStream, available without
// any polyfill) so the adapters' actual reader/decoder/SSE-line-splitting
// loops execute for real, not just their post-parse branches.
const router: typeof import("../src/route.js") = require("../src/route.js")

function sseStream(lines: string[]): ReadableStream {
    return new ReadableStream({
        start(controller) {
            const enc = new TextEncoder()
            for (const line of lines) controller.enqueue(enc.encode(line))
            controller.close()
        },
    })
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status })
}

function errorResponse(status: number, text: string): Response {
    return new Response(text, { status })
}

// Minimal Express-request double. `on` is required by the /stream handler
// (registers a no-op "close" listener in these tests — the abort-on-
// disconnect path is covered separately below).
function makeReq({ method, url, params, body }: { method: string; url: string; params?: Record<string, string>; body?: unknown }) {
    return {
        method,
        url,
        params: params ?? {},
        body: body ?? {},
        headers: {},
        on() {},
    }
}

// Minimal Express-response double. Captures every res.write() call (in
// order) so SSE event streams can be asserted against, plus whatever was
// passed to res.status()/res.json().
//
// Unlike a real Express response, router.handle()'s own `next` callback is
// only invoked when NO route layer matches/responds — every route this file
// exercises does match and does respond, so `next` never fires and can't be
// used to know when the handler is done. Instead this double calls `onDone`
// from whichever of end()/json() the handler actually uses to finish the
// response, and invoke() below awaits that instead of `next`.
function makeRes(onDone: () => void) {
    const writes: string[] = []
    let closeHandler: (() => void) | null = null
    const res = {
        statusCode: 200,
        jsonBody: undefined as unknown,
        ended: false,
        writableEnded: false,
        writes,
        headers: {} as Record<string, string>,
        setHeader(name: string, value: string) {
            this.headers[name] = value
        },
        flushHeaders() {},
        write(chunk: string) {
            writes.push(chunk)
            return true
        },
        end() {
            this.ended = true
            this.writableEnded = true
            onDone()
        },
        status(code: number) {
            this.statusCode = code
            return this
        },
        json(body: unknown) {
            this.jsonBody = body
            onDone()
        },
        on(event: string, handler: () => void) {
            if (event === "close") closeHandler = handler
        },
        // test-only helper, not part of the real Express Response contract
        triggerClose() {
            closeHandler?.()
        },
    }
    return res
}

function invoke(req: ReturnType<typeof makeReq>, resFactory: (onDone: () => void) => ReturnType<typeof makeRes>): Promise<ReturnType<typeof makeRes>> {
    return new Promise((resolve, reject) => {
        const res = resFactory(() => resolve(res))
        router.handle(req, res, (err) => {
            if (err) reject(err)
            // else: no matching/responding layer — for these tests that's
            // always a bug in the test's own req (wrong method/url), not a
            // real "pass through" case, so leave the promise pending and let
            // vitest's own test timeout surface it clearly.
        })
    })
}

describe("GET /providers", () => {
    const ORIGINAL_ENV = process.env.AI_CONFIG
    afterEach(() => {
        if (ORIGINAL_ENV === undefined) delete process.env.AI_CONFIG
        else process.env.AI_CONFIG = ORIGINAL_ENV
    })

    it("returns 403 AI_DISABLED when AI is disabled", async () => {
        delete process.env.AI_CONFIG
        const req = makeReq({ method: "GET", url: "/providers" })
        const res = await invoke(req, (onDone) => makeRes(onDone))
        expect(res.statusCode).toBe(403)
        expect((res.jsonBody as { code: string }).code).toBe("AI-001")
    })

    it("lists configured providers without exposing apiKey", async () => {
        process.env.AI_CONFIG = JSON.stringify({
            enabled: true,
            providers: {
                openai: { apiKey: "sk-test", defaultModel: "gpt-4o" },
                gemini: { apiKey: "" }, // no apiKey -> filtered out
            },
        })
        const req = makeReq({ method: "GET", url: "/providers" })
        const res = await invoke(req, (onDone) => makeRes(onDone))
        expect(res.statusCode).toBe(200)
        expect(res.jsonBody).toEqual({ providers: [{ id: "openai", defaultModel: "gpt-4o" }] })
        expect(JSON.stringify(res.jsonBody)).not.toContain("sk-test")
    })
})

describe("POST /:provider/stream and /:provider/generate — validation ladder", () => {
    const ORIGINAL_ENV = process.env.AI_CONFIG
    afterEach(() => {
        if (ORIGINAL_ENV === undefined) delete process.env.AI_CONFIG
        else process.env.AI_CONFIG = ORIGINAL_ENV
        vi.unstubAllGlobals()
    })

    for (const suffix of ["stream", "generate"]) {
        it(`POST /:provider/${suffix} — 403 when AI disabled`, async () => {
            delete process.env.AI_CONFIG
            const req = makeReq({ method: "POST", url: `/openai/${suffix}`, params: { provider: "openai" } })
            const res = await invoke(req, (onDone) => makeRes(onDone))
            expect(res.statusCode).toBe(403)
            expect((res.jsonBody as { code: string }).code).toBe("AI-001")
        })

        it(`POST /:provider/${suffix} — 404 for unknown provider`, async () => {
            process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: {} })
            const req = makeReq({ method: "POST", url: `/carrier-pigeon/${suffix}`, params: { provider: "carrier-pigeon" } })
            const res = await invoke(req, (onDone) => makeRes(onDone))
            expect(res.statusCode).toBe(404)
            expect(res.jsonBody).toEqual({ error: "Unknown provider: carrier-pigeon" })
        })

        it(`POST /:provider/${suffix} — 404 AI_PROVIDER_NOT_CONFIGURED when provider has no apiKey`, async () => {
            process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: {} })
            const req = makeReq({ method: "POST", url: `/openai/${suffix}`, params: { provider: "openai" } })
            const res = await invoke(req, (onDone) => makeRes(onDone))
            expect(res.statusCode).toBe(404)
            expect((res.jsonBody as { code: string }).code).toBe("AI-002")
        })

        it(`POST /:provider/${suffix} — 400 AI_INVALID_REQUEST_BODY on empty messages`, async () => {
            process.env.AI_CONFIG = JSON.stringify({ enabled: true, providers: { openai: { apiKey: "sk-test", defaultModel: "gpt-4o" } } })
            const req = makeReq({ method: "POST", url: `/openai/${suffix}`, params: { provider: "openai" }, body: { messages: [] } })
            const res = await invoke(req, (onDone) => makeRes(onDone))
            expect(res.statusCode).toBe(400)
            expect((res.jsonBody as { code: string }).code).toBe("AI-003")
        })
    }
})

describe("POST /:provider/generate — provider adapters", () => {
    const ORIGINAL_ENV = process.env.AI_CONFIG
    beforeEach(() => {
        process.env.AI_CONFIG = JSON.stringify({
            enabled: true,
            providers: {
                openai: { apiKey: "sk-test", defaultModel: "gpt-4o" },
                gemini: { apiKey: "gm-test", defaultModel: "gemini-2.0-flash" },
            },
        })
    })
    afterEach(() => {
        if (ORIGINAL_ENV === undefined) delete process.env.AI_CONFIG
        else process.env.AI_CONFIG = ORIGINAL_ENV
        vi.unstubAllGlobals()
    })

    it("openai (stateless chat completions): returns output + usage", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse({
                choices: [{ message: { content: "Hello there" } }],
                usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 2 } },
            })
        )
        vi.stubGlobal("fetch", fetchMock)

        const req = makeReq({ method: "POST", url: "/openai/generate", params: { provider: "openai" }, body: { messages: [{ role: "user", content: "hi" }] } })
        const res = await invoke(req, (onDone) => makeRes(onDone))

        expect(res.statusCode).toBe(200)
        const body = res.jsonBody as { output: string; conversationId: null; usage: { completionTokens: number; reasoningTokens: number }; model: string }
        expect(body.output).toBe("Hello there")
        expect(body.conversationId).toBeNull()
        expect(body.usage).toEqual({ model: "gpt-4o", promptTokens: 10, cachedTokens: 0, completionTokens: 3, reasoningTokens: 2 })
        expect(body.model).toBe("gpt-4o")
        expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/chat/completions", expect.objectContaining({ method: "POST" }))
    })

    it("openai (stateful responses API): returns output + conversationId via previous_response_id branch", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse({
                id: "resp_123",
                output: [{ type: "message", content: [{ type: "output_text", text: "Stateful reply" }] }],
                usage: { input_tokens: 8, output_tokens: 4 },
            })
        )
        vi.stubGlobal("fetch", fetchMock)

        const req = makeReq({
            method: "POST",
            url: "/openai/generate",
            params: { provider: "openai" },
            body: { messages: [{ role: "user", content: "hi" }], conversationId: "resp_prev" },
        })
        const res = await invoke(req, (onDone) => makeRes(onDone))

        expect(res.statusCode).toBe(200)
        const body = res.jsonBody as { output: string; conversationId: string }
        expect(body.output).toBe("Stateful reply")
        expect(body.conversationId).toBe("resp_123")
        const [, init] = fetchMock.mock.calls[0] as [string, { body: string }]
        expect(JSON.parse(init.body).previous_response_id).toBe("resp_prev")
    })

    it("gemini (stateless generateContent): returns output + usage", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse({
                candidates: [{ content: { parts: [{ text: "Gemini reply" }] } }],
                usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 3 },
            })
        )
        vi.stubGlobal("fetch", fetchMock)

        const req = makeReq({ method: "POST", url: "/gemini/generate", params: { provider: "gemini" }, body: { messages: [{ role: "user", content: "hi" }] } })
        const res = await invoke(req, (onDone) => makeRes(onDone))

        expect(res.statusCode).toBe(200)
        const body = res.jsonBody as { output: string; usage: { promptTokens: number } }
        expect(body.output).toBe("Gemini reply")
        expect(body.usage.promptTokens).toBe(6)
        expect(fetchMock).toHaveBeenCalledWith("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent", expect.any(Object))
    })

    it("gemini (stateful interactions API): returns output + conversationId, uses last user message as input", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse({
                id: "int_456",
                steps: [{ type: "model_output", content: [{ text: "Interaction reply" }] }],
                usage: { total_input_tokens: 5, total_output_tokens: 2 },
            })
        )
        vi.stubGlobal("fetch", fetchMock)

        const req = makeReq({
            method: "POST",
            url: "/gemini/generate",
            params: { provider: "gemini" },
            body: { messages: [{ role: "system", content: "be nice" }, { role: "user", content: "hi" }], conversationId: "int_prev" },
        })
        const res = await invoke(req, (onDone) => makeRes(onDone))

        expect(res.statusCode).toBe(200)
        const body = res.jsonBody as { output: string; conversationId: string }
        expect(body.output).toBe("Interaction reply")
        expect(body.conversationId).toBe("int_456")
        const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }]
        expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions")
        const sentBody = JSON.parse(init.body)
        expect(sentBody.input).toBe("hi")
        expect(sentBody.system_instruction).toBe("be nice") // plain string, not { parts }
        expect(sentBody.previous_interaction_id).toBe("int_prev")
    })

    it("returns 500 with upstream-wrapped error when provider responds non-ok", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(401, "invalid api key")))
        const req = makeReq({ method: "POST", url: "/openai/generate", params: { provider: "openai" }, body: { messages: [{ role: "user", content: "hi" }] } })
        const res = await invoke(req, (onDone) => makeRes(onDone))

        expect(res.statusCode).toBe(500)
        const body = res.jsonBody as { error: string; code: string }
        expect(body.code).toBe("AI-000")
        expect(body.error).toContain("openai")
    })
})

describe("POST /:provider/stream — provider adapters (SSE)", () => {
    const ORIGINAL_ENV = process.env.AI_CONFIG
    beforeEach(() => {
        process.env.AI_CONFIG = JSON.stringify({
            enabled: true,
            providers: {
                openai: { apiKey: "sk-test", defaultModel: "gpt-4o" },
                gemini: { apiKey: "gm-test", defaultModel: "gemini-2.0-flash" },
            },
        })
    })
    afterEach(() => {
        if (ORIGINAL_ENV === undefined) delete process.env.AI_CONFIG
        else process.env.AI_CONFIG = ORIGINAL_ENV
        vi.unstubAllGlobals()
    })

    it("openai (stateless chat completions): streams tokens + usage + [DONE], sets SSE headers", async () => {
        const body = sseStream([
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
            // a deliberately malformed line to cover the swallow-and-continue catch block
            "data: {not json\n\n",
            'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
            "data: [DONE]\n\n",
        ])
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })))

        const req = makeReq({ method: "POST", url: "/openai/stream", params: { provider: "openai" }, body: { messages: [{ role: "user", content: "hi" }] } })
        const res = await invoke(req, (onDone) => makeRes(onDone))

        expect(res.headers["Content-Type"]).toBe("text/event-stream")
        expect(res.ended).toBe(true)
        const tokens = res.writes.filter((w) => w.includes('"token"')).map((w) => JSON.parse(w.slice(6)).token)
        expect(tokens).toEqual(["Hel", "lo"])
        expect(res.writes.some((w) => w.includes('"usage"'))).toBe(true)
        expect(res.writes.at(-1)).toBe("data: [DONE]\n\n")
    })

    it("openai (stateful responses API): streams conversationId + token deltas", async () => {
        const body = sseStream([
            'data: {"type":"response.created","response":{"id":"resp_789"}}\n\n',
            'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n',
            'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":1}}}\n\n',
            "data: [DONE]\n\n",
        ])
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })))

        const req = makeReq({
            method: "POST",
            url: "/openai/stream",
            params: { provider: "openai" },
            body: { messages: [{ role: "user", content: "hi" }], conversationId: "resp_prev" },
        })
        const res = await invoke(req, (onDone) => makeRes(onDone))

        const convoWrite = res.writes.find((w) => w.includes("conversationId"))
        expect(convoWrite && JSON.parse(convoWrite.slice(6)).conversationId).toBe("resp_789")
        const tokenWrite = res.writes.find((w) => w.includes('"token"'))
        expect(tokenWrite && JSON.parse(tokenWrite.slice(6)).token).toBe("Hi")
    })

    it("gemini (stateless streamGenerateContent): streams tokens + usage", async () => {
        const body = sseStream([
            'data: {"candidates":[{"content":{"parts":[{"text":"Yo"}]}}]}\n\n',
            'data: {"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":2}}\n\n',
            "data: [DONE]\n\n",
        ])
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })))

        const req = makeReq({ method: "POST", url: "/gemini/stream", params: { provider: "gemini" }, body: { messages: [{ role: "user", content: "hi" }] } })
        const res = await invoke(req, (onDone) => makeRes(onDone))

        const tokenWrite = res.writes.find((w) => w.includes('"token"'))
        expect(tokenWrite && JSON.parse(tokenWrite.slice(6)).token).toBe("Yo")
        expect(res.writes.some((w) => w.includes('"usage"'))).toBe(true)
    })

    it("gemini (stateful interactions API): streams step deltas + conversationId + usage", async () => {
        const body = sseStream([
            'data: {"event_type":"step.delta","delta":{"type":"text","text":"Yo"}}\n\n',
            'data: {"event_type":"interaction.completed","interaction":{"id":"int_999","usage":{"total_input_tokens":3,"total_output_tokens":1}}}\n\n',
            "data: [DONE]\n\n",
        ])
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })))

        const req = makeReq({
            method: "POST",
            url: "/gemini/stream",
            params: { provider: "gemini" },
            body: { messages: [{ role: "user", content: "hi" }], conversationId: "int_prev" },
        })
        const res = await invoke(req, (onDone) => makeRes(onDone))

        const tokenWrite = res.writes.find((w) => w.includes('"token"'))
        expect(tokenWrite && JSON.parse(tokenWrite.slice(6)).token).toBe("Yo")
        const convoWrite = res.writes.find((w) => w.includes("conversationId"))
        expect(convoWrite && JSON.parse(convoWrite.slice(6)).conversationId).toBe("int_999")
    })

    it("writes an SSE error event (not a thrown exception) when the provider responds non-ok", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(500, "upstream boom")))
        const req = makeReq({ method: "POST", url: "/openai/stream", params: { provider: "openai" }, body: { messages: [{ role: "user", content: "hi" }] } })
        const res = await invoke(req, (onDone) => makeRes(onDone))

        expect(res.ended).toBe(true)
        const errWrite = res.writes.find((w) => w.includes('"error"'))
        expect(errWrite).toBeDefined()
        const parsed = JSON.parse((errWrite as string).slice(6))
        expect(parsed.code).toBe("AI-000")
    })

    it("does not double-write once the response already ended (client-disconnect path)", async () => {
        // Simulates the fetch rejecting after res "close" already fired and
        // ended the response via abortController — the catch block's
        // `if (!res.writableEnded)` guard should skip writing again.
        vi.stubGlobal(
            "fetch",
            vi.fn().mockImplementation(() => {
                throw new DOMException("The operation was aborted.", "AbortError")
            })
        )
        const req = makeReq({ method: "POST", url: "/openai/stream", params: { provider: "openai" }, body: { messages: [{ role: "user", content: "hi" }] } })
        // Pre-end the response before the handler even starts, as if the
        // client had already disconnected — bypass invoke()'s onDone wiring
        // (the handler's own end()/json() won't fire again on an
        // already-ended response) and instead just wait a tick for the
        // handler's fire-and-forget async work to finish.
        const res = makeRes(() => {})
        res.end()
        router.handle(req, res, () => {})
        // Give the handler's fire-and-forget async chain (sseHeaders -> the
        // stubbed fetch throw -> catch block) a couple of microtask/macrotask
        // turns to run to completion before asserting.
        await new Promise((resolve) => setImmediate(resolve))
        await new Promise((resolve) => setImmediate(resolve))
        // no new writes should have been appended after the pre-existing end()
        expect(res.writes.length).toBe(0)
    })
})

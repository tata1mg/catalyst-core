// Server-side media handling for the cloud route (tracking issue #523, task 1.4). The client caps in contentParts.js can
// be bypassed and this server spends paid API keys, so everything is re-validated here. Four pure mappers turn the
// canonical parts into each provider API shape. Text-only requests must come out exactly as they did before.
const m: typeof import("../src/cloudMedia.js") = require("../src/cloudMedia.js")

const PNG = "data:image/png;base64,iVBORw0KGgo="
const WAV = "data:audio/wav;base64,UklGRiQAAABXQVZF"
const user = (content: unknown) => ({ role: "user", content })
const mixed = [user([{ type: "text", text: "what is this?" }, { type: "image", data: PNG }, { type: "audio", data: WAV }])]

describe("validateMessages", () => {
    it("accepts plain string content", () => {
        expect(m.validateMessages([user("hi")])[0].parts).toEqual([{ type: "text", text: "hi" }])
    })

    it("accepts text, image and audio parts in order", () => {
        const parts = m.validateMessages(mixed)[0].parts
        expect(parts.map((p: any) => p.type)).toEqual(["text", "image", "audio"])
        expect(parts[1]).toEqual({ type: "image", mimeType: "image/png", base64: "iVBORw0KGgo=" })
    })

    it.each([
        ["unknown part type", [{ type: "video", data: PNG }]],
        ["image without data", [{ type: "image" }]],
        ["non data-URL image", [{ type: "image", data: "http://x/y.png" }]],
        ["audio carrying an image mime type", [{ type: "audio", data: PNG }]],
        ["text part without text", [{ type: "text" }]],
        ["empty array", []],
    ])("rejects %s", (_name, content) => {
        expect(() => m.validateMessages([user(content)])).toThrow()
    })

    it("rejects media in non-user messages", () => {
        expect(() => m.validateMessages([{ role: "assistant", content: [{ type: "image", data: PNG }] }])).toThrow(/user/i)
        expect(() => m.validateMessages([{ role: "system", content: [{ type: "audio", data: WAV }] }])).toThrow(/user/i)
    })

    it("enforces per-part size and image count on the server", () => {
        const big = "data:image/png;base64," + "A".repeat(Math.ceil((m.DEFAULT_LIMITS.imageBytes * 4) / 3) + 8)
        expect(() => m.validateMessages([user([{ type: "image", data: big }])])).toThrow(/too large|limit/i)
        const many = Array.from({ length: m.DEFAULT_LIMITS.maxImages + 1 }, () => ({ type: "image", data: PNG }))
        expect(() => m.validateMessages([user(many)])).toThrow()
    })

    it("errors carry a reason for the client", () => {
        try {
            m.validateMessages([user([{ type: "video", data: PNG }])])
        } catch (e: any) {
            expect(e.reason).toBe("invalid-part")
        }
    })
})

describe("capabilities", () => {
    const check = (provider: string, stateful: boolean, model: string, msgs = mixed) =>
        m.assertSupported(m.validateMessages(msgs), m.capabilitiesFor({ provider, stateful, model }), `${provider}/${model}`)
    const imageOnly = [user([{ type: "image", data: PNG }, { type: "text", text: "x" }])]

    it("openai chat: images for vision models; audio only for audio models", () => {
        expect(() => check("openai", false, "gpt-4o-mini", imageOnly)).not.toThrow()
        expect(() => check("openai", false, "gpt-4o-mini")).toThrow(/audio/)
        expect(() => check("openai", false, "gpt-audio-1.5")).not.toThrow()
        expect(() => check("openai", false, "gpt-4o-audio-preview")).not.toThrow()
    })

    it("openai responses (stateful): images yes, audio refused (unconfirmed format)", () => {
        expect(() => check("openai", true, "gpt-5", imageOnly)).not.toThrow()
        expect(() => check("openai", true, "gpt-5")).toThrow(/audio/)
    })

    it("gemini generateContent: image and audio", () => {
        expect(() => check("gemini", false, "gemini-3.5-flash")).not.toThrow()
    })

    it("gemini interactions (stateful): images yes, audio refused (unconfirmed inline format)", () => {
        expect(() => check("gemini", true, "gemini-3.5-flash", imageOnly)).not.toThrow()
        expect(() => check("gemini", true, "gemini-3.5-flash")).toThrow(/audio/)
    })

    it("openai audio accepts only wav and mp3", () => {
        const flac = [user([{ type: "audio", data: "data:audio/flac;base64,AAAA" }])]
        expect(() => check("openai", false, "gpt-audio-1.5", flac)).toThrow(/flac/)
    })

    it("refusals are typed", () => {
        try {
            check("openai", false, "gpt-4o-mini")
        } catch (e: any) {
            expect(e.reason).toBe("unsupported-modality")
            expect(e.modality).toBe("audio")
        }
    })

    it("text-only is always supported", () => {
        expect(() => check("openai", true, "anything", [user("hi")])).not.toThrow()
    })
})

describe("mappers: text-only requests are unchanged", () => {
    const text = [{ role: "system", content: "be brief" }, user("hi"), { role: "assistant", content: "hello" }]

    it("openai chat and responses return the original messages", () => {
        expect(m.mapOpenAIChat(text)).toBe(text)
        expect(m.mapOpenAIResponses(text)).toBe(text)
    })

    it("gemini contents match the previous text-only output", () => {
        expect(m.mapGeminiContents(text)).toEqual([
            { role: "user", parts: [{ text: "hi" }] },
            { role: "model", parts: [{ text: "hello" }] },
        ])
    })

    it("gemini interactions input is the plain last user string", () => {
        expect(m.mapGeminiInteractionsInput(text)).toBe("hi")
    })
})

describe("mappers: media", () => {
    it("openai chat: image_url data URL and input_audio wav, order kept", () => {
        const out = m.mapOpenAIChat(mixed)
        expect(out[0].content).toEqual([
            { type: "text", text: "what is this?" },
            { type: "image_url", image_url: { url: PNG } },
            { type: "input_audio", input_audio: { data: "UklGRiQAAABXQVZF", format: "wav" } },
        ])
    })

    it("openai responses: input_text and input_image", () => {
        const out = m.mapOpenAIResponses([user([{ type: "text", text: "hi" }, { type: "image", data: PNG }])])
        expect(out[0].content).toEqual([
            { type: "input_text", text: "hi" },
            { type: "input_image", image_url: PNG },
        ])
    })

    it("gemini contents: text parts and inlineData", () => {
        const out = m.mapGeminiContents(mixed)
        expect(out[0]).toEqual({
            role: "user",
            parts: [
                { text: "what is this?" },
                { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } },
                { inlineData: { mimeType: "audio/wav", data: "UklGRiQAAABXQVZF" } },
            ],
        })
    })

    it("gemini interactions: array of typed blocks for the last user message only", () => {
        const history = [user("earlier"), { role: "assistant", content: "ok" }, user([{ type: "text", text: "now" }, { type: "image", data: PNG }])]
        expect(m.mapGeminiInteractionsInput(history)).toEqual([
            { type: "text", text: "now" },
            { type: "image", mime_type: "image/png", data: "iVBORw0KGgo=" },
        ])
    })
})

describe("recorder formats on the cloud route", () => {
    const WEBM = "data:audio/webm;base64,GkXfowEAAAAA"
    const msgs = [user([{ type: "text", text: "transcribe" }, { type: "audio", data: WEBM }])]
    const check = (provider: string, model = "m", stateful = false) =>
        m.assertSupported(m.validateMessages(msgs), m.capabilitiesFor({ provider, stateful, model }), `${provider}/${model}`)

    it("Gemini generateContent accepts webm as recorded", () => {
        expect(() => check("gemini")).not.toThrow()
    })

    it("OpenAI audio models still require wav or mp3", () => {
        expect(() => check("openai", "gpt-4o-audio-preview")).toThrow(/does not accept audio\/webm/)
    })

    it("a data URL that still carries codec parameters is rejected rather than guessed", () => {
        expect(() => m.validateMessages([user([{ type: "audio", data: "data:audio/webm;codecs=opus;base64,GkXfowEAAAAA" }])])).toThrow()
    })
})

describe("messages whose content is neither a string nor an array", () => {
    it("count as using parts, so they are validated instead of skipping validation", () => {
        expect(m.usesParts([{ role: "user", content: { type: "image", data: "x" } }])).toBe(true)
        expect(m.usesParts([{ role: "user", content: 5 }])).toBe(true)
        expect(m.usesParts([{ role: "user", content: "hello" }])).toBe(false)
        expect(m.usesParts([{ role: "user" }])).toBe(false)
    })

    it("are refused by validateMessages", () => {
        expect(() => m.validateMessages([{ role: "user", content: { type: "text", text: "hi" } }])).toThrow(/string or a non-empty array/)
    })
})

describe("OpenAI Responses mapping of text-only array content", () => {
    it("turns every text part into input_text, whether or not the request has media", () => {
        const out = m.mapOpenAIResponses([user([{ type: "text", text: "hello" }]), user("plain string")])
        expect(out[0].content).toEqual([{ type: "input_text", text: "hello" }])
        expect(out[1].content).toBe("plain string") // only plain strings pass through unchanged
    })

    it("maps the text-only messages of a mixed request too", () => {
        const out = m.mapOpenAIResponses([user([{ type: "text", text: "first" }]), user([{ type: "text", text: "see" }, { type: "image", data: PNG }])])
        expect(out[0].content).toEqual([{ type: "input_text", text: "first" }])
        expect(out[1].content[0]).toEqual({ type: "input_text", text: "see" })
        expect(out[1].content[1].type).toBe("input_image")
    })

    it("leaves a request with no array content exactly as it was", () => {
        const messages = [user("hi"), { role: "assistant", content: "yo" }]
        expect(m.mapOpenAIResponses(messages)).toBe(messages)
    })
})

describe("the combined media budget", () => {
    const pdf = (mib: number) => ({ type: "document", data: `data:application/pdf;base64,${"A".repeat(Math.ceil((mib * 1024 * 1024 * 4) / 3))}` })

    it("refuses two 10 MiB documents that would not fit under the 20 MB body limit", () => {
        expect(() => m.validateMessages([user([pdf(10), pdf(10)])])).toThrow(/in total/)
    })

    it("accepts media that fits, and what the budget allows always fits under the default parser limit", () => {
        expect(() => m.validateMessages([user([pdf(6), pdf(6)])])).not.toThrow()
        const budgetBase64 = Math.ceil((m.DEFAULT_LIMITS.totalBytes * 4) / 3)
        expect(budgetBase64).toBeLessThan(20 * 1024 * 1024)
    })
})

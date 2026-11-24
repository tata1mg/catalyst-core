// Spec for multimodal input (tracking issue #523, discussion #522). Written before the implementation:
// src/contentParts.js is the pure layer between useAI's `messages` and what each engine receives.
//
// Intent being pinned down:
//  1. Text-only calls behave exactly as today (nothing existing breaks).
//  2. A message's `content` may be a string OR an array of typed parts (text | image | audio).
//  3. An engine that cannot take a modality is a loud, typed error. Media is never silently dropped.
//  4. Media is size-capped before it crosses the bridge.
//  5. The native request body stays {prompt, genConfig} for text-only; media rides in genConfig.inputParts (core servers forward genConfig verbatim, so no core change and no silent drop on version skew).
const mod = import("../src/contentParts.js")

const PNG = "data:image/png;base64,iVBORw0KGgo="
const WAV = "data:audio/wav;base64,UklGRiQAAABXQVZF"

describe("normalizeMessages", () => {
    it("wraps string content in a single text part", async () => {
        const { normalizeMessages } = await mod
        expect(normalizeMessages([{ role: "user", content: "hi" }])).toEqual([
            { role: "user", parts: [{ type: "text", text: "hi" }] },
        ])
    })

    it("keeps typed parts in order", async () => {
        const { normalizeMessages } = await mod
        const out = normalizeMessages([
            { role: "user", content: [{ type: "image", data: PNG }, { type: "text", text: "what is this?" }] },
        ])
        expect(out[0].parts.map((p: any) => p.type)).toEqual(["image", "text"])
    })

    it("rejects an unknown part type", async () => {
        const { normalizeMessages } = await mod
        expect(() => normalizeMessages([{ role: "user", content: [{ type: "video", data: "x" }] }])).toThrow(/video/)
    })

    it("rejects media without data, and non-data-URL media", async () => {
        const { normalizeMessages } = await mod
        expect(() => normalizeMessages([{ role: "user", content: [{ type: "image" }] }])).toThrow()
        expect(() => normalizeMessages([{ role: "user", content: [{ type: "image", data: "http://x/y.png" }] }])).toThrow()
    })

    it("rejects empty content", async () => {
        const { normalizeMessages } = await mod
        expect(() => normalizeMessages([{ role: "user", content: [] }])).toThrow()
    })
})

describe("getModalities", () => {
    it("is text only for plain string messages", async () => {
        const { getModalities } = await mod
        expect([...getModalities([{ role: "user", content: "hi" }])]).toEqual(["text"])
    })

    it("collects image and audio across all messages", async () => {
        const { getModalities } = await mod
        const set = getModalities([
            { role: "user", content: [{ type: "image", data: PNG }] },
            { role: "user", content: [{ type: "audio", data: WAV }] },
        ])
        expect([...set].sort()).toEqual(["audio", "image"])
    })
})

describe("assertEngineSupports", () => {
    it("passes when every requested modality is supported", async () => {
        const { assertEngineSupports } = await mod
        expect(() => assertEngineSupports(new Set(["text", "image"]), { text: true, image: true })).not.toThrow()
    })

    it("throws a typed error naming the missing modality and the engine", async () => {
        const { assertEngineSupports } = await mod
        let err: any
        try {
            assertEngineSupports(new Set(["text", "audio"]), { text: true }, "web")
        } catch (e) {
            err = e
        }
        expect(err).toBeDefined()
        expect(err.reason).toBe("unsupported-modality")
        expect(err.modality).toBe("audio")
        expect(err.engine).toBe("web")
    })
})

describe("toLegacyPrompt", () => {
    it("matches today's `role: content` join exactly for text-only input", async () => {
        const { toLegacyPrompt } = await mod
        const prompt = toLegacyPrompt([
            { role: "system", content: "be brief" },
            { role: "user", content: "hi" },
        ])
        expect(prompt).toBe("system: be brief\nuser: hi")
    })

    it("joins text parts of an array-content message", async () => {
        const { toLegacyPrompt } = await mod
        expect(toLegacyPrompt([{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }])).toBe("user: a b")
    })

    it("refuses to flatten media into a prompt string", async () => {
        const { toLegacyPrompt } = await mod
        expect(() => toLegacyPrompt([{ role: "user", content: [{ type: "image", data: PNG }] }])).toThrow()
    })
})

describe("buildNativeBody", () => {
    it("text-only: body is unchanged ({prompt, genConfig}) so existing native builds keep working", async () => {
        const { buildNativeBody } = await mod
        const body = buildNativeBody([{ role: "user", content: "hi" }], { stream: true })
        expect(body).toEqual({ prompt: "user: hi", genConfig: { stream: true } })
        expect(body.genConfig).not.toHaveProperty("inputParts")
    })

    it("with media: genConfig.inputParts carries ordered media (mimeType + base64); text stays in prompt", async () => {
        const { buildNativeBody } = await mod
        const body = buildNativeBody(
            [{ role: "user", content: [{ type: "image", data: PNG }, { type: "text", text: "describe" }] }],
            {}
        )
        expect(body.genConfig.inputParts).toEqual([{ type: "image", mimeType: "image/png", base64: "iVBORw0KGgo=" }])
        expect(body.prompt).toBe("user: describe")
        expect(body).not.toHaveProperty("parts")
    })

    it("carries conversationId when given (stateful sessions)", async () => {
        const { buildNativeBody } = await mod
        expect(buildNativeBody([{ role: "user", content: "hi" }], {}, { conversationId: "c1" }).conversationId).toBe("c1")
    })
})

describe("size limits", () => {
    it("rejects an image over the cap before it is sent", async () => {
        const { normalizeMessages, DEFAULT_LIMITS } = await mod
        const big = "data:image/png;base64," + "A".repeat(Math.ceil((DEFAULT_LIMITS.imageBytes * 4) / 3) + 8)
        expect(() => normalizeMessages([{ role: "user", content: [{ type: "image", data: big }] }])).toThrow(/too large|limit/i)
    })

    it("caps the number of images per request", async () => {
        const { normalizeMessages, DEFAULT_LIMITS } = await mod
        const parts = Array.from({ length: DEFAULT_LIMITS.maxImages + 1 }, () => ({ type: "image", data: PNG }))
        expect(() => normalizeMessages([{ role: "user", content: parts }])).toThrow()
    })
})

// ---- Layers still to specify as implementation reaches them (each becomes real tests, not prose) ----
describe("scope not yet implemented", () => {
    // Native: decode `parts` -> temp files -> Content.ImageFile/AudioFile; set vision/audio backends only when asked.
    it.todo("android: NativeBridgeAI maps parts to Content.ImageFile/AudioFile and enables vision/audio backends (device spike 0.2)")
    it.todo("ios: AIRequest parses `parts`; EngineConfig sets visionBackend/audioBackend; missing backend is a clear error, not `null` (spike 0.1)")
    it.todo("native: temp media files are deleted after the turn, including on cancel/error")
    // useAI flow (verified in examples/useai AITest on a real device).
    it.todo("useNativeAI.generate sends buildNativeBody and surfaces unsupported-modality as a typed AI error")
    it.todo("useAI auto routing never sends image/audio to cloud when privacy is 'sensitive' (ask/deny, no silent fallback)")
    it.todo("useCloudAI route.js forwards image/audio parts only to providers that accept them")
    it.todo("useWebAI declares text-only until the Transformers.js multimodal spike (0.3) passes")
})

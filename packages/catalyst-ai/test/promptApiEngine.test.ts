// @vitest-environment jsdom
// The Chrome Prompt API engine against a fake `LanguageModel`: the worker-protocol messages it emits, delta handling,
// download progress, cancel, and the errors a page would otherwise see as opaque DOMExceptions.
import { createDeltaReader, createPromptApiEngine, getPromptApiAvailability, isMobileBrowser, toPromptApiInput } from "../src/promptApiEngine.js"

type Msg = { type: string; [k: string]: any }

function fakeApi({ availability = "available", chunks = ["Hel", "lo"], createError = null as any, progress = [] as number[] } = {}) {
    const created: any[] = []
    const api = {
        availability: vi.fn(async () => availability),
        create: vi.fn(async (opts: any) => {
            created.push(opts)
            if (createError) throw createError
            const monitor = { addEventListener: (_: string, cb: (e: any) => void) => progress.forEach((loaded) => cb({ loaded })) }
            opts.monitor?.(monitor)
            const session = {
                destroyed: false,
                destroy() { this.destroyed = true },
                promptStreaming: vi.fn(async () => new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close() } })),
            }
            created.push(session)
            return session
        }),
    }
    return { api, created }
}

function run(api: any, messages: any[]) {
    const engine = createPromptApiEngine({ api, now: (() => { let t = 0; return () => (t += 100) })() })
    const seen: Msg[] = []
    const finished = new Promise<void>((resolve) => {
        engine.onmessage = ({ data }: { data: Msg }) => { seen.push(data); if (data.type === "done" || data.type === "error") resolve() }
    })
    engine.postMessage({ type: "configure", policy: {}, online: true }) // ignored, as for any non-Transformers worker
    engine.postMessage({ type: "generate", messages, genConfig: {} })
    return { engine, seen, finished }
}

const user = (content: any) => ({ role: "user", content })
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const AUDIO = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA="

describe("getPromptApiAvailability", () => {
    it("is unavailable without the API, on an old Chrome, on an unknown state or on error", async () => {
        expect(await getPromptApiAvailability(undefined)).toBe("unavailable")
        expect(await getPromptApiAvailability({} as any)).toBe("unavailable")
        expect(await getPromptApiAvailability({ availability: async () => "maybe" } as any)).toBe("unavailable")
        expect(await getPromptApiAvailability({ availability: async () => { throw new Error("x") } } as any)).toBe("unavailable")
    })
    it("passes the four real states through", async () => {
        for (const s of ["unavailable", "downloadable", "downloading", "available"]) {
            expect(await getPromptApiAvailability({ availability: async () => s } as any)).toBe(s)
        }
    })
})

describe("toPromptApiInput", () => {
    it("lifts system text and earlier turns into initialPrompts and the last user turn into the prompt", () => {
        expect(toPromptApiInput([
            { role: "system", content: "Be brief." },
            user("hi"),
            { role: "assistant", content: "hello" },
            user([{ type: "text", text: "and now?" }]),
        ])).toEqual({
            initialPrompts: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
            prompt: "and now?",
            image: false,
            audio: false,
        })
    })
    it("refuses a conversation that does not end on a user turn", () => {
        expect(() => toPromptApiInput([user("hi"), { role: "assistant", content: "hello" }])).toThrow(/last message/)
    })
})

describe("createDeltaReader", () => {
    it("passes increments through", () => {
        const read = createDeltaReader()
        expect(["Hel", "lo", " world"].map(read)).toEqual(["Hel", "lo", " world"])
    })
    it("turns cumulative snapshots into increments", () => {
        const read = createDeltaReader()
        expect(["Hel", "Hello", "Hello world"].map(read)).toEqual(["Hel", "lo", " world"])
    })
})

describe("createPromptApiEngine", () => {
    it("reports an empty reply as an error instead of finishing with no text", async () => {
        const { api } = fakeApi({ chunks: [""] })
        const { seen, finished } = run(api, [user("hi")])
        await finished
        expect(seen.find((m) => m.type === "error")?.message).toMatch(/empty reply/)
        expect(seen.some((m) => m.type === "done")).toBe(false)
    })

    it("emits the worker protocol in order, with deltas and a done summary", async () => {
        const { api } = fakeApi({ chunks: ["Hel", "lo"] })
        const { seen, finished } = run(api, [{ role: "system", content: "Be brief." }, user("hi")])
        await finished
        expect(seen.map((m) => m.type)).toEqual(["log", "log", "log", "model_ready", "streaming_start", "ttft", "token", "token", "log", "done"])
        expect(seen.filter((m) => m.type === "token").map((m) => m.text).join("")).toBe("Hello")
        expect(seen.find((m) => m.type === "model_ready")).toMatchObject({ device: "chrome-built-in" })
        expect(seen.find((m) => m.type === "done")).toMatchObject({ totalTokens: 1 })
    })

    it("seeds the session with the conversation and destroys it afterwards", async () => {
        const { api, created } = fakeApi()
        const { finished } = run(api, [{ role: "system", content: "S" }, user("a"), { role: "assistant", content: "b" }, user("c")])
        await finished
        expect(created[0].initialPrompts).toEqual([{ role: "system", content: "S" }, { role: "user", content: "a" }, { role: "assistant", content: "b" }])
        expect(created[1].promptStreaming).toHaveBeenCalledWith("c", expect.anything())
        expect(created[1].destroyed).toBe(true)
    })

    it("reports download progress while Chrome fetches the model", async () => {
        const { api } = fakeApi({ availability: "downloadable", progress: [0.25, 1] })
        const { seen, finished } = run(api, [user("hi")])
        await finished
        expect(seen.filter((m) => m.type === "progress").map((m) => m.percent)).toEqual([25, 100])
    })

    it("explains the user-gesture requirement instead of surfacing NotAllowedError", async () => {
        const err = Object.assign(new Error("denied"), { name: "NotAllowedError" })
        const { api } = fakeApi({ availability: "downloadable", createError: err })
        const { seen, finished } = run(api, [user("hi")])
        await finished
        expect(seen.at(-1)).toMatchObject({ type: "error" })
        expect(seen.at(-1)!.message).toMatch(/click or tap/)
    })

    it("errors cleanly when unavailable or without the API", async () => {
        for (const [api, msgs, pattern] of [
            [fakeApi({ availability: "unavailable" }).api, [user("hi")], /unavailable on this device.*22 GB/],
            [undefined, [user("hi")], /not available in this browser/],
            [fakeApi({ availability: "unavailable" }).api, [user([{ type: "audio", data: AUDIO }])], /unavailable.*for audio input.*needs a GPU/],
        ] as const) {
            const { seen, finished } = run(api as any, msgs as any)
            await finished
            expect(seen.at(-1)).toMatchObject({ type: "error" })
            expect(seen.at(-1)!.message).toMatch(pattern)
        }
    })

    it("terminate() stops everything: no more messages and the session is destroyed", async () => {
        const { api, created } = fakeApi({ chunks: ["a", "b", "c"] })
        const { engine, seen } = run(api, [user("hi")])
        engine.terminate()
        await new Promise((r) => setTimeout(r, 20))
        expect(seen.some((m) => m.type === "done")).toBe(false)
        expect(created[1]?.destroyed ?? true).toBe(true)
    })
})

describe("image and audio input, structured replies", () => {
    it("asks availability() and create() with the same options, declaring only the modalities used", async () => {
        const { api, created } = fakeApi()
        const { finished } = run(api, [user([{ type: "text", text: "what is this?" }, { type: "image", data: PNG }])])
        await finished
        const asked = api.availability.mock.calls[0][0]
        expect(asked).toEqual({
            expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }],
            expectedOutputs: [{ type: "text", languages: ["en"] }],
        })
        expect(created[0]).toMatchObject(asked)
    })

    it("text-only requests declare no media, so a device without multimodal support is not asked for it", async () => {
        const { api } = fakeApi()
        const { finished } = run(api, [user("hi")])
        await finished
        expect(api.availability.mock.calls[0][0].expectedInputs).toEqual([{ type: "text", languages: ["en"] }])
    })

    it("sends the last user message as { type, value: Blob } parts", async () => {
        const { api, created } = fakeApi()
        const { finished } = run(api, [user([{ type: "audio", data: AUDIO }, { type: "text", text: "transcribe" }])])
        await finished
        const [prompt] = created[1].promptStreaming.mock.calls[0]
        expect(prompt).toHaveLength(1)
        expect(prompt[0].role).toBe("user")
        const [text, audio] = prompt[0].content
        expect(text).toEqual({ type: "text", value: "transcribe" })
        expect(audio.type).toBe("audio")
        expect(audio.value).toBeInstanceOf(Blob)
        expect(audio.value.type).toBe("audio/wav")
        expect(audio.value.size).toBe(44)
    })

    it("refuses media in an earlier turn, which Chrome would not keep in the session seed", () => {
        expect(() => toPromptApiInput([user([{ type: "image", data: PNG }]), { role: "assistant", content: "ok" }, user("and?")])).toThrow(/last message only/)
    })

    it("rejects a malformed media part with the same typed error as the other engines", () => {
        expect(() => toPromptApiInput([user([{ type: "image", data: "not a data url" }])])).toThrow(/base64 data URL/)
    })

    it("forwards responseConstraint to promptStreaming", async () => {
        const { api, created } = fakeApi()
        const schema = { type: "object", properties: { n: { type: "number" } }, required: ["n"] }
        const engine = createPromptApiEngine({ api })
        const done = new Promise<void>((resolve) => { engine.onmessage = ({ data }: any) => { if (data.type === "done" || data.type === "error") resolve() } })
        engine.postMessage({ type: "generate", messages: [user("give n")], genConfig: { responseConstraint: schema } })
        await done
        expect(created[1].promptStreaming).toHaveBeenCalledWith("give n", expect.objectContaining({ responseConstraint: schema }))
    })

    it("sends no responseConstraint when none is set", async () => {
        const { api, created } = fakeApi()
        const { finished } = run(api, [user("hi")])
        await finished
        expect(created[1].promptStreaming.mock.calls[0][1]).not.toHaveProperty("responseConstraint")
    })
})

describe("useWebAI with the Chrome engine", () => {
    it("lets an image through to the engine (it used to refuse media before the engine saw it)", async () => {
        const { renderHook, act } = await import("@testing-library/react")
        const { useWebAI } = await import("../src/useWebAI.js")
        const { api, created } = fakeApi({ chunks: ["a cat"] })
        vi.stubGlobal("LanguageModel", api)
        try {
            const { result } = renderHook(() => useWebAI({ engine: "prompt-api" }))
            await act(async () => { await result.current.generate({ messages: [user([{ type: "image", data: PNG }, { type: "text", text: "what is it?" }])] }) })
            expect(result.current.error).toBeNull()
            expect(result.current.output).toBe("a cat")
            const [prompt] = created[1].promptStreaming.mock.calls[0]
            expect(prompt[0].content.map((p: any) => p.type)).toEqual(["text", "image"])
            expect(prompt[0].content[1].value).toBeInstanceOf(Blob)
        } finally {
            vi.unstubAllGlobals()
        }
    })
})

describe("useWebAI with the Chrome engine and attachment components", () => {
    it("constrains the reply to a schema of the registered components and renders the blocks", async () => {
        const { renderHook, act } = await import("@testing-library/react")
        const { useWebAI } = await import("../src/useWebAI.js")
        const reply = JSON.stringify({ blocks: [{ component: "Header", text: "Antigravity" }, { component: "InfoCard", text: "A framework." }] })
        const { api, created } = fakeApi({ chunks: [reply.slice(0, 40), reply.slice(40)] })
        vi.stubGlobal("LanguageModel", api)
        try {
            const { result } = renderHook(() => useWebAI({ engine: "prompt-api", attachmentComponents: { Header: {}, InfoCard: {} } }))
            await act(async () => { await result.current.generate({ messages: [user("what is antigravity?")] }) })
            const [prompt, options] = created[1].promptStreaming.mock.calls[0]
            expect(options.responseConstraint.properties.blocks.items.properties.component.enum).toEqual(["Header", "InfoCard"])
            expect(prompt).toBe("what is antigravity?")
            const sentinels = result.current.output.match(/\x00SATTACH:[^\x00]*\x00/g)
            expect(sentinels).toHaveLength(2)
            expect(JSON.parse(sentinels![1].slice(9, -1))).toEqual({ component: "InfoCard", attrs: {}, body: "A framework." })
        } finally {
            vi.unstubAllGlobals()
        }
    })
})

describe("desktop only", () => {
    const phone = { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/156 Mobile Safari/537.36", platform: "Linux armv8l", maxTouchPoints: 5 }
    const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/156 Mobile/15E148", platform: "iPhone", maxTouchPoints: 5 }
    const ipad = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605", platform: "MacIntel", maxTouchPoints: 5 }
    const hinted = { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/156", platform: "Linux", maxTouchPoints: 0, userAgentData: { mobile: true } }
    const mac = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/156 Safari/537.36", platform: "MacIntel", maxTouchPoints: 0 }
    const windows = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156 Safari/537.36", platform: "Win32", maxTouchPoints: 10 }

    it("recognises phones, iPhone, iPadOS and the mobile client hint, and lets desktops through (touch laptops too)", () => {
        expect([phone, iphone, ipad, hinted].map((n) => isMobileBrowser(n as any))).toEqual([true, true, true, true])
        expect([mac, windows].map((n) => isMobileBrowser(n as any))).toEqual([false, false])
        expect(isMobileBrowser(undefined as any)).toBe(false)
    })

    it("reports unavailable on a phone even if the API object exists", async () => {
        const { api } = fakeApi()
        expect(await getPromptApiAvailability(api as any, undefined, phone as any)).toBe("unavailable")
        expect(api.availability).not.toHaveBeenCalled()
        expect(await getPromptApiAvailability(api as any, undefined, mac as any)).toBe("available")
    })

    it("the engine refuses on a phone before touching the API, and says why", async () => {
        const { api } = fakeApi()
        const engine = createPromptApiEngine({ api, nav: phone as any })
        const seen: Msg[] = []
        const finished = new Promise<void>((resolve) => { engine.onmessage = ({ data }: any) => { seen.push(data); if (data.type === "error") resolve() } })
        engine.postMessage({ type: "generate", messages: [user("hi")], genConfig: {} })
        await finished
        expect(seen.at(-1)!.message).toMatch(/desktop Chrome only, not on phones or tablets/)
        expect(api.availability).not.toHaveBeenCalled()
        expect(api.create).not.toHaveBeenCalled()
    })

    it("a desktop runs normally", async () => {
        const { api } = fakeApi()
        const engine = createPromptApiEngine({ api, nav: mac as any })
        const finished = new Promise<void>((resolve) => { engine.onmessage = ({ data }: any) => { if (data.type === "done") resolve() } })
        engine.postMessage({ type: "generate", messages: [user("hi")], genConfig: {} })
        await finished
        expect(api.create).toHaveBeenCalledTimes(1)
    })
})

// The Chrome Prompt API engine against a fake `LanguageModel`: the worker-protocol messages it emits, delta handling,
// download progress, cancel, and the errors a page would otherwise see as opaque DOMExceptions.
import { createDeltaReader, createPromptApiEngine, getPromptApiAvailability, toPromptApiInput } from "../src/promptApiEngine.js"

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
    it("emits the worker protocol in order, with deltas and a done summary", async () => {
        const { api } = fakeApi({ chunks: ["Hel", "lo"] })
        const { seen, finished } = run(api, [{ role: "system", content: "Be brief." }, user("hi")])
        await finished
        expect(seen.map((m) => m.type)).toEqual(["log", "model_ready", "streaming_start", "ttft", "token", "token", "done"])
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

    it("errors cleanly when unavailable, without the API, or when asked for media", async () => {
        for (const [api, msgs, pattern] of [
            [fakeApi({ availability: "unavailable" }).api, [user("hi")], /unavailable/],
            [undefined, [user("hi")], /not available in this browser/],
            [fakeApi().api, [user([{ type: "image", data: "data:image/png;base64,AA==" }, { type: "text", text: "?" }])], /text only/],
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

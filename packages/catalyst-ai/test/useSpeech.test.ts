import { requestSpeech } from "../src/useSpeech.js"

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe("requestSpeech", () => {
    afterEach(() => vi.unstubAllGlobals())

    it("posts to /{provider}/speech and adds a data: URL to the audio", async () => {
        const fetchMock = vi.fn().mockResolvedValue(ok({ audio: { mimeType: "audio/wav", data: "AAAA" }, usage: { characters: 2 }, model: "m" }))
        vi.stubGlobal("fetch", fetchMock)
        const out = await requestSpeech({ provider: "gemini", text: "hi", voice: "Puck" })
        expect(out.audio.url).toBe("data:audio/wav;base64,AAAA")
        expect(out.model).toBe("m")
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe("/ai/gemini/speech")
        expect(JSON.parse(init.body)).toEqual({ text: "hi", voice: "Puck" })
    })

    it("rejects empty text without calling the server", async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        await expect(requestSpeech({ text: "  " })).rejects.toThrow(/text/)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("surfaces the server's error, a status fallback for non-JSON bodies, and an empty-audio response", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "no speechModel" }), { status: 400 })))
        await expect(requestSpeech({ text: "a" })).rejects.toThrow("no speechModel")
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("<html>", { status: 502 })))
        await expect(requestSpeech({ text: "a" })).rejects.toThrow("Speech request failed (502)")
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({})))
        await expect(requestSpeech({ text: "a" })).rejects.toThrow(/no audio/)
    })
})

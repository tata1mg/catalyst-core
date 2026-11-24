import { requestImage } from "../src/useImageGen.js"

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe("requestImage", () => {
    afterEach(() => vi.unstubAllGlobals())

    it("posts to /{provider}/image and adds a data: URL to each image", async () => {
        const fetchMock = vi.fn().mockResolvedValue(ok({ images: [{ mimeType: "image/png", data: "AAAA" }], usage: { images: 1 }, model: "m" }))
        vi.stubGlobal("fetch", fetchMock)
        const out = await requestImage({ provider: "gemini", prompt: "a cat", size: "1024x1024" })
        expect(out.images[0].url).toBe("data:image/png;base64,AAAA")
        expect(out.model).toBe("m")
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe("/ai/gemini/image")
        expect(JSON.parse(init.body)).toEqual({ prompt: "a cat", size: "1024x1024" })
    })

    it("rejects an empty prompt without calling the server", async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
        await expect(requestImage({ prompt: "  " })).rejects.toThrow(/prompt/)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("surfaces the server's error message, and a status fallback for non-JSON bodies", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "no imageModel" }), { status: 400 })))
        await expect(requestImage({ prompt: "a" })).rejects.toThrow("no imageModel")
        vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("<html>", { status: 502 })))
        await expect(requestImage({ prompt: "a" })).rejects.toThrow("Image request failed (502)")
    })
})

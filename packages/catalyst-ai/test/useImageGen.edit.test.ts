import { requestImage, toImageInput } from "../src/useImageGen.js"

describe("requestImage with input images", () => {
    afterEach(() => vi.unstubAllGlobals())

    it("converts data URLs and keeps { mimeType, data } as-is", () => {
        expect(toImageInput("data:image/webp;base64,QUJD")).toEqual({ mimeType: "image/webp", data: "QUJD" })
        expect(toImageInput({ mimeType: "image/png", data: "QQ==", extra: 1 })).toEqual({ mimeType: "image/png", data: "QQ==" })
        expect(() => toImageInput("https://x/y.png")).toThrow(/data URLs/)
    })

    it("sends images in the body, keeps url data URLs in results and surfaces inputImages in usage", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ images: [{ mimeType: "image/png", data: "OUT" }], usage: { model: "m", images: 1, inputImages: 1, promptTokens: 0, completionTokens: 0 }, model: "m" }))
        )
        vi.stubGlobal("fetch", fetchMock)
        const r = await requestImage({ prompt: "edit", images: ["data:image/png;base64,QUJD"] })
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ prompt: "edit", images: [{ mimeType: "image/png", data: "QUJD" }] })
        expect(r.images[0].url).toBe("data:image/png;base64,OUT")
        expect(r.usage.inputImages).toBe(1)
        expect(r.cost).toBeNull()
    })

    it("omits images when none are given and rejects bad inputs before fetching", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ images: [] })))
        vi.stubGlobal("fetch", fetchMock)
        await requestImage({ prompt: "p" })
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ prompt: "p" })
        await expect(requestImage({ prompt: "p", images: ["nope"] })).rejects.toThrow(/data URLs/)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})

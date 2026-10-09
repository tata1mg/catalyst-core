// Large images (photos, GIFs) are shrunk in the browser before they cross the native bridge or reach the web worker.
// The model resizes internally anyway, so this loses nothing it would have used. Animated formats become their first
// frame. Decoding is injected so these tests need no browser.
const mod = import("../src/imagePrep.js")

const dataUrl = (mime: string, size: number) => `data:${mime};base64,${"A".repeat(size)}`

describe("fitWithin", () => {
    it("leaves images that already fit", async () => {
        const { fitWithin } = await mod
        expect(fitWithin(800, 600, 1536)).toEqual({ width: 800, height: 600, scaled: false })
    })

    it("scales the long side down and keeps the aspect ratio", async () => {
        const { fitWithin } = await mod
        expect(fitWithin(4000, 3000, 1500)).toEqual({ width: 1500, height: 1125, scaled: true })
        expect(fitWithin(1000, 4000, 2000)).toEqual({ width: 500, height: 2000, scaled: true })
    })

    it("never returns a zero side", async () => {
        const { fitWithin } = await mod
        const out = fitWithin(10000, 1, 100)
        expect(out.width).toBe(100)
        expect(out.height).toBe(1)
    })
})

describe("prepareImageParts", () => {
    const shrunk = "data:image/jpeg;base64,SMALL"

    it("replaces image parts with the resized data URL and leaves other parts alone", async () => {
        const { prepareImageParts } = await mod
        const text = { type: "text", text: "hi" }
        const audio = { type: "audio", data: "data:audio/wav;base64,AAAA" }
        const resize = vi.fn(async () => ({ data: shrunk, width: 100, height: 50, changed: true }))
        const out = await prepareImageParts(
            [{ role: "user", content: [{ type: "image", data: dataUrl("image/gif", 40) }, audio, text] }],
            { resize }
        )
        const parts = out[0].content as any[]
        expect(parts[0]).toEqual({ type: "image", data: shrunk })
        expect(parts[1]).toBe(audio)
        expect(parts[2]).toBe(text)
        expect(resize).toHaveBeenCalledTimes(1)
    })

    it("keeps the same part object when the resizer reports no change", async () => {
        const { prepareImageParts } = await mod
        const image = { type: "image", data: dataUrl("image/png", 40) }
        const out = await prepareImageParts([{ role: "user", content: [image] }], {
            resize: async () => ({ data: image.data, width: 10, height: 10, changed: false }),
        })
        expect((out[0].content as any[])[0]).toBe(image)
    })

    it("returns string-content messages untouched", async () => {
        const { prepareImageParts } = await mod
        const msgs = [{ role: "user", content: "hello" }]
        expect(await prepareImageParts(msgs, { resize: vi.fn() })).toEqual(msgs)
    })

    it("falls back to the original when decoding fails, and reports it", async () => {
        const { prepareImageParts } = await mod
        const image = { type: "image", data: dataUrl("image/heic", 40) }
        const onError = vi.fn()
        const out = await prepareImageParts([{ role: "user", content: [image] }], {
            resize: async () => {
                throw new Error("cannot decode")
            },
            onError,
        })
        expect((out[0].content as any[])[0]).toBe(image)
        expect(onError).toHaveBeenCalledTimes(1)
    })
})

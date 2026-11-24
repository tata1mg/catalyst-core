// @vitest-environment jsdom
// The browser resize path of prepareImageParts: decode with createImageBitmap, draw on a canvas, re-encode as JPEG.
// jsdom has none of those APIs, so each is stubbed; the point is the branching (skip / downscale / GIF first frame /
// OffscreenCanvas vs <canvas> / decode failure).
import { afterEach, describe, expect, it, vi } from "vitest"
import { prepareImageParts, MAX_IMAGE_SIDE, RECODE_ABOVE_BYTES } from "../src/imagePrep.js"

const DATA = "data:image/png;base64,AAAA"
const msg = (data: any = DATA) => [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image", data }] }]

function stub({ width = 100, height = 100, type = "image/png", size = 10, offscreen = true, toBlobFlavour = false } = {}) {
    const close = vi.fn()
    const drawImage = vi.fn()
    const fillRect = vi.fn()
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => ({ type, size }) })))
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width, height, close })))
    const ctx = { fillStyle: "", fillRect, drawImage }
    const encoded = new Blob(["jpegbytes"], { type: "image/jpeg" })
    if (offscreen) {
        class FakeOffscreen {
            constructor(public width: number, public height: number) {}
            getContext() { return ctx }
            convertToBlob = toBlobFlavour ? undefined : vi.fn(async () => encoded)
            toBlob = (cb: any) => cb(encoded)
        }
        vi.stubGlobal("OffscreenCanvas", FakeOffscreen)
    } else {
        vi.stubGlobal("OffscreenCanvas", undefined)
        const doc: any = (globalThis as any).document
        vi.spyOn(doc, "createElement").mockImplementation(((tag: string) => {
            if (tag !== "canvas") return doc.createElementNS("http://www.w3.org/1999/xhtml", tag)
            return { getContext: () => ctx, toBlob: (cb: any) => cb(encoded) } as any
        }) as any)
    }
    return { close, drawImage, fillRect, ctx }
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe("prepareImageParts (browser path)", () => {
    it("leaves a small, static image untouched but still closes the bitmap", async () => {
        const s = stub()
        const input = msg()
        const out = await prepareImageParts(input)
        expect(out[0].content[1]).toBe(input[0].content[1])
        expect(s.close).toHaveBeenCalledTimes(1)
        expect(s.drawImage).not.toHaveBeenCalled()
    })

    it("downscales an image larger than the cap and re-encodes it as JPEG", async () => {
        const s = stub({ width: MAX_IMAGE_SIDE * 2, height: MAX_IMAGE_SIDE })
        const out = await prepareImageParts(msg())
        const part = out[0].content[1]
        expect(part.data).toMatch(/^data:image\/jpeg;base64,/)
        expect(s.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, MAX_IMAGE_SIDE, MAX_IMAGE_SIDE / 2)
        expect(s.ctx.fillStyle).toBe("#fff")
    })

    it("re-encodes a GIF (first frame) and an over-size file even when the pixels fit", async () => {
        stub({ type: "image/gif" })
        expect((await prepareImageParts(msg()))[0].content[1].data).toMatch(/^data:image\/jpeg/)
        stub({ size: RECODE_ABOVE_BYTES + 1 })
        expect((await prepareImageParts(msg()))[0].content[1].data).toMatch(/^data:image\/jpeg/)
    })

    it("falls back to toBlob() when the canvas has no convertToBlob", async () => {
        stub({ width: MAX_IMAGE_SIDE + 1, toBlobFlavour: true })
        expect((await prepareImageParts(msg()))[0].content[1].data).toMatch(/^data:image\/jpeg/)
    })

    it("uses a DOM <canvas> where OffscreenCanvas does not exist", async () => {
        stub({ width: MAX_IMAGE_SIDE + 1, offscreen: false })
        expect((await prepareImageParts(msg()))[0].content[1].data).toMatch(/^data:image\/jpeg/)
    })

    it("reports a decode failure and sends the original image unchanged", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => ({ type: "image/png", size: 1 }) })))
        vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("cannot decode") }))
        const onError = vi.fn()
        const input = msg()
        const out = await prepareImageParts(input, { onError })
        expect(out[0].content[1]).toBe(input[0].content[1])
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "cannot decode" }))
    })

    it("passes through text-only messages and image parts without string data", async () => {
        const input = [{ role: "user", content: "plain" }, { role: "user", content: [{ type: "image", data: 5 }] }]
        const out = await prepareImageParts(input as any)
        expect(out[0]).toBe(input[0])
        expect((out[1] as any).content[0]).toBe((input[1] as any).content[0])
    })
})

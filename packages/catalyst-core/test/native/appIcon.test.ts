import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"

import { checkAppIcon, readPngInfo } from "../../src/native/appIcon.js"

const temps: string[] = []
afterEach(() => {
    for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function chunk(type: string, data: Buffer = Buffer.alloc(0)) {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    // The reader never checks CRCs, so a zero CRC keeps the fixture simple.
    return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)])
}

/** A structurally valid PNG header: signature, IHDR, optional chunks, IDAT, IEND. */
function png(width: number, height: number, colorType: number, extra: Buffer[] = []) {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8
    ihdr[9] = colorType
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        ...extra,
        chunk("IDAT", Buffer.from([0, 1, 2, 3])),
        chunk("IEND"),
    ])
}

function iconFile(buffer: Buffer) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-app-icon-"))
    temps.push(dir)
    const file = path.join(dir, "icon.png")
    fs.writeFileSync(file, buffer)
    return file
}

function thrown(fn: () => unknown): any {
    try {
        fn()
    } catch (error) {
        return error
    }
    throw new Error("expected a throw")
}

describe("readPngInfo", () => {
    it("reads size and colour type from IHDR", () => {
        expect(readPngInfo(png(1024, 1024, 2))).toEqual({
            width: 1024,
            height: 1024,
            bitDepth: 8,
            colorType: 2,
            hasAlpha: false,
        })
    })

    it("reports alpha for grey+alpha, RGBA and a tRNS chunk", () => {
        expect(readPngInfo(png(1024, 1024, 4))?.hasAlpha).toBe(true)
        expect(readPngInfo(png(1024, 1024, 6))?.hasAlpha).toBe(true)
        expect(
            readPngInfo(png(1024, 1024, 3, [chunk("PLTE", Buffer.alloc(6)), chunk("tRNS", Buffer.from([0]))]))
                ?.hasAlpha
        ).toBe(true)
    })

    it("ignores a tRNS-looking chunk after the image data", () => {
        const buffer = png(1024, 1024, 2)
        const late = Buffer.concat([
            buffer.subarray(0, buffer.length - 12),
            chunk("tRNS", Buffer.from([0])),
            chunk("IEND"),
        ])
        expect(readPngInfo(late)?.hasAlpha).toBe(false)
    })

    it("returns null for anything that is not a PNG", () => {
        expect(readPngInfo(Buffer.from("not a png at all, just some text bytes"))).toBeNull()
        expect(readPngInfo(Buffer.alloc(0))).toBeNull()
    })
})

describe("checkAppIcon", () => {
    it("accepts a square opaque icon of 1024 or more", () => {
        expect(checkAppIcon(iconFile(png(2048, 2048, 2)), { platform: "ios", release: true }).width).toBe(
            2048
        )
    })

    it("fails a non-square or small icon with the platform's code", () => {
        expect(thrown(() => checkAppIcon(iconFile(png(1024, 512, 2)), { platform: "android" })).code).toBe(
            "ANDROID-010"
        )
        const small = thrown(() => checkAppIcon(iconFile(png(512, 512, 2)), { platform: "ios" }))
        expect(small.code).toBe("IOS-005")
        expect(small.message).toContain("at least 1024x1024")
        expect(
            thrown(() => checkAppIcon(iconFile(Buffer.from("GIF89a....")), { platform: "ios" })).code
        ).toBe("IOS-005")
    })

    it("warns about alpha in debug and on Android release", () => {
        const logs: Array<[string, string?]> = []
        const log = (message: string, type?: string) => logs.push([message, type])
        checkAppIcon(iconFile(png(1024, 1024, 6)), { platform: "ios", log })
        checkAppIcon(iconFile(png(1024, 1024, 6)), { platform: "android", release: true, log })
        expect(logs).toHaveLength(2)
        expect(logs.every(([, type]) => type === "warning")).toBe(true)
    })

    it("fails alpha for an iOS release", () => {
        const error = thrown(() =>
            checkAppIcon(iconFile(png(1024, 1024, 6)), { platform: "ios", release: true })
        )
        expect(error.code).toBe("IOS-006")
        expect(error.docUrl).toMatch(/errors\/IOS\/IOS-006\.md$/)
    })
})

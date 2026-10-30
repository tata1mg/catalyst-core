import zlib from "zlib"
import { describe, expect, it } from "vitest"

// The repo script that checks a built AAB/APK for 16 KB page alignment (#302).
import {
    checkNativeAlignment,
    elfLoadAlignments,
    zipEntries,
} from "../../../../scripts/native-elf-alignment.mjs"

const PT_LOAD = 1
const PT_DYNAMIC = 2

/** A tiny ELF file: just the header and program headers of the given types and alignments. */
function elf(bits: 32 | 64, segments: Array<[type: number, align: number]>) {
    const ehsize = bits === 64 ? 64 : 52
    const phentsize = bits === 64 ? 56 : 32
    const buf = Buffer.alloc(ehsize + phentsize * segments.length)
    buf.writeUInt32BE(0x7f454c46, 0)
    buf[4] = bits === 64 ? 2 : 1
    buf[5] = 1 // little-endian
    buf[6] = 1
    if (bits === 64) {
        buf.writeBigUInt64LE(BigInt(ehsize), 0x20)
        buf.writeUInt16LE(phentsize, 0x36)
        buf.writeUInt16LE(segments.length, 0x38)
    } else {
        buf.writeUInt32LE(ehsize, 0x1c)
        buf.writeUInt16LE(phentsize, 0x2a)
        buf.writeUInt16LE(segments.length, 0x2c)
    }
    segments.forEach(([type, align], i) => {
        const at = ehsize + i * phentsize
        buf.writeUInt32LE(type, at)
        if (bits === 64) buf.writeBigUInt64LE(BigInt(align), at + 48)
        else buf.writeUInt32LE(align, at + 28)
    })
    return buf
}

/** A minimal zip. `stored` entries are written uncompressed, padded so their data starts at `alignTo`. */
function zip(files: Array<{ name: string; data: Buffer; stored?: boolean; alignTo?: number }>) {
    const parts: Buffer[] = []
    const central: Buffer[] = []
    let offset = 0
    for (const file of files) {
        const name = Buffer.from(file.name)
        const body = file.stored ? file.data : zlib.deflateRawSync(file.data)
        const headerEnd = offset + 30 + name.length
        const pad = file.alignTo ? (file.alignTo - (headerEnd % file.alignTo)) % file.alignTo : 0
        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0)
        local.writeUInt16LE(file.stored ? 0 : 8, 8)
        local.writeUInt32LE(body.length, 18)
        local.writeUInt32LE(file.data.length, 22)
        local.writeUInt16LE(name.length, 26)
        local.writeUInt16LE(pad, 28)
        const entry = Buffer.alloc(46)
        entry.writeUInt32LE(0x02014b50, 0)
        entry.writeUInt16LE(file.stored ? 0 : 8, 10)
        entry.writeUInt32LE(body.length, 20)
        entry.writeUInt32LE(file.data.length, 24)
        entry.writeUInt16LE(name.length, 28)
        entry.writeUInt32LE(offset, 42)
        central.push(entry, name)
        parts.push(local, name, Buffer.alloc(pad), body)
        offset += 30 + name.length + pad + body.length
    }
    const cd = Buffer.concat(central)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(files.length, 8)
    end.writeUInt16LE(files.length, 10)
    end.writeUInt32LE(cd.length, 12)
    end.writeUInt32LE(offset, 16)
    return Buffer.concat([...parts, cd, end])
}

const aligned64 = elf(64, [
    [PT_LOAD, 0x4000],
    [PT_DYNAMIC, 8],
    [PT_LOAD, 0x4000],
])
const unaligned64 = elf(64, [
    [PT_LOAD, 0x4000],
    [PT_LOAD, 0x1000],
])
const unaligned32 = elf(32, [[PT_LOAD, 0x1000]])

describe("ELF LOAD alignment", () => {
    it("reads p_align of LOAD segments only, for 64- and 32-bit ELF", () => {
        expect(elfLoadAlignments(aligned64)).toEqual({ bits: 64, aligns: [0x4000, 0x4000] })
        expect(elfLoadAlignments(unaligned32)).toEqual({ bits: 32, aligns: [0x1000] })
        expect(() => elfLoadAlignments(Buffer.from("not an elf file, just some text here......................"))).toThrow(
            /not an ELF/
        )
    })

    it("reads stored and deflated zip entries", () => {
        const entries = zipEntries(
            zip([
                { name: "a.txt", data: Buffer.from("hello") },
                { name: "b.bin", data: Buffer.from("world"), stored: true },
            ])
        )
        expect(entries.map((entry) => [entry.name, entry.method, entry.read().toString()])).toEqual([
            ["a.txt", 8, "hello"],
            ["b.bin", 0, "world"],
        ])
    })
})

describe("checkNativeAlignment", () => {
    it("passes an AAB whose 64-bit libs are 16 KB aligned, reporting but not failing 4 KB 32-bit libs", () => {
        const aab = zip([
            { name: "base/lib/arm64-v8a/libgood.so", data: aligned64 },
            { name: "base/lib/armeabi-v7a/libold.so", data: unaligned32 },
            { name: "base/assets/notalib.so.txt", data: Buffer.from("x") },
        ])
        const result = checkNativeAlignment(aab)
        expect(result.failures).toEqual([])
        expect(result.libs.map((lib) => [lib.name, lib.ok, lib.required])).toEqual([
            ["base/lib/arm64-v8a/libgood.so", true, true],
            ["base/lib/armeabi-v7a/libold.so", false, false],
        ])
    })

    it("fails a 64-bit lib with any LOAD segment below 0x4000", () => {
        const result = checkNativeAlignment(
            zip([{ name: "base/lib/x86_64/libimage_processing_util_jni.so", data: unaligned64 }])
        )
        expect(result.failures).toEqual([
            "base/lib/x86_64/libimage_processing_util_jni.so: LOAD segment aligned to 0x1000 (needs 0x4000)",
        ])
    })

    it("in an APK, fails an uncompressed 64-bit lib that is not on a 16 KB zip boundary", () => {
        const misplaced = zip([{ name: "lib/arm64-v8a/libgood.so", data: aligned64, stored: true, alignTo: 4096 }])
        const placed = zip([{ name: "lib/arm64-v8a/libgood.so", data: aligned64, stored: true, alignTo: 0x4000 }])
        expect(zipEntries(misplaced)[0].dataOffset).toBe(4096)
        expect(checkNativeAlignment(misplaced, { apk: true }).failures).toEqual([
            "lib/arm64-v8a/libgood.so: stored uncompressed at zip offset 4096, not on a 16 KB boundary",
        ])
        expect(checkNativeAlignment(placed, { apk: true }).failures).toEqual([])
        // An AAB is aligned by bundletool later, so its zip offsets are not checked.
        expect(checkNativeAlignment(misplaced).failures).toEqual([])
    })
})

// 16 KB page size check for the native libraries in an Android App Bundle or
// APK (#302). Google Play requires every 64-bit shared library (arm64-v8a,
// x86_64) of an app targeting Android 15+ to have its ELF LOAD segments
// aligned to at least 16 KB (p_align >= 0x4000, "2**14"):
// https://developer.android.com/guide/practices/page-sizes
// 32-bit libraries (armeabi-v7a, x86) are not covered by the requirement, so
// they are reported but do not fail the check. In an APK, an uncompressed
// 64-bit library must also start on a 16 KB boundary inside the zip.
//
// Plain Node: the zip and ELF headers are read here, no dependency.

import fs from "node:fs"
import zlib from "node:zlib"

const PAGE_16K = 0x4000
const PT_LOAD = 1

/**
 * The entries of a zip file (AAB and APK are zips). ZIP64 is not read:
 * bundles over 4 GB are out of scope.
 *
 * @param {Buffer} buf
 * @returns {{ name: string, method: number, dataOffset: number, read: () => Buffer }[]}
 */
function zipEntries(buf) {
    const EOCD = 0x06054b50
    let eocd = -1
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
        if (buf.readUInt32LE(i) === EOCD) {
            eocd = i
            break
        }
    }
    if (eocd === -1) throw new Error("not a zip file (no end of central directory)")
    const count = buf.readUInt16LE(eocd + 10)
    let offset = buf.readUInt32LE(eocd + 16)
    if (offset === 0xffffffff) throw new Error("ZIP64 archives are not supported")

    const entries = []
    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error("corrupt zip central directory")
        const method = buf.readUInt16LE(offset + 10)
        const compressedSize = buf.readUInt32LE(offset + 20)
        const nameLength = buf.readUInt16LE(offset + 28)
        const extraLength = buf.readUInt16LE(offset + 30)
        const commentLength = buf.readUInt16LE(offset + 32)
        const localOffset = buf.readUInt32LE(offset + 42)
        const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength)
        offset += 46 + nameLength + extraLength + commentLength

        if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`corrupt zip entry ${name}`)
        const dataOffset =
            localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28)
        const read = () => {
            const data = buf.subarray(dataOffset, dataOffset + compressedSize)
            if (method === 0) return data
            if (method === 8) return zlib.inflateRawSync(data)
            throw new Error(`${name}: unsupported zip compression method ${method}`)
        }
        entries.push({ name, method, dataOffset, read })
    }
    return entries
}

/**
 * The p_align of every PT_LOAD segment of an ELF file.
 *
 * @param {Buffer} elf
 * @returns {{ bits: 32 | 64, aligns: number[] }}
 */
function elfLoadAlignments(elf) {
    if (elf.length < 52 || elf.readUInt32BE(0) !== 0x7f454c46) throw new Error("not an ELF file")
    const bits = elf[4] === 2 ? 64 : elf[4] === 1 ? 32 : null
    if (!bits) throw new Error(`unknown ELF class ${elf[4]}`)
    const le = elf[5] !== 2
    const u16 = (at) => (le ? elf.readUInt16LE(at) : elf.readUInt16BE(at))
    const u32 = (at) => (le ? elf.readUInt32LE(at) : elf.readUInt32BE(at))
    const u64 = (at) => Number(le ? elf.readBigUInt64LE(at) : elf.readBigUInt64BE(at))

    const phoff = bits === 64 ? u64(0x20) : u32(0x1c)
    const phentsize = u16(bits === 64 ? 0x36 : 0x2a)
    const phnum = u16(bits === 64 ? 0x38 : 0x2c)
    const aligns = []
    for (let i = 0; i < phnum; i++) {
        const header = phoff + i * phentsize
        if (header + phentsize > elf.length) throw new Error("truncated ELF program headers")
        if (u32(header) !== PT_LOAD) continue
        aligns.push(bits === 64 ? u64(header + 48) : u32(header + 28))
    }
    return { bits, aligns }
}

/**
 * Check every lib/<abi>/*.so in an AAB or APK.
 *
 * @param {string | Buffer} archive - a path, or the file's bytes
 * @param {{ apk?: boolean }} [options] - check zip alignment too; defaults to the path ending in .apk
 * @returns {{ libs: { name: string, bits: number, minAlign: number, required: boolean, ok: boolean, problem?: string }[], failures: string[] }}
 */
function checkNativeAlignment(archive, { apk } = {}) {
    const buf = typeof archive === "string" ? fs.readFileSync(archive) : archive
    const isApk = apk ?? (typeof archive === "string" && archive.endsWith(".apk"))
    const libs = []
    for (const entry of zipEntries(buf)) {
        if (!/(^|\/)lib\/[^/]+\/[^/]+\.so$/.test(entry.name)) continue
        const { bits, aligns } = elfLoadAlignments(entry.read())
        const minAlign = aligns.length ? Math.min(...aligns) : 0
        const required = bits === 64
        let problem
        if (minAlign < PAGE_16K) {
            problem = `LOAD segment aligned to 0x${minAlign.toString(16)} (needs 0x4000)`
        } else if (isApk && entry.method === 0 && entry.dataOffset % PAGE_16K !== 0) {
            problem = `stored uncompressed at zip offset ${entry.dataOffset}, not on a 16 KB boundary`
        }
        libs.push({ name: entry.name, bits, minAlign, required, ok: !problem, ...(problem ? { problem } : {}) })
    }
    const failures = libs.filter((lib) => lib.required && !lib.ok).map((lib) => `${lib.name}: ${lib.problem}`)
    return { libs, failures }
}

export { PAGE_16K, zipEntries, elfLoadAlignments, checkNativeAlignment }

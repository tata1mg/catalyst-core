import fs from "fs"
import path from "path"
import { nativeError } from "./utils.js"

// The single app icon both platforms build from: public/icon.png. App Store
// Connect wants a 1024x1024 marketing icon, so that is the floor.
const MIN_ICON_SIZE = 1024

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const ICON_ERROR_CODES = {
    android: { invalid: "ANDROID-010" },
    ios: { invalid: "IOS-005", alpha: "IOS-006" },
}

/**
 * Width, height and colour type from a PNG's IHDR, and whether it carries
 * alpha: colour type 4 (grey + alpha) or 6 (RGBA), or a tRNS chunk (which
 * must come before the image data). Null when the bytes are not a PNG.
 *
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number, bitDepth: number, colorType: number, hasAlpha: boolean } | null}
 */
function readPngInfo(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 33) return null
    if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null
    if (buffer.toString("ascii", 12, 16) !== "IHDR") return null
    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)
    const bitDepth = buffer[24]
    const colorType = buffer[25]

    let hasTransparencyChunk = false
    let offset = 8
    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset)
        const type = buffer.toString("ascii", offset + 4, offset + 8)
        if (type === "tRNS") {
            hasTransparencyChunk = true
            break
        }
        if (type === "IDAT" || type === "IEND") break
        offset += 12 + length
    }

    return {
        width,
        height,
        bitDepth,
        colorType,
        hasAlpha: colorType === 4 || colorType === 6 || hasTransparencyChunk,
    }
}

/**
 * Check public/icon.png before it becomes the app icon. Not a PNG, not square
 * or under 1024px is a coded error. Alpha is a warning, except for an iOS
 * release, where App Store Connect would reject it (ITMS-90717).
 *
 * @param {string} file
 * @param {object} options
 * @param {"android"|"ios"} options.platform
 * @param {boolean} [options.release]
 * @param {(message: string, type?: string) => void} [options.log]
 */
function checkAppIcon(file, { platform, release = false, log = () => {} }) {
    const codes = ICON_ERROR_CODES[platform]
    if (!codes) throw new Error(`No app icon error codes for platform "${platform}"`)
    const info = readPngInfo(fs.readFileSync(file))
    // public/icon.png, not the absolute path, in what the user reads.
    const relative = path.relative(process.cwd(), file)
    const name = relative && !relative.startsWith("..") ? relative : file
    if (!info) throw nativeError(codes.invalid, `${name} is not a PNG file`)
    if (info.width !== info.height) {
        throw nativeError(codes.invalid, `${name} is ${info.width}x${info.height}; it must be square`)
    }
    if (info.width < MIN_ICON_SIZE) {
        throw nativeError(
            codes.invalid,
            `${name} is ${info.width}x${info.height}; it must be at least ${MIN_ICON_SIZE}x${MIN_ICON_SIZE}`
        )
    }
    if (info.hasAlpha) {
        if (platform === "ios" && release) {
            throw nativeError(codes.alpha, `${name} has an alpha channel`)
        }
        log(
            `${name} has an alpha channel. The App Store rejects icons with transparency; flatten it before an iOS release.`,
            "warning"
        )
    }
    return info
}

export { MIN_ICON_SIZE, readPngInfo, checkAppIcon }

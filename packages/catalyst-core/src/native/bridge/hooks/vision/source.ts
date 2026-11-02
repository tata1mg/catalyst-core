// Turns whatever the app has in hand into the data URL an image content part needs.

export interface PhotoLike {
    fileSrc: string
    mimeType?: string
}

export type ImageSource = string | Blob | PhotoLike

export class VisionSourceError extends Error {
    code = "VISION_SOURCE"
}

const isPhotoLike = (source: unknown): source is PhotoLike =>
    !!source && typeof source === "object" && typeof (source as PhotoLike).fileSrc === "string"

function bytesToBase64(bytes: Uint8Array): string {
    let binary = ""
    const chunk = 0x8000 // keep String.fromCharCode's argument list small for multi-megabyte photos
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    return btoa(binary)
}

async function blobToDataUrl(blob: Blob, fallbackMime?: string): Promise<string> {
    const mime = blob.type || fallbackMime || ""
    if (!mime.startsWith("image/")) throw new VisionSourceError(`Expected an image, got "${mime || "unknown type"}"`)
    return `data:${mime};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`
}

/**
 * Accepts a data: URL, a blob:/http(s) URL (including the iOS framework server's https://localhost file URLs),
 * a File/Blob, or a captured photo ({ fileSrc, mimeType }). Rejects anything that is not an image.
 */
export async function toImageDataUrl(source: ImageSource): Promise<string> {
    if (typeof Blob !== "undefined" && source instanceof Blob) return blobToDataUrl(source)
    const url = isPhotoLike(source) ? source.fileSrc : source
    const mime = isPhotoLike(source) ? source.mimeType : undefined
    if (typeof url !== "string" || !url) throw new VisionSourceError("No image was given")
    if (url.startsWith("data:")) {
        if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(url)) throw new VisionSourceError("The data URL is not a base64 image")
        return url
    }
    let response: Response
    try {
        response = await fetch(url)
    } catch (cause) {
        throw new VisionSourceError(`Could not read the image: ${(cause as Error).message}`)
    }
    if (!response.ok) throw new VisionSourceError(`Could not read the image (HTTP ${response.status})`)
    return blobToDataUrl(await response.blob(), mime)
}

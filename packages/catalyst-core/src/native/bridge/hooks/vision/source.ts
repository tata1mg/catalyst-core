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

// A photo bigger than this is refused before it is read: it would be turned into a binary string and a base64 copy first, and it is
// far past what any provider takes even after the provider-side resize.
export const MAX_SOURCE_BYTES = 32 * 1024 * 1024
// How long a remote image may take to arrive.
const FETCH_DEADLINE_MS = 30_000

async function blobToDataUrl(blob: Blob, fallbackMime?: string): Promise<string> {
    const mime = blob.type || fallbackMime || ""
    if (!mime.startsWith("image/")) throw new VisionSourceError(`Expected an image, got "${mime || "unknown type"}"`)
    if (blob.size > MAX_SOURCE_BYTES) throw new VisionSourceError(`The image is too large (${Math.round(blob.size / 1024 / 1024)} MB, the limit is ${MAX_SOURCE_BYTES / 1024 / 1024} MB)`)
    return `data:${mime};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`
}

/**
 * Accepts a data: URL, a blob:/http(s) URL (including the iOS framework server's https://localhost file URLs),
 * a File/Blob, or a captured photo ({ fileSrc, mimeType }). Rejects anything that is not an image.
 */
export async function toImageDataUrl(source: ImageSource, options: { signal?: AbortSignal } = {}): Promise<string> {
    if (typeof Blob !== "undefined" && source instanceof Blob) return blobToDataUrl(source)
    const url = isPhotoLike(source) ? source.fileSrc : source
    const mime = isPhotoLike(source) ? source.mimeType : undefined
    if (typeof url !== "string" || !url) throw new VisionSourceError("No image was given")
    if (url.startsWith("data:")) {
        if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(url)) throw new VisionSourceError("The data URL is not a base64 image")
        return url
    }
    // The caller's signal (a newer scan, clear(), unmount) and a deadline both stop the download, including a body that stalls part-way.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_DEADLINE_MS)
    const onCaller = () => controller.abort()
    if (options.signal) {
        if (options.signal.aborted) controller.abort()
        else options.signal.addEventListener("abort", onCaller, { once: true })
    }
    try {
        let response: Response
        try {
            response = await fetch(url, { signal: controller.signal })
        } catch (cause) {
            throw new VisionSourceError(controller.signal.aborted ? "Reading the image was cancelled or took too long" : `Could not read the image: ${(cause as Error).message}`)
        }
        if (!response.ok) throw new VisionSourceError(`Could not read the image (HTTP ${response.status})`)
        const declared = Number(response.headers?.get?.("content-length"))
        if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
            controller.abort()
            throw new VisionSourceError(`The image is too large (${Math.round(declared / 1024 / 1024)} MB, the limit is ${MAX_SOURCE_BYTES / 1024 / 1024} MB)`)
        }
        let blob: Blob
        try {
            blob = await response.blob()
        } catch (cause) {
            throw new VisionSourceError(controller.signal.aborted ? "Reading the image was cancelled or took too long" : `Could not read the image: ${(cause as Error).message}`)
        }
        return await blobToDataUrl(blob, mime)
    } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener("abort", onCaller)
    }
}

// Shrinks large images in the browser before they cross the native bridge or reach the web worker, so a 12 MP photo or
// a big GIF is not rejected by the size cap. The vision encoders resize internally, so little is lost. Animated formats
// (GIF) become their first frame as JPEG. If the browser cannot decode an image, the original is sent unchanged and the
// failure is reported through `onError`; the size cap in contentParts.js then still applies to the original.

export const MAX_IMAGE_SIDE = 1536
export const RECODE_ABOVE_BYTES = 1024 * 1024
const JPEG_QUALITY = 0.9

/** Largest size that fits maxSide on the long edge, keeping the aspect ratio. */
export function fitWithin(width, height, maxSide) {
    const longest = Math.max(width, height)
    if (longest <= maxSide) return { width, height, scaled: false }
    const ratio = maxSide / longest
    return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)), scaled: true }
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
    })
}

async function browserResize(dataUrl, { maxSide = MAX_IMAGE_SIDE, quality = JPEG_QUALITY } = {}) {
    const blob = await (await fetch(dataUrl)).blob()
    const bitmap = await createImageBitmap(blob) // first frame for animated images
    try {
        const { width, height, scaled } = fitWithin(bitmap.width, bitmap.height, maxSide)
        const animated = blob.type === "image/gif"
        if (!scaled && !animated && blob.size <= RECODE_ABOVE_BYTES) {
            return { data: dataUrl, width, height, changed: false }
        }
        const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height })
        const context = canvas.getContext("2d")
        context.fillStyle = "#fff" // JPEG has no alpha: transparent pixels would turn black
        context.fillRect(0, 0, width, height)
        context.drawImage(bitmap, 0, 0, width, height)
        const out = canvas.convertToBlob
            ? await canvas.convertToBlob({ type: "image/jpeg", quality })
            : await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
        return { data: await blobToDataUrl(out), width, height, changed: true }
    } finally {
        bitmap.close?.()
    }
}

/**
 * Returns messages with every image part resized when needed. Unchanged parts are returned as the same objects.
 * @param {any[]} messages
 * @param {{ resize?: (dataUrl: string) => Promise<{ data: string, width: number, height: number, changed: boolean }>, onError?: (error: Error) => void }} [options]
 */
export async function prepareImageParts(messages, { resize = browserResize, onError } = {}) {
    return Promise.all(
        messages.map(async (message) => {
            if (!Array.isArray(message.content)) return message
            const content = await Promise.all(
                message.content.map(async (part) => {
                    if (part?.type !== "image" || typeof part.data !== "string") return part
                    try {
                        const result = await resize(part.data)
                        return result.changed ? { ...part, data: result.data } : part
                    } catch (error) {
                        onError?.(error)
                        return part
                    }
                })
            )
            return { ...message, content }
        })
    )
}

import { useState, useRef, useCallback } from "react"
import { imageCost } from "./metrics.js"

const REQUEST_TIMEOUT_MS = 180_000

const DATA_URL = /^data:([^;,]+);base64,(.*)$/s

/** data URL string or { mimeType, data } -> { mimeType, data } (base64 without the data: prefix). Throws on anything else. */
export function toImageInput(img) {
    if (typeof img === "string") {
        const m = DATA_URL.exec(img)
        if (!m) throw new Error("images must be base64 data URLs or { mimeType, data }")
        return { mimeType: m[1], data: m[2] }
    }
    if (img && typeof img.mimeType === "string" && typeof img.data === "string") return { mimeType: img.mimeType, data: img.data }
    throw new Error("images must be base64 data URLs or { mimeType, data }")
}

/**
 * image.generate against the cloud route (POST {basePath}/{provider}/image). Pure, so pipelines can call it without React.
 * Resolves { images: [{ mimeType, data, url }], usage, model, cost, costPartial } where `url` is a data: URL ready for <img src>.
 * `cost` is USD from AI_CONFIG.pricing (perImage and/or token prices), or null when no price is set; never guessed.
 * Pass `images` (max 4, data URLs or { mimeType, data }) to edit/transform instead of generate; usage then carries `inputImages`.
 * Rejects with Error (message from the server's `error` field); aborts via `signal`.
 */
export async function requestImage({ basePath = "/ai", provider = "openai", prompt, n, size, model, images: inputImages, signal } = {}) {
    if (typeof prompt !== "string" || prompt.trim() === "") throw new Error("prompt must be a non-empty string")
    const inputs = inputImages && inputImages.length > 0 ? inputImages.map(toImageInput) : undefined
    const timeout = AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined
    const combined = signal && timeout && AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal || timeout
    const response = await fetch(`${basePath}/${provider}/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, ...(n && { n }), ...(size && { size }), ...(model && { model }), ...(inputs && { images: inputs }) }),
        signal: combined,
    })
    let data = null
    try {
        data = await response.json()
    } catch {
        // non-JSON error body: fall through to the status message below
    }
    if (!response.ok) throw new Error(data?.error || `Image request failed (${response.status})`)
    const images = (data?.images ?? []).map((img) => ({ ...img, url: `data:${img.mimeType};base64,${img.data}` }))
    const usage = data?.usage ?? null
    const { cost, partial } = imageCost(usage, data?.model ?? model)
    return { images, usage, model: data?.model ?? model ?? null, cost, costPartial: partial }
}

/** React wrapper: { generate, images, loading, error, usage, cancel, reset }. Cloud only for now (#611). */
export function useImageGen({ basePath = "/ai", provider = "openai", model, size, n } = {}) {
    const [state, setState] = useState({ images: [], loading: false, error: null, usage: null })
    const controllerRef = useRef(null)

    const cancel = useCallback(() => {
        controllerRef.current?.abort()
        controllerRef.current = null
    }, [])

    const reset = useCallback(() => {
        cancel()
        setState({ images: [], loading: false, error: null, usage: null })
    }, [cancel])

    const generate = useCallback(
        async (prompt, overrides = {}) => {
            controllerRef.current?.abort()
            const controller = new AbortController()
            controllerRef.current = controller
            setState((s) => ({ ...s, loading: true, error: null }))
            try {
                const result = await requestImage({ basePath, provider, model, size, n, ...overrides, prompt, signal: controller.signal })
                if (controllerRef.current === controller) setState({ images: result.images, loading: false, error: null, usage: result.usage })
                return { ...result, error: null }
            } catch (err) {
                if (controller.signal.aborted && controllerRef.current !== controller) return { images: [], usage: null, error: "cancelled" }
                const message = err?.message || String(err)
                if (controllerRef.current === controller) setState((s) => ({ ...s, loading: false, error: message }))
                return { images: [], usage: null, error: message }
            }
        },
        [basePath, provider, model, size, n]
    )

    return { ...state, generate, cancel, reset }
}

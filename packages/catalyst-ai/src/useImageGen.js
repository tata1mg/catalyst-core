import { useState, useRef, useCallback } from "react"

const REQUEST_TIMEOUT_MS = 180_000

/**
 * image.generate against the cloud route (POST {basePath}/{provider}/image). Pure, so pipelines can call it without React.
 * Resolves { images: [{ mimeType, data, url }], usage, model } where `url` is a data: URL ready for <img src>.
 * Rejects with Error (message from the server's `error` field); aborts via `signal`.
 */
export async function requestImage({ basePath = "/ai", provider = "openai", prompt, n, size, model, signal } = {}) {
    if (typeof prompt !== "string" || prompt.trim() === "") throw new Error("prompt must be a non-empty string")
    const timeout = AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined
    const combined = signal && timeout && AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal || timeout
    const response = await fetch(`${basePath}/${provider}/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, ...(n && { n }), ...(size && { size }), ...(model && { model }) }),
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
    return { images, usage: data?.usage ?? null, model: data?.model ?? model ?? null }
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

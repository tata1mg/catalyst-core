import { useState, useRef, useCallback, useEffect } from "react"
import { withDeadline } from "./requestSignal.js"

const REQUEST_TIMEOUT_MS = 180_000

/**
 * speech.synthesize against the cloud route (POST {basePath}/{provider}/speech). Pure, so pipelines can call it without React.
 * Resolves { audio: { mimeType, data, url }, usage, model } where `url` is a data: URL ready for new Audio(url).
 * Rejects with Error (message from the server's `error` field); aborts via `signal`.
 * @param {any} [options] Destructured here; typed loosely so TypeScript 7 does not narrow callers to the listed defaults.
 */
export async function requestSpeech({ basePath = "/ai", provider = "openai", text, voice, format, model, signal } = {}) {
    if (typeof text !== "string" || text.trim() === "") throw new Error("text must be a non-empty string")
    const deadline = withDeadline(signal, REQUEST_TIMEOUT_MS)
    let response
    let data = null
    try {
        response = await fetch(`${basePath}/${provider}/speech`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, ...(voice !== undefined && { voice }), ...(format !== undefined && { format }), ...(model !== undefined && { model }) }),
            signal: deadline.signal,
        })
        try {
            data = await response.json()
        } catch {
            // non-JSON error body: fall through to the status message below
        }
    } finally {
        deadline.done()
    }
    if (!response.ok) throw new Error(data?.error || `Speech request failed (${response.status})`)
    if (!data?.audio?.data) throw new Error("Speech response contained no audio")
    const audio = { ...data.audio, url: `data:${data.audio.mimeType};base64,${data.audio.data}` }
    return { audio, usage: data?.usage ?? null, model: data?.model ?? model ?? null }
}

/** React wrapper: { speak, cancel, reset, loading, error, audio, url, usage }. Cloud only for now (#611).
 * @param {any} [options] */
export function useSpeech({ basePath = "/ai", provider = "openai", model, voice, format } = {}) {
    const [state, setState] = useState({ audio: null, loading: false, error: null, usage: null })
    const controllerRef = useRef(null)

    const cancel = useCallback(() => {
        const controller = controllerRef.current
        controllerRef.current = null
        controller?.abort()
        // The aborted request sees that it is no longer the current one and returns without touching state, so the flag is cleared here.
        if (controller) setState((s) => ({ ...s, loading: false }))
    }, [])

    // Unmounting abandons the request instead of letting it download audio for a component that is gone.
    useEffect(() => () => {
        controllerRef.current?.abort()
        controllerRef.current = null
    }, [])

    const reset = useCallback(() => {
        cancel()
        setState({ audio: null, loading: false, error: null, usage: null })
    }, [cancel])

    const speak = useCallback(
        async (text, overrides = {}) => {
            controllerRef.current?.abort()
            const controller = new AbortController()
            controllerRef.current = controller
            setState((s) => ({ ...s, loading: true, error: null }))
            try {
                const result = await requestSpeech({ basePath, provider, model, voice, format, ...overrides, text, signal: controller.signal })
                if (controllerRef.current === controller) setState({ audio: result.audio, loading: false, error: null, usage: result.usage })
                return { ...result, error: null }
            } catch (err) {
                if (controller.signal.aborted && controllerRef.current !== controller) return { audio: null, usage: null, error: "cancelled" }
                const message = err?.message || String(err)
                if (controllerRef.current === controller) setState((s) => ({ ...s, loading: false, error: message }))
                return { audio: null, usage: null, error: message }
            }
        },
        [basePath, provider, model, voice, format]
    )

    return { ...state, url: state.audio?.url ?? null, speak, cancel, reset }
}

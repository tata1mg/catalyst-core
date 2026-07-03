import { useState, useRef, useCallback, useEffect } from "react"

const ATTACHMENT_TAG_RE = /<tool:create_attachment\s+component='([^']+)'([^>]*)>([\s\S]*?)<\/tool:create_attachment>/g

function parseAttachmentTag(_, component, attrStr, body) {
    const attrs = {}
    const attrRe = /(\w+)='([^']*)'/g
    let m
    while ((m = attrRe.exec(attrStr)) !== null) attrs[m[1]] = m[2]
    return `\x00SATTACH:${JSON.stringify({ component, attrs, body: body.trim() })}\x00`
}

// NATIVE_CALLBACKS mirrors the constants in catalyst-core NativeInterfaces.js
const NATIVE_CALLBACKS = {
    ON_AI_READY: "ON_AI_READY",
    ON_AI_PROGRESS: "ON_AI_PROGRESS",
    ON_AI_LOG: "ON_AI_LOG",
    ON_AI_ERROR: "ON_AI_ERROR",
}

export function useNativeAI({
    genConfig: genConfigProp = {},
    attachmentComponents = {},
    systemPrompt = "",
    sessionMode = "stateless",
    defaultGenConfig = {},
} = {}) {
    const hookGenConfig = { ...defaultGenConfig, ...genConfigProp }

    const [output, setOutput] = useState("")
    const [streaming, setStreaming] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [modelReady, setModelReady] = useState(false)
    const [nativeDownloadProgress, setNativeDownloadProgress] = useState(null)
    const [nativeLogs, setNativeLogs] = useState([])
    const [metrics, setMetrics] = useState(null)

    const abortControllerRef = useRef(null)
    const outputAccRef = useRef("")
    const rafRef = useRef(null)
    const nativeStreamUrlRef = useRef(null)
    const conversationIdRef = useRef(null)

    useEffect(() => {
        if (!window.NativeBridge?.initAI) {
            setError(new Error(
                "[@catalyst/cloud-ai/useNativeAI] window.NativeBridge.initAI not found. " +
                "Update catalyst-core to >=0.2.0 and add the android module to settings.gradle.kts."
            ))
            return
        }
        if (!window.WebBridge) {
            setError(new Error("[@catalyst/cloud-ai/useNativeAI] WebBridge not initialized — call WebBridge.init() before mounting useNativeAI"))
            return
        }

        const onReady = (data) => {
            try {
                const parsed = typeof data === "string" ? JSON.parse(data) : data
                if (parsed?.url) {
                    nativeStreamUrlRef.current = parsed.url
                    setModelReady(true)
                    setNativeDownloadProgress(null)
                }
            } catch (_) {}
        }

        const onProgress = (data) => {
            try {
                const parsed = typeof data === "string" ? JSON.parse(data) : data
                setNativeDownloadProgress(parsed)
            } catch (_) {}
        }

        const onLog = (data) => {
            try {
                const parsed = typeof data === "string" ? JSON.parse(data) : data
                const msg = parsed?.message ?? String(data)
                setNativeLogs((prev) => [...prev.slice(-99), msg])
            } catch (_) {}
        }

        const onError = (data) => {
            try {
                const parsed = typeof data === "string" ? JSON.parse(data) : data
                const msg = parsed?.message ?? String(data)
                setError(new Error(msg))
            } catch (_) {
                setError(new Error(String(data)))
            }
        }

        window.WebBridge.register(NATIVE_CALLBACKS.ON_AI_READY, onReady)
        window.WebBridge.register(NATIVE_CALLBACKS.ON_AI_PROGRESS, onProgress)
        window.WebBridge.register(NATIVE_CALLBACKS.ON_AI_LOG, onLog)
        window.WebBridge.register(NATIVE_CALLBACKS.ON_AI_ERROR, onError)
        window.NativeBridge.initAI(JSON.stringify({ attachmentComponents, systemPrompt }))

        return () => {
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_AI_READY)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_AI_PROGRESS)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_AI_LOG)
            window.WebBridge.unregister(NATIVE_CALLBACKS.ON_AI_ERROR)
        }
    }, [])

    const generate = useCallback(
        async ({ messages, genConfig: callGenConfig = {} }) => {
            const url = nativeStreamUrlRef.current
            if (!url) {
                setError(new Error("[@catalyst/cloud-ai/useNativeAI] stream URL not ready — did initAI fire?"))
                return
            }

            if (abortControllerRef.current) abortControllerRef.current.abort()
            const controller = new AbortController()
            abortControllerRef.current = controller

            const genConfig = { ...hookGenConfig, ...callGenConfig }
            const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n")

            setLoading(true)
            setOutput("")
            setError(null)
            setMetrics(null)
            outputAccRef.current = ""

            const t0 = performance.now()
            let tokenCount = 0
            let ttftMs = null

            try {
                const nativeBody = { prompt, genConfig }
                if (sessionMode === "stateful" && conversationIdRef.current) {
                    nativeBody.conversationId = conversationIdRef.current
                }

                const response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(nativeBody),
                    signal: controller.signal,
                })

                if (!response.ok) throw new Error(`Native AI HTTP error: ${response.status}`)

                setLoading(false)
                setStreaming(true)

                const reader = response.body.getReader()
                const decoder = new TextDecoder()
                let buffer = ""

                try {
                    while (true) {
                        const { done, value } = await reader.read()
                        if (done) break
                        buffer += decoder.decode(value, { stream: true })
                        const lines = buffer.split("\n")
                        buffer = lines.pop() || ""
                        for (const line of lines) {
                            if (!line.startsWith("data: ")) continue
                            try {
                                const data = JSON.parse(line.slice(6))
                                if (data.done) {
                                    setStreaming(false)
                                    const genMs = Math.round(performance.now() - t0)
                                    const tps = tokenCount > 0 ? parseFloat((tokenCount / (genMs / 1000)).toFixed(1)) : 0
                                    setMetrics({ device: "native", ttftMs, tps, totalTokens: tokenCount, genMs })
                                    return
                                }
                                if (sessionMode === "stateful" && data.conversationId) {
                                    conversationIdRef.current = data.conversationId
                                }
                                if (typeof data.token === "string") {
                                    if (ttftMs === null) ttftMs = Math.round(performance.now() - t0)
                                    tokenCount++
                                    outputAccRef.current += data.token
                                    outputAccRef.current = outputAccRef.current.replace(ATTACHMENT_TAG_RE, parseAttachmentTag)
                                    if (!rafRef.current) {
                                        const schedule = typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : (fn) => setTimeout(fn, 16)
                                        rafRef.current = schedule(() => {
                                            rafRef.current = null
                                            setOutput(outputAccRef.current)
                                        })
                                    }
                                }
                                if (data.error) throw new Error(data.error)
                            } catch (_) {}
                        }
                    }
                } finally {
                    reader.releaseLock()
                }

                // flush any pending RAF before marking done
                if (rafRef.current) {
                    typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame(rafRef.current) : clearTimeout(rafRef.current)
                    rafRef.current = null
                    setOutput(outputAccRef.current)
                }
                setStreaming(false)
            } catch (err) {
                if (err.name === "AbortError") return
                setError(err)
                setStreaming(false)
                setLoading(false)
            } finally {
                if (abortControllerRef.current === controller) abortControllerRef.current = null
            }
        },
        [hookGenConfig, sessionMode]
    )

    const cancelRaf = () => {
        if (!rafRef.current) return
        typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame(rafRef.current) : clearTimeout(rafRef.current)
        rafRef.current = null
    }

    const cancel = useCallback(() => {
        cancelRaf()
        if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null }
        setStreaming(false)
    }, [])

    const reset = useCallback(() => {
        cancelRaf()
        outputAccRef.current = ""
        if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null }
        conversationIdRef.current = null
        if (window.NativeBridge?.clearNativeConversation) {
            window.NativeBridge.clearNativeConversation()
        }
        setOutput("")
        setError(null)
        setMetrics(null)
        setStreaming(false)
        setLoading(false)
    }, [])

    return {
        output,
        streaming,
        loading,
        error,
        modelReady,
        downloadProgress: null,
        nativeDownloadProgress,
        nativeLogs,
        metrics,
        isLocal: false,
        isNative: true,
        isWeb: false,
        generate,
        cancel,
        reset,
        clearError: useCallback(() => setError(null), []),
        get conversationId() { return conversationIdRef.current },
        // Native bridge generations aren't HTTP usage objects, so there's no cost/token
        // accounting to aggregate yet — stubbed so callers can invoke unconditionally
        // across all three modes without branching.
        getSessionMetrics: useCallback(() => null, []),
        resetSessionMetrics: useCallback(() => {}, []),
    }
}

import { useState, useRef, useCallback, useMemo } from "react"
import { buildAttachmentSystemPrompt } from "./buildAttachmentSystemPrompt.js"
import { computeMetrics, aggregateSessionMetrics } from "./metrics.js"

const ATTACHMENT_TAG_RE = /<tool:create_attachment\s+component='([^']+)'([^>]*)>([\s\S]*?)<\/tool:create_attachment>/g

function parseAttachmentTag(_, component, attrStr, body) {
    const attrs = {}
    const attrRe = /(\w+)='([^']*)'/g
    let m
    while ((m = attrRe.exec(attrStr)) !== null) attrs[m[1]] = m[2]
    return `\x00SATTACH:${JSON.stringify({ component, attrs, body: body.trim() })}\x00`
}

function shallowEqual(a, b) {
    if (a === b) return true
    if (!a || !b) return false
    const ka = Object.keys(a), kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    return ka.every((k) => a[k] === b[k])
}

const schedule = typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : (fn) => setTimeout(fn, 16)
const cancelSchedule = typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame : clearTimeout

export function useCloudAI({
    basePath = "/ai",
    provider: providerProp = "openai",
    model: modelProp,
    genConfig: genConfigProp = {},
    attachmentComponents = {},
    systemPrompt = "",
    sessionMode = "stateless",
    defaultGenConfig = {},
} = {}) {
    // stable merged genConfig — only changes when values actually change
    const mergedGenConfig = useMemo(
        () => ({ ...defaultGenConfig, ...genConfigProp }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [JSON.stringify(defaultGenConfig), JSON.stringify(genConfigProp)]
    )

    // stable attachmentComponents ref — avoid generate() churn when caller passes inline object
    const attachmentComponentsRef = useRef(attachmentComponents)
    if (!shallowEqual(attachmentComponentsRef.current, attachmentComponents)) {
        attachmentComponentsRef.current = attachmentComponents
    }

    const systemPromptRef = useRef(systemPrompt)
    systemPromptRef.current = systemPrompt

    const providerRef = useRef(providerProp)
    providerRef.current = providerProp

    const modelRef = useRef(modelProp)
    modelRef.current = modelProp

    const sessionModeRef = useRef(sessionMode)
    sessionModeRef.current = sessionMode

    const [output, setOutput] = useState("")
    const [streaming, setStreaming] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [metrics, setMetrics] = useState(null)

    const abortControllerRef = useRef(null)
    const outputAccRef = useRef("")
    const rafRef = useRef(null)
    const conversationIdRef = useRef(null)
    const activeGenerationRef = useRef(0)
    const historyRef = useRef([])

    const generate = useCallback(
        async ({ messages, genConfig: callGenConfig = {} }) => {
            if (abortControllerRef.current) abortControllerRef.current.abort()

            const generationId = ++activeGenerationRef.current
            const controller = new AbortController()
            abortControllerRef.current = controller

            const genConfig = { ...mergedGenConfig, ...callGenConfig }
            const provider = providerRef.current
            const isStreamMode = genConfig.stream !== false

            setLoading(true)
            setOutput("")
            setError(null)
            setMetrics(null)
            outputAccRef.current = ""
            if (rafRef.current) { cancelSchedule(rafRef.current); rafRef.current = null }

            const builtSystemPrompt = buildAttachmentSystemPrompt(systemPromptRef.current, attachmentComponentsRef.current)
            const messagesWithSystem = builtSystemPrompt
                ? [{ role: "system", content: builtSystemPrompt }, ...messages]
                : messages

            const t0 = performance.now()
            let tokenCount = 0
            let ttftMs = null
            let usage = null

            try {
                if (!isStreamMode) {
                    // non-streaming: POST /:provider/generate → JSON
                    const url = `${basePath}/${provider}/generate`
                    const body = { messages: messagesWithSystem, genConfig }
                    if (sessionModeRef.current === "stateful") body.conversationId = conversationIdRef.current ?? null
                    if (modelRef.current) body.model = modelRef.current

                    const response = await fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                        signal: controller.signal,
                    })

                    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`)
                    setLoading(false)

                    const data = await response.json()
                    if (activeGenerationRef.current !== generationId) return

                    if (sessionModeRef.current === "stateful" && data.conversationId) {
                        conversationIdRef.current = data.conversationId
                    }
                    const genMs = Math.round(performance.now() - t0)
                    setOutput(data.output ?? "")
                    const generateUsage = data.usage ? { ...data.usage, provider } : null
                    const generateMetrics = computeMetrics(generateUsage, { ttftMs: genMs, genMs })
                    setMetrics(generateMetrics)
                    if (generateMetrics) historyRef.current.push(generateMetrics)
                    return
                }

                // streaming: POST /:provider/stream → SSE
                const url = `${basePath}/${provider}/stream`
                const body = { messages: messagesWithSystem, genConfig }
                if (sessionModeRef.current === "stateful") body.conversationId = conversationIdRef.current ?? null
                if (modelRef.current) body.model = modelRef.current

                const response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                })

                if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`)

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
                            const payload = line.slice(6).trim()
                            if (payload === "[DONE]") {
                                // flush any pending RAF before marking done
                                if (rafRef.current) { cancelSchedule(rafRef.current); rafRef.current = null }
                                setOutput(outputAccRef.current)
                                setStreaming(false)
                                return
                            }
                            try {
                                const data = JSON.parse(payload)
                                if (sessionModeRef.current === "stateful" && data.conversationId && activeGenerationRef.current === generationId) {
                                    conversationIdRef.current = data.conversationId
                                }
                                if (typeof data.token === "string") {
                                    if (ttftMs === null) ttftMs = Math.round(performance.now() - t0)
                                    tokenCount++
                                    outputAccRef.current += data.token
                                    outputAccRef.current = outputAccRef.current.replace(ATTACHMENT_TAG_RE, parseAttachmentTag)
                                    if (!rafRef.current) {
                                        rafRef.current = schedule(() => {
                                            rafRef.current = null
                                            setOutput(outputAccRef.current)
                                        })
                                    }
                                }
                                if (data.usage) {
                                    usage = { ...data.usage, provider }
                                }
                            } catch (_) {}
                        }
                    }
                } finally {
                    reader.releaseLock()
                }

                // stream ended without [DONE] — flush and finalize
                if (rafRef.current) { cancelSchedule(rafRef.current); rafRef.current = null }
                setOutput(outputAccRef.current)
                setStreaming(false)
            } catch (err) {
                if (err.name === "AbortError") return
                setError(err)
                setStreaming(false)
                setLoading(false)
            } finally {
                if (activeGenerationRef.current === generationId) {
                    const genMs = Math.round(performance.now() - t0)
                    if (usage) {
                        const streamMetrics = computeMetrics(usage, { ttftMs, genMs })
                        setMetrics(streamMetrics)
                        if (streamMetrics) historyRef.current.push(streamMetrics)
                    } else if (tokenCount > 0) {
                        // usage frame never arrived (e.g. unverified Interactions API usage shape) —
                        // fall back to our own token-count-based tps so the UI isn't left blank
                        const tps = parseFloat((tokenCount / (genMs / 1000)).toFixed(1))
                        const fallbackMetrics = {
                            provider, model: modelRef.current, ttftMs, genMs, tps,
                            promptTokens: null, cachedTokens: null, completionTokens: tokenCount,
                            reasoningTokens: null, totalTokens: tokenCount, cost: null, cacheSavings: null,
                            device: null, dtype: null, loadMs: null, downloadBytes: null,
                        }
                        setMetrics(fallbackMetrics)
                        historyRef.current.push(fallbackMetrics)
                    }
                    if (abortControllerRef.current === controller) abortControllerRef.current = null
                }
            }
        },
        [basePath, mergedGenConfig]
    )

    const cancel = useCallback(() => {
        if (rafRef.current) { cancelSchedule(rafRef.current); rafRef.current = null }
        if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null }
        setStreaming(false)
    }, [])

    const reset = useCallback(() => {
        if (rafRef.current) { cancelSchedule(rafRef.current); rafRef.current = null }
        outputAccRef.current = ""
        if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null }
        conversationIdRef.current = null
        setOutput("")
        setError(null)
        setMetrics(null)
        setStreaming(false)
        setLoading(false)
    }, [])

    const getSessionMetrics = useCallback(() => aggregateSessionMetrics(historyRef.current), [])

    const resetSessionMetrics = useCallback(() => {
        historyRef.current = []
    }, [])

    return {
        output,
        streaming,
        loading,
        error,
        metrics,
        modelReady: true,
        downloadProgress: null,
        nativeDownloadProgress: null,
        nativeLogs: [],
        isLocal: false,
        isNative: false,
        isWeb: true,
        generate,
        cancel,
        reset,
        getSessionMetrics,
        resetSessionMetrics,
        clearError: useCallback(() => setError(null), []),
        get conversationId() { return conversationIdRef.current },
    }
}

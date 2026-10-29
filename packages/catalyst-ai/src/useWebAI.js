import { useState, useRef, useCallback, useMemo, useEffect } from "react"
import { assertEngineSupports, getModalities, supportsWebMedia, toWebTemplate } from "./contentParts.js"
import { prepareAudioParts } from "./audioPrep.js"
import { prepareImageParts } from "./imagePrep.js"
import { WORKER_SCRIPT } from "./webWorkerScript.js"
import { aggregateWebSessionMetrics, estimateCloudEquivalent } from "./metrics.js"
import { ERROR_CODES, createError } from "catalyst-core/errors"

const schedule = typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : (fn) => setTimeout(fn, 16)
const cancelSchedule = typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame : clearTimeout

// EXPERIMENTAL: in-browser inference via Transformers.js is not efficient or reliable yet —
// generation quality/instruction-following degrades noticeably on larger models (e.g. Llama 3)
// versus useCloudAI/useNativeAI, and WebGPU/WASM backend selection is unpredictable across
// devices. Treat this provider as a demo/fallback path, not production-ready, until revisited.

let workerBlobUrl = null
function getWorkerBlobUrl() {
    if (!workerBlobUrl) {
        const blob = new Blob([WORKER_SCRIPT], { type: "application/javascript" })
        workerBlobUrl = URL.createObjectURL(blob)
    }
    return workerBlobUrl
}

export function useWebAI({
    model: modelProp,
    formatPrompt,
    genConfig: genConfigProp = {},
    defaultGenConfig = {},
    sessionMode = "stateless",
    // useNetworkStatus() of the page: offline pauses a model download in the worker, back online resumes it.
    network,
    // Download policy for a weak or lost connection (AI_CONFIG.browser.download): minBytesPerSec, windowSec, resumeDelaySec, maxIdleRetries.
    download,
} = {}) {
    // stable merged genConfig — only changes when values actually change
    const hookGenConfig = useMemo(
        () => ({ ...defaultGenConfig, ...genConfigProp }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [JSON.stringify(defaultGenConfig), JSON.stringify(genConfigProp)]
    )

    const [output, setOutputState] = useState("")
    const [streaming, setStreaming] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setErrorState] = useState(null)
    // What the latest generate() call produced, so callers can await a result instead of watching state.
    const outcomeRef = useRef({ output: "", error: null })
    const setOutput = useCallback((value) => {
        outcomeRef.current.output = value
        setOutputState(value)
    }, [])
    const setError = useCallback((value) => {
        outcomeRef.current.error = value
        setErrorState(value)
    }, [])
    const [modelReady, setModelReady] = useState(false)
    const [downloadProgress, setDownloadProgress] = useState(null)
    // Latest status per file from the worker's resumable fetch ("paused" while it waits for the connection).
    const [fileStatus, setFileStatus] = useState({})
    const pausedFiles = Object.values(fileStatus).filter((s) => s.state === "paused")
    const downloadPaused = pausedFiles.length > 0
    const downloadPauseReason = downloadPaused ? pausedFiles[0].reason || "error" : null
    const online = network ? network.online !== false : undefined
    const onlineRef = useRef(online)
    onlineRef.current = online
    const downloadPolicyRef = useRef(download)
    downloadPolicyRef.current = download
    const [metrics, setMetrics] = useState(null)

    const workerRef = useRef(null)
    const workerModelRef = useRef(null)
    const busyRef = useRef(false)
    const settleRef = useRef(null)
    const outputAccRef = useRef("")
    const rafRef = useRef(null)
    const cancelledRef = useRef(false)
    const historyRef = useRef([])
    const messagesRef = useRef([])
    const conversationIdRef = useRef(null)

    useEffect(() => () => {
        if (rafRef.current) { cancelSchedule(rafRef.current); rafRef.current = null }
        if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null }
    }, [])

    const formatPromptRef = useRef(formatPrompt)
    formatPromptRef.current = formatPrompt

    // Ends the pending generate() promise (done, error, crash, cancel or reset).
    const settle = useCallback(() => {
        const resolve = settleRef.current
        settleRef.current = null
        if (resolve) resolve()
    }, [])

    const run = useCallback(
        async ({ messages, genConfig: callGenConfig = {}, model: callModel }) => {
            const resolvedModel = callModel || modelProp
            if (!resolvedModel) {
                setError(new Error("[catalyst-ai/useWebAI] no model specified — pass model prop or per-call model"))
                return
            }

            // Only Gemma 4 takes image/audio in the browser; other models are text-only and refuse media loudly.
            // Gemma 4 always goes through the media path (it needs AutoProcessor + Gemma4ForConditionalGeneration).
            const mediaModel = supportsWebMedia(resolvedModel)
            let template = null
            try {
                assertEngineSupports(getModalities(messages), mediaModel ? { text: true, image: true, audio: true } : { text: true }, "web")
                if (mediaModel) {
                    const prepared = await prepareImageParts(
                        await prepareAudioParts(messages, {
                            onError: (e) => console.warn("[catalyst-ai] audio could not be normalised, sending the original:", e.message),
                        }),
                        { onError: (e) => console.warn("[catalyst-ai] image could not be resized, sending the original:", e.message) }
                    )
                    template = toWebTemplate(prepared)
                }
            } catch (inputErr) {
                setError(inputErr)
                return
            }

            // A media-capable worker holds ~3.4 GB of weights, so it is kept alive between calls (same model, idle).
            const reuseWorker = mediaModel && workerRef.current && workerModelRef.current === resolvedModel && !busyRef.current
            if (!reuseWorker && workerRef.current) {
                workerRef.current.terminate()
                workerRef.current = null
            }

            const genConfig = { ...hookGenConfig, ...callGenConfig }
            const resolvedMessages = sessionMode === "stateful" ? [...messagesRef.current, ...messages] : messages

            setLoading(true)
            setOutput("")
            setError(null)
            setDownloadProgress(null)
            setFileStatus({})
            setMetrics(null)
            setModelReady(!!reuseWorker)
            cancelledRef.current = false
            outputAccRef.current = ""
            if (rafRef.current) { cancelSchedule(rafRef.current); rafRef.current = null }

            const metricsAcc = { device: null, dtype: null, loadMs: null, downloadBytes: 0, ttftMs: null, tps: null, totalTokens: null, genMs: null, cloudEquivalent: null }

            let worker = reuseWorker ? workerRef.current : null
            if (!worker) {
                try {
                    worker = new Worker(getWorkerBlobUrl(), { type: "module" })
                } catch (err) {
                    setError(createError(ERROR_CODES.AI_WEB_WORKER_UNAVAILABLE, { cause: err }))
                    setLoading(false)
                    return
                }
            }
            workerRef.current = worker
            workerModelRef.current = resolvedModel
            busyRef.current = true
            // Tell the worker how to treat a bad connection and what the page believes right now, before it starts loading.
            worker.postMessage({ type: "configure", policy: downloadPolicyRef.current || {}, online: onlineRef.current })

            worker.onmessage = (e) => {
                const msg = e.data
                switch (msg.type) {
                    case "log":
                        console.log(msg.msg)
                        break
                    case "download_status":
                        setFileStatus((prev) => ({ ...prev, [msg.file]: { state: msg.state, reason: msg.reason, retryInSec: msg.retryInSec } }))
                        break
                    case "progress":
                        setDownloadProgress({ file: msg.file, percent: msg.percent, status: msg.status })
                        if (msg.total) metricsAcc.downloadBytes = Math.max(metricsAcc.downloadBytes, msg.total)
                        break
                    case "model_ready":
                        metricsAcc.device = msg.device
                        metricsAcc.dtype = msg.dtype
                        metricsAcc.loadMs = msg.loadMs
                        if (msg.totalBytes) metricsAcc.downloadBytes = msg.totalBytes
                        setModelReady(true)
                        setDownloadProgress(null)
                        break
                    case "streaming_start":
                        setLoading(false)
                        setStreaming(true)
                        break
                    case "ttft":
                        metricsAcc.ttftMs = msg.ms
                        break
                    case "token":
                        outputAccRef.current += msg.text
                        if (!rafRef.current) {
                            rafRef.current = schedule(() => {
                                rafRef.current = null
                                setOutput(outputAccRef.current)
                            })
                        }
                        break
                    case "done":
                        if (rafRef.current) { cancelSchedule(rafRef.current) }
                        rafRef.current = null
                        setOutput(outputAccRef.current)
                        metricsAcc.tps = msg.tps
                        metricsAcc.totalTokens = msg.totalTokens
                        metricsAcc.genMs = msg.genMs
                        // Only the media path reports its input token count; the text pipeline leaves this null.
                        metricsAcc.cloudEquivalent = estimateCloudEquivalent({
                            inputTokens: typeof msg.promptTokens === "number" ? msg.promptTokens : null,
                            outputTokens: msg.totalTokens,
                        })
                        setMetrics({ ...metricsAcc })
                        historyRef.current.push({ ...metricsAcc })
                        if (sessionMode === "stateful") {
                            if (!conversationIdRef.current) {
                                conversationIdRef.current =
                                    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                                        ? crypto.randomUUID()
                                        : `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
                            }
                            messagesRef.current = [...resolvedMessages, { role: "assistant", content: outputAccRef.current }]
                        }
                        setStreaming(false)
                        setLoading(false)
                        busyRef.current = false
                        if (!mediaModel) {
                            worker.terminate()
                            workerRef.current = null
                        }
                        settle()
                        break
                    case "error":
                        console.error("[catalyst-ai/useWebAI] worker error:", msg.message)
                        setError(createError(ERROR_CODES.AI_WEB_WORKER_CRASHED, { message: msg.message }))
                        setStreaming(false)
                        setLoading(false)
                        busyRef.current = false
                        worker.terminate()
                        workerRef.current = null
                        settle()
                        break
                }
            }

            worker.onerror = (e) => {
                console.error("[catalyst-ai/useWebAI] worker uncaught error:", e)
                setError(createError(ERROR_CODES.AI_WEB_WORKER_CRASHED, {
                    message: e.message || "Worker crashed",
                    cause: e,
                }))
                setStreaming(false)
                setLoading(false)
                busyRef.current = false
                worker.terminate()
                workerRef.current = null
                settle()
            }

            worker.postMessage({
                type: "generate",
                model: resolvedModel,
                messages: template ? template.messages : resolvedMessages,
                media: template ? { images: template.images, audios: template.audios } : null,
                genConfig,
                formatPrompt: typeof formatPromptRef.current === "function" ? formatPromptRef.current.toString() : null,
            })
            return true
        },
        [modelProp, hookGenConfig, sessionMode]
    )

    /**
     * Starts a generation and resolves when it has finished with `{ output, error }`: the final text, or the error
     * that ended it (both empty when it was cancelled). The hook state updates as before.
     */
    const generate = useCallback(
        async (args) => {
            const outcome = { output: "", error: null }
            outcomeRef.current = outcome
            settle() // a superseded call must not hang
            const settled = new Promise((resolve) => { settleRef.current = resolve })
            const started = await run(args)
            if (!started) {
                settleRef.current = null // refused before any worker started: the error is already recorded
                return outcome
            }
            await settled
            return outcome
        },
        [run, settle]
    )

    const cancel = useCallback(() => {
        cancelledRef.current = true
        if (rafRef.current) { cancelSchedule(rafRef.current); rafRef.current = null }
        if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null }
        busyRef.current = false
        setStreaming(false)
        settle()
    }, [settle])

    const reset = useCallback(() => {
        cancelledRef.current = true
        if (rafRef.current) { cancelSchedule(rafRef.current); rafRef.current = null }
        outputAccRef.current = ""
        if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null }
        conversationIdRef.current = null
        messagesRef.current = []
        setOutput("")
        setError(null)
        setMetrics(null)
        setModelReady(false)
        setDownloadProgress(null)
        setStreaming(false)
        setLoading(false)
        settle()
    }, [settle])

    // The page's connection state follows the worker: offline interrupts its transfers, back online resumes them.
    useEffect(() => {
        if (online !== undefined && workerRef.current) workerRef.current.postMessage({ type: "network", online })
    }, [online])

    return {
        output,
        streaming,
        loading,
        error,
        modelReady,
        downloadProgress,
        // True while a model file waits for the connection; the reason is "offline", "weak" or "error".
        downloadPaused,
        downloadPauseReason,
        nativeDownloadProgress: null,
        nativeLogs: [],
        metrics,
        isLocal: true,
        isNative: false,
        isWeb: true,
        generate,
        cancel,
        reset,
        clearError: useCallback(() => setError(null), []),
        get conversationId() { return conversationIdRef.current },
        getSessionMetrics: useCallback(() => aggregateWebSessionMetrics(historyRef.current), []),
        resetSessionMetrics: useCallback(() => { historyRef.current = [] }, []),
    }
}

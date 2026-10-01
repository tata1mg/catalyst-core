import { useState, useRef, useCallback, useMemo, useEffect } from "react"
import { aggregateWebSessionMetrics } from "./metrics.js"
import { ERROR_CODES, createError } from "catalyst-core/errors"

const schedule = typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : (fn) => setTimeout(fn, 16)
const cancelSchedule = typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame : clearTimeout

// EXPERIMENTAL: in-browser inference via Transformers.js is not efficient or reliable yet —
// generation quality/instruction-following degrades noticeably on larger models (e.g. Llama 3)
// versus useCloudAI/useNativeAI, and WebGPU/WASM backend selection is unpredictable across
// devices. Treat this provider as a demo/fallback path, not production-ready, until revisited.

const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js"

const WORKER_SCRIPT = `
const TRANSFORMERS_CDN = "${TRANSFORMERS_CDN}";
let pipe = null;
let TextStreamer = null;
let loadedModel = null;
let loadedDevice = null;

async function loadPipeline(model) {
    if (loadedModel === model && pipe) {
        self.postMessage({ type: "log", msg: "[worker] pipeline cache hit — " + model + " on " + loadedDevice });
        return;
    }

    self.postMessage({ type: "log", msg: "[worker] importing transformers from CDN..." });
    const mod = await import(TRANSFORMERS_CDN);
    mod.env.allowLocalModels = false;
    TextStreamer = mod.TextStreamer;

    const backends = [
        { device: "webgpu", dtype: "q4f16" },
        { device: "wasm",   dtype: "q4"    },
    ];

    let lastErr = null;
    for (const { device, dtype } of backends) {
        try {
            self.postMessage({ type: "log", msg: "[worker] trying device=" + device + " dtype=" + dtype });
            const fileTotals = {};
            const dlStart = performance.now();

            pipe = await mod.pipeline("text-generation", model, {
                device,
                dtype,
                progress_callback: (info) => {
                    const { status, file, name, loaded, total } = info;
                    const pct = total > 0 ? Math.round((loaded / total) * 100) : null;
                    if (total) fileTotals[file || name] = total;
                    if (status === "initiate") {
                        self.postMessage({ type: "progress", file: file || name, percent: 0, status: "initiate" });
                        self.postMessage({ type: "log", msg: "[worker] download initiate: " + (file || name) });
                    } else if (status === "download" || status === "progress") {
                        self.postMessage({ type: "progress", file: file || name, percent: pct, loaded, total, status: "downloading" });
                    } else if (status === "done") {
                        self.postMessage({ type: "progress", file: file || name, percent: 100, status: "done" });
                        self.postMessage({ type: "log", msg: "[worker] download done: " + (file || name) });
                    }
                },
            });

            loadedModel = model;
            loadedDevice = device;
            const loadMs = Math.round(performance.now() - dlStart);
            const totalBytes = Object.values(fileTotals).reduce((sum, n) => sum + n, 0);
            self.postMessage({ type: "model_ready", device, dtype, loadMs, totalBytes });
            self.postMessage({ type: "log", msg: "[worker] pipeline ready — device=" + device + " loadMs=" + loadMs });
            return;
        } catch (err) {
            self.postMessage({ type: "log", msg: "[worker] " + device + " failed (" + err.message + "), trying next..." });
            lastErr = err;
            pipe = null;
        }
    }
    throw lastErr || new Error("All backends failed");
}

self.onmessage = async (e) => {
    const { type, model, messages, genConfig, formatPrompt } = e.data;
    if (type !== "generate") return;

    try {
        await loadPipeline(model);

        let pipeInput;
        if (formatPrompt) {
            try {
                const overrideFn = new Function("return (" + formatPrompt + ")")();
                const text = overrideFn(messages);
                pipeInput = text;
                self.postMessage({ type: "log", msg: "[worker] using custom formatPrompt (" + text.length + " chars)" });
            } catch (err) {
                self.postMessage({ type: "log", msg: "[worker] formatPrompt failed (" + err.message + "), falling back to tokenizer template" });
            }
        }
        if (!pipeInput) {
            try {
                const text = pipe.tokenizer.apply_chat_template(messages, { tokenize: false, add_generation_prompt: true });
                pipeInput = text;
                self.postMessage({ type: "log", msg: "[worker] chat template applied (" + text.length + " chars)" });
            } catch (err) {
                pipeInput = messages;
                self.postMessage({ type: "log", msg: "[worker] no chat template (" + err.message + "), passing messages array" });
            }
        }

        const pipeInputType = typeof pipeInput === "string" ? "string" : Array.isArray(pipeInput) ? "messages[]" : typeof pipeInput;
        const pipeInputLength = typeof pipeInput === "string" ? pipeInput.length : Array.isArray(pipeInput) ? pipeInput.length : 0;
        self.postMessage({ type: "log", msg: "[worker] pipe input: type=" + pipeInputType + " length=" + pipeInputLength });
        self.postMessage({ type: "streaming_start" });

        let tokenCount = 0;
        let ttftFired = false;
        const tGen = performance.now();

        let batch = "";
        let batchTimer = null;
        const flushBatch = () => {
            batchTimer = null;
            if (!batch) return;
            self.postMessage({ type: "token", text: batch });
            batch = "";
        };

        const streamer = new TextStreamer(pipe.tokenizer, {
            skip_prompt: true,
            skip_special_tokens: true,
            token_callback_function: () => {
                if (!ttftFired) {
                    ttftFired = true;
                    self.postMessage({ type: "ttft", ms: Math.round(performance.now() - tGen) });
                }
                tokenCount++;
            },
            callback_function: (text) => {
                batch += text;
                if (tokenCount % 8 === 0) { clearTimeout(batchTimer); flushBatch(); }
                else if (!batchTimer) { batchTimer = setTimeout(flushBatch, 80); }
            },
        });

        const { maxTokens, temperature, topP, repetitionPenalty, noRepeatNgramSize, earlyStop, ...rest } = genConfig;
        await pipe(pipeInput, {
            max_new_tokens: maxTokens,
            do_sample: temperature > 0,
            temperature,
            top_p: topP,
            repetition_penalty: repetitionPenalty,
            no_repeat_ngram_size: noRepeatNgramSize ?? 3,
            early_stopping: earlyStop ?? true,
            ...rest,
            streamer,
        });

        clearTimeout(batchTimer);
        flushBatch();

        const genMs = Math.round(performance.now() - tGen);
        const tps = tokenCount > 0 ? parseFloat((tokenCount / (genMs / 1000)).toFixed(1)) : 0;
        self.postMessage({ type: "done", totalTokens: tokenCount, genMs, tps });
    } catch (err) {
        self.postMessage({ type: "error", message: err.message || String(err) });
    }
};
`

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
} = {}) {
    // stable merged genConfig — only changes when values actually change
    const hookGenConfig = useMemo(
        () => ({ ...defaultGenConfig, ...genConfigProp }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [JSON.stringify(defaultGenConfig), JSON.stringify(genConfigProp)]
    )

    const [output, setOutput] = useState("")
    const [streaming, setStreaming] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [modelReady, setModelReady] = useState(false)
    const [downloadProgress, setDownloadProgress] = useState(null)
    const [metrics, setMetrics] = useState(null)

    const workerRef = useRef(null)
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

    const generate = useCallback(
        ({ messages, genConfig: callGenConfig = {}, model: callModel }) => {
            if (workerRef.current) {
                workerRef.current.terminate()
                workerRef.current = null
            }

            const resolvedModel = callModel || modelProp
            if (!resolvedModel) {
                setError(new Error("[catalyst-ai/useWebAI] no model specified — pass model prop or per-call model"))
                return
            }

            const genConfig = { ...hookGenConfig, ...callGenConfig }
            const resolvedMessages = sessionMode === "stateful" ? [...messagesRef.current, ...messages] : messages

            setLoading(true)
            setOutput("")
            setError(null)
            setDownloadProgress(null)
            setMetrics(null)
            setModelReady(false)
            cancelledRef.current = false
            outputAccRef.current = ""
            if (rafRef.current) { cancelSchedule(rafRef.current); rafRef.current = null }

            const metricsAcc = { device: null, dtype: null, loadMs: null, downloadBytes: 0, ttftMs: null, tps: null, totalTokens: null, genMs: null }

            let worker
            try {
                worker = new Worker(getWorkerBlobUrl(), { type: "module" })
            } catch (err) {
                setError(createError(ERROR_CODES.AI_WEB_WORKER_UNAVAILABLE, { cause: err }))
                setLoading(false)
                return
            }
            workerRef.current = worker

            worker.onmessage = (e) => {
                const msg = e.data
                switch (msg.type) {
                    case "log":
                        console.log(msg.msg)
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
                        worker.terminate()
                        workerRef.current = null
                        break
                    case "error":
                        console.error("[catalyst-ai/useWebAI] worker error:", msg.message)
                        setError(createError(ERROR_CODES.AI_WEB_WORKER_CRASHED, { message: msg.message }))
                        setStreaming(false)
                        setLoading(false)
                        worker.terminate()
                        workerRef.current = null
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
                worker.terminate()
                workerRef.current = null
            }

            worker.postMessage({
                type: "generate",
                model: resolvedModel,
                messages: resolvedMessages,
                genConfig,
                formatPrompt: typeof formatPromptRef.current === "function" ? formatPromptRef.current.toString() : null,
            })
        },
        [modelProp, hookGenConfig, sessionMode]
    )

    const cancel = useCallback(() => {
        cancelledRef.current = true
        if (rafRef.current) { cancelSchedule(rafRef.current); rafRef.current = null }
        if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null }
        setStreaming(false)
    }, [])

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
    }, [])

    return {
        output,
        streaming,
        loading,
        error,
        modelReady,
        downloadProgress,
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

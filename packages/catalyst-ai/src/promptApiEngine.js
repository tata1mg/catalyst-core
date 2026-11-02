// Chrome's built-in model (the Prompt API, `LanguageModel`) as a web engine, desktop Chrome only.
//
// useWebAI talks to its engine through a Worker-shaped message protocol (postMessage in; log / progress / model_ready /
// streaming_start / ttft / token / done / error out). The Prompt API cannot run in a Worker, so this module is that same
// protocol implemented on the main thread: useWebAI treats it as a worker and everything above it (streaming, metrics,
// cancel, errors) is unchanged. Chrome owns the model download; the page only passes consent by calling it from a click.

const AVAILABILITY = ["unavailable", "downloadable", "downloading", "available"]
const MODEL_LABEL = "chrome-built-in"

/** "unavailable" | "downloadable" | "downloading" | "available". Never throws: no API, an old Chrome or an error is "unavailable". */
export async function getPromptApiAvailability(api = globalThis.LanguageModel) {
    if (!api || typeof api.availability !== "function") return "unavailable"
    try {
        const state = await api.availability()
        return AVAILABILITY.includes(state) ? state : "unavailable"
    } catch (_) {
        return "unavailable"
    }
}

const textOf = (content) =>
    typeof content === "string" ? content : Array.isArray(content) ? content.filter((p) => p?.type === "text").map((p) => p.text).join(" ") : ""

const hasMedia = (messages) => messages.some((m) => Array.isArray(m?.content) && m.content.some((p) => p && p.type !== "text"))

/**
 * Chat messages -> what LanguageModel.create / promptStreaming take. System text and the earlier turns seed the session
 * (`initialPrompts`); the last user message is the prompt. A conversation that does not end on a user turn is refused.
 */
export function toPromptApiInput(messages) {
    const turns = messages.map((m) => ({ role: m.role, content: textOf(m.content) })).filter((m) => m.content !== "")
    const last = turns[turns.length - 1]
    if (!last || last.role !== "user") throw new Error("The last message must be from the user")
    const system = turns.filter((m) => m.role === "system").map((m) => m.content).join("\n\n")
    const history = turns.slice(0, -1).filter((m) => m.role === "user" || m.role === "assistant")
    return { initialPrompts: [...(system ? [{ role: "system", content: system }] : []), ...history], prompt: last.content }
}

/**
 * promptStreaming has returned both increments and the whole text so far, depending on the Chrome version. The second
 * chunk tells which: if it extends the first it is cumulative, otherwise chunks are increments.
 */
export function createDeltaReader() {
    let mode = null
    let first = ""
    let emitted = ""
    return (chunk) => {
        if (mode === null && first === "") {
            first = chunk
            emitted = chunk
            return chunk
        }
        if (mode === null) mode = chunk.length > first.length && chunk.startsWith(first) ? "cumulative" : "delta"
        if (mode === "cumulative") {
            const piece = chunk.startsWith(emitted) ? chunk.slice(emitted.length) : chunk
            emitted = chunk.startsWith(emitted) ? chunk : emitted + chunk
            return piece
        }
        emitted += chunk
        return chunk
    }
}

/** A Worker-compatible object backed by the Prompt API. `api` and `now` are injectable for tests. */
export function createPromptApiEngine({ api = globalThis.LanguageModel, now = () => performance.now() } = {}) {
    const abort = new AbortController()
    let session = null
    let closed = false

    const engine = {
        onmessage: null,
        onerror: null,
        postMessage(msg) {
            if (msg?.type === "generate") run(msg).catch((err) => fail(err))
            // "configure" and "network" are for the Transformers.js worker: Chrome manages its own download and connection.
        },
        terminate() {
            closed = true
            abort.abort()
            try { session?.destroy?.() } catch (_) { /* already gone */ }
            session = null
        },
    }

    const emit = (data) => { if (!closed && typeof engine.onmessage === "function") engine.onmessage({ data }) }
    const fail = (err) => {
        if (closed || abort.signal.aborted) return
        // A model that still has to download can only start from a user gesture; say so instead of "NotAllowedError".
        const message = err?.name === "NotAllowedError"
            ? "Chrome needs a click or tap to start downloading its built-in model. Try again from a button press."
            : err?.message || String(err)
        emit({ type: "error", message })
    }

    async function run({ messages }) {
        if (!api || typeof api.create !== "function") throw new Error("Chrome's built-in model (Prompt API) is not available in this browser")
        if (hasMedia(messages)) throw new Error("Chrome's built-in model takes text only here")
        const { initialPrompts, prompt } = toPromptApiInput(messages)

        const availability = await getPromptApiAvailability(api)
        if (availability === "unavailable") throw new Error("Chrome's built-in model is unavailable on this device")
        emit({ type: "log", msg: `[catalyst-ai] Chrome Prompt API: ${availability}` })

        const loadStart = now()
        session = await api.create({
            ...(initialPrompts.length && { initialPrompts }),
            signal: abort.signal,
            monitor(monitor) {
                monitor.addEventListener("downloadprogress", (e) => {
                    emit({ type: "progress", file: MODEL_LABEL, percent: Math.round((e.loaded ?? 0) * 100), status: "downloading" })
                })
            },
        })
        if (closed) { session?.destroy?.(); return }
        emit({ type: "model_ready", device: "chrome-built-in", dtype: null, loadMs: Math.round(now() - loadStart) })

        emit({ type: "streaming_start" })
        const genStart = now()
        const readDelta = createDeltaReader()
        const reader = (await session.promptStreaming(prompt, { signal: abort.signal })).getReader()
        let text = ""
        let firstTokenAt = null
        while (!closed) {
            const { done, value } = await reader.read()
            if (done) break
            const piece = readDelta(value)
            if (!piece) continue
            if (firstTokenAt === null) {
                firstTokenAt = now()
                emit({ type: "ttft", ms: Math.round(firstTokenAt - genStart) })
            }
            text += piece
            emit({ type: "token", text: piece })
        }
        if (closed) return

        // Chrome reports no token counts for the output; ~4 characters per token is the usual estimate.
        const totalTokens = Math.max(1, Math.round(text.length / 4))
        const genMs = Math.max(1, Math.round(now() - genStart))
        const streamMs = firstTokenAt === null ? genMs : Math.max(1, now() - firstTokenAt)
        emit({ type: "done", tps: Math.round((totalTokens / (streamMs / 1000)) * 10) / 10, totalTokens, genMs, promptTokens: null })
        try { session.destroy?.() } catch (_) { /* already gone */ }
        session = null
    }

    return engine
}

export const PROMPT_API_MODEL = MODEL_LABEL

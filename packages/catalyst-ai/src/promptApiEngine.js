// Chrome's built-in model (the Prompt API, `LanguageModel`) as a web engine, desktop Chrome only.
//
// useWebAI talks to its engine through a Worker-shaped message protocol (postMessage in; log / progress / model_ready /
// streaming_start / ttft / token / done / error out). The Prompt API cannot run in a Worker, so this module is that same
// protocol implemented on the main thread: useWebAI treats it as a worker and everything above it (streaming, metrics,
// cancel, errors) is unchanged. Chrome owns the model download; the page only passes consent by calling it from a click.
//
// Input: text, plus image and audio in the last user message (`{ type, value: Blob }` parts, declared up front in
// expectedInputs as the API requires). genConfig.responseConstraint (a JSON Schema or RegExp) is passed through, so a
// reply can be forced into a shape. Output is text only. Requirements are Chrome's: desktop, enough free disk (22 GB),
// a capable GPU or CPU; audio needs a GPU.

import { normalizeMessages } from "./contentParts.js"

const AVAILABILITY = ["unavailable", "downloadable", "downloading", "available"]
const MODEL_LABEL = "chrome-built-in"

/**
 * Chrome's built-in model is desktop only: not Chrome on Android or iOS, and not tablets. Live signals, not a model
 * guess: the client hint, the user agent, and iPadOS (which reports itself as a Mac but has a touch screen).
 */
export function isMobileBrowser(nav = globalThis.navigator) {
    if (!nav) return false
    if (nav.userAgentData?.mobile === true) return true
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || "")) return true
    return /Mac/i.test(nav.platform || "") && (nav.maxTouchPoints || 0) > 1
}

const DESKTOP_ONLY = "Chrome's built-in model works on desktop Chrome only, not on phones or tablets. On a phone use the on-device native engine or a cloud model."

/**
 * What a session is created for. The same object goes to availability() and create(): Chrome answers per modality and
 * language, so asking with one set of options and creating with another can disagree. English only for now (Chrome
 * documents en, ja, es, de, fr).
 */
export function expectedOptions({ image = false, audio = false } = {}) {
    return {
        expectedInputs: [{ type: "text", languages: ["en"] }, ...(image ? [{ type: "image" }] : []), ...(audio ? [{ type: "audio" }] : [])],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
    }
}

/** "unavailable" | "downloadable" | "downloading" | "available". Never throws: no API, an old Chrome or an error is "unavailable". */
export async function getPromptApiAvailability(api = globalThis.LanguageModel, options = expectedOptions(), nav = globalThis.navigator) {
    if (isMobileBrowser(nav) || !api || typeof api.availability !== "function") return "unavailable"
    try {
        const state = await api.availability(options)
        return AVAILABILITY.includes(state) ? state : "unavailable"
    } catch (_) {
        return "unavailable"
    }
}

const textOf = (content) =>
    typeof content === "string" ? content : Array.isArray(content) ? content.filter((p) => p?.type === "text").map((p) => p.text).join(" ") : ""

const base64ToBlob = (base64, mimeType) => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: mimeType })
}

/**
 * Chat messages -> what LanguageModel.create / promptStreaming take. System text and the earlier turns seed the session
 * (`initialPrompts`, text only); the last user message is the prompt: a string, or for image / audio an array of
 * messages with `{ type, value: Blob }` parts. A conversation that does not end on a user turn is refused.
 * `image` / `audio` say which modalities the session must be created for.
 */
export function toPromptApiInput(messages) {
    const turns = normalizeMessages(messages)
        .map((m) => ({ role: m.role, text: textOf(m.parts), media: m.parts.filter((p) => p.type !== "text") }))
        .filter((m) => m.text !== "" || m.media.length)
    const last = turns[turns.length - 1]
    if (!last || last.role !== "user") throw new Error("The last message must be from the user")
    const earlier = turns.slice(0, -1)
    if (earlier.some((m) => m.media.length)) throw new Error("Chrome's built-in model takes an image or audio clip in the last message only")
    const system = earlier.filter((m) => m.role === "system").map((m) => m.text).join("\n\n")
    const history = earlier.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: m.text }))
    const prompt = last.media.length
        ? [{
              role: "user",
              content: [
                  ...(last.text ? [{ type: "text", value: last.text }] : []),
                  ...last.media.map((p) => ({ type: p.type, value: base64ToBlob(p.base64, p.mimeType) })),
              ],
          }]
        : last.text
    return {
        initialPrompts: [...(system ? [{ role: "system", content: system }] : []), ...history],
        prompt,
        image: last.media.some((p) => p.type === "image"),
        audio: last.media.some((p) => p.type === "audio"),
    }
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
export function createPromptApiEngine({ api = globalThis.LanguageModel, now = () => performance.now(), nav = globalThis.navigator } = {}) {
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
            : `${err?.name && err.name !== "Error" ? err.name + ": " : ""}${err?.message || String(err)}`
        console.error("[catalyst-ai] Chrome Prompt API error:", err)
        emit({ type: "error", message })
    }

    async function run({ messages, genConfig }) {
        if (isMobileBrowser(nav)) throw new Error(DESKTOP_ONLY)
        if (!api || typeof api.create !== "function") throw new Error("Chrome's built-in model (Prompt API) is not available in this browser")
        const { initialPrompts, prompt, image, audio } = toPromptApiInput(messages)
        // One options object for the question and for the session: Chrome answers per modality and language.
        const options = expectedOptions({ image, audio })

        const availability = await getPromptApiAvailability(api, options, nav)
        if (availability === "unavailable") {
            const media = [image && "image", audio && "audio"].filter(Boolean).join(" and ")
            throw new Error(
                `Chrome's built-in model is unavailable on this device${media ? ` for ${media} input` : ""}. It needs desktop Chrome with enough free disk space (about 22 GB), a supported GPU or CPU${audio ? " (audio needs a GPU)" : ""}; chrome://on-device-internals shows why.`
            )
        }
        emit({ type: "log", msg: `[catalyst-ai] Chrome Prompt API: ${availability}${image || audio ? ` (${[image && "image", audio && "audio"].filter(Boolean).join(" + ")} input)` : ""}` })

        const loadStart = now()
        const log = (msg) => emit({ type: "log", msg: `[catalyst-ai] Chrome Prompt API: ${msg}` })
        log(`create() started (options: ${JSON.stringify(options)})`)
        // A download that moves no bytes is Chrome's problem (disk space, policy, network); say so instead of waiting silently.
        let lastLoaded = -1
        let lastChangeAt = now()
        const watchdog = setInterval(() => {
            const idleS = Math.round((now() - lastChangeAt) / 1000)
            if (idleS < 15) return
            // After the bytes arrive Chrome unpacks, verifies and loads the model, which can take minutes and sends no progress.
            if (lastLoaded >= 0.9) log(`download finished (${Math.round(lastLoaded * 100)}%), Chrome is installing and loading the model: ${idleS}s so far. This can take a few minutes; chrome://on-device-internals shows the state.`)
            else log(`no download progress for ${idleS}s (last ${lastLoaded < 0 ? "none" : Math.round(lastLoaded * 100) + "%"}). Check chrome://on-device-internals and chrome://components (Optimization Guide On Device Model), and free disk space.`)
        }, 15000)
        try {
            session = await api.create({
                ...options,
                ...(initialPrompts.length && { initialPrompts }),
                signal: abort.signal,
                monitor(monitor) {
                    monitor.addEventListener("downloadprogress", (e) => {
                        const loaded = e.loaded ?? 0
                        if (loaded !== lastLoaded) {
                            lastLoaded = loaded
                            lastChangeAt = now()
                            log(`download ${Math.round(loaded * 100)}%`)
                        }
                        emit({ type: "progress", file: MODEL_LABEL, percent: Math.round(loaded * 100), status: "downloading" })
                    })
                },
            })
        } catch (err) {
            log(`create() failed: ${err?.name || "Error"}: ${err?.message || err}`)
            throw err
        } finally {
            clearInterval(watchdog)
        }
        log(`session ready in ${Math.round(now() - loadStart)} ms`)
        if (closed) { session?.destroy?.(); return }
        emit({ type: "model_ready", device: "chrome-built-in", dtype: null, loadMs: Math.round(now() - loadStart) })

        emit({ type: "streaming_start" })
        const genStart = now()
        const readDelta = createDeltaReader()
        // A JSON Schema or RegExp makes Chrome constrain the reply to that shape (the reply is then a JSON string).
        const responseConstraint = genConfig?.responseConstraint
        const reader = (await session.promptStreaming(prompt, { signal: abort.signal, ...(responseConstraint && { responseConstraint }) })).getReader()
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
        log(`reply: ${text.length} chars${text ? ` · ${JSON.stringify(text.slice(0, 120))}` : ""}`)
        if (!text.trim()) throw new Error("Chrome's built-in model returned an empty reply (it may have declined the prompt). Try again or shorten the prompt.")

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

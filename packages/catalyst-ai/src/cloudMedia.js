// Server-side media handling for the cloud route. Clients can bypass the caps in contentParts.js, and this server
// spends paid API keys, so every media part is re-validated here before any provider is called. Four pure mappers turn
// the canonical parts ({type:"text"|"image"|"audio"}, media as base64 data URLs) into each provider API shape.
// Text-only requests keep their shape on the OpenAI mappers (they return the messages as they came in). The Gemini mappers
// always rebuild the request (`mapGeminiContents` filters and reshapes the messages; `mapGeminiInteractionsInput` keeps only
// the last user input), so do not assume every adapter preserves the original message list. Never log request bodies here.
//
// Formats confirmed against provider docs: OpenAI Chat Completions (image_url, input_audio wav/mp3 on audio models),
// OpenAI Responses (input_image), Gemini generateContent (inlineData), Gemini Interactions (typed image block),
// Anthropic Messages (image and PDF `document` blocks with base64 sources).
// NOT confirmed, so refused rather than guessed: audio on OpenAI Responses and on Gemini Interactions.
// A third canonical part, {type:"document", data:"data:application/pdf;base64,..."}, is a PDF; only providers whose
// capabilities say `document` take it, every other endpoint refuses it with unsupported-modality.

const DEFAULT_LIMITS = {
    imageBytes: 8 * 1024 * 1024,
    audioBytes: 10 * 1024 * 1024,
    maxImages: 4,
    maxAudio: 2,
    documentBytes: 10 * 1024 * 1024,
    maxDocuments: 2,
    // The JSON body limit (20 MB by default) is the real ceiling, and base64 inflates media by a third. Everything one
    // request carries has to fit under it, or the body parser would refuse a request that passed every per-type limit
    // before this validator ever ran. 14 MiB of media is about 18.7 MiB of base64, which leaves room for the JSON around it.
    totalBytes: 14 * 1024 * 1024,
}
const PDF_MIME = "application/pdf"

function mediaError(reason, message, extra = {}) {
    return Object.assign(new Error(message), { reason, ...extra })
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

function decodedBytes(base64) {
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
    return Math.floor((base64.length * 3) / 4) - padding
}

/**
 * true for base64 that can really decode to at least one byte. The character class alone accepts impossible values
 * ("A" has a length no base64 text can have, "=" is padding with nothing to pad), which would reach a provider.
 */
function isValidBase64(value) {
    if (typeof value !== "string" || value.length === 0 || !BASE64.test(value)) return false
    if (value.length % 4 === 1) return false
    if (value.includes("=") && value.length % 4 !== 0) return false
    return decodedBytes(value) > 0
}

function parseDataUrl(value) {
    if (typeof value !== "string" || !value.startsWith("data:")) return null
    const comma = value.indexOf(",")
    if (comma < 0) return null
    const header = value.slice(5, comma)
    if (!header.endsWith(";base64")) return null
    const mimeType = header.slice(0, -7)
    const base64 = value.slice(comma + 1)
    if (!mimeType || mimeType.includes(";") || !isValidBase64(base64)) return null
    return { mimeType, base64 }
}

/** true when any message carries array content, i.e. the request uses content parts at all. */
/**
 * true when any message has content other than a plain string. An array is the normal case; an object or any other value
 * counts too, so it goes through validateMessages (which refuses it) instead of skipping validation and reaching a provider.
 */
function usesParts(messages) {
    return Array.isArray(messages) && messages.some((m) => m?.content != null && typeof m.content !== "string")
}

/** true when any message carries an image or audio part. */
function hasMedia(messages) {
    return Array.isArray(messages) && messages.some((m) => Array.isArray(m?.content) && m.content.some((p) => p && (p.type === "image" || p.type === "audio" || p.type === "document")))
}

/** -> [{ role, parts: [{type:"text",text} | {type, mimeType, base64}] }]; throws a typed error on anything invalid. */
function validateMessages(messages, limits = DEFAULT_LIMITS) {
    let images = 0
    let audios = 0
    let documents = 0
    let total = 0
    return messages.map((message) => {
        const role = message?.role
        const raw = typeof message?.content === "string" ? [{ type: "text", text: message.content }] : message?.content
        if (!Array.isArray(raw) || raw.length === 0) throw mediaError("invalid-part", "Message content must be a string or a non-empty array of parts")
        const parts = raw.map((part) => {
            if (!part || typeof part !== "object") throw mediaError("invalid-part", "Each content part must be an object")
            if (part.type === "text") {
                if (typeof part.text !== "string") throw mediaError("invalid-part", "A text part needs a string `text`")
                return { type: "text", text: part.text }
            }
            if (part.type !== "image" && part.type !== "audio" && part.type !== "document") throw mediaError("invalid-part", `Unknown content part type "${String(part.type).slice(0, 20)}"`)
            if (role !== "user") throw mediaError("invalid-part", "Image, audio and document parts are only allowed in user messages")
            const parsed = parseDataUrl(part.data)
            if (!parsed) throw mediaError("invalid-part", `A ${part.type} part needs \`data\` as a base64 data URL`)
            const mimeOk = part.type === "document" ? parsed.mimeType === PDF_MIME : parsed.mimeType.startsWith(`${part.type}/`)
            if (!mimeOk) throw mediaError("invalid-part", `A ${part.type} part cannot carry ${parsed.mimeType}`)
            const cap = part.type === "image" ? limits.imageBytes : part.type === "audio" ? limits.audioBytes : limits.documentBytes
            if (decodedBytes(parsed.base64) > cap) throw mediaError("too-large", `${part.type} is too large (limit ${cap} bytes)`, { modality: part.type, limit: cap })
            total += decodedBytes(parsed.base64)
            if (total > limits.totalBytes) throw mediaError("too-large", `Images, audio and documents in one request are limited to ${limits.totalBytes} bytes in total`, { modality: part.type, limit: limits.totalBytes })
            if (part.type === "image") images++
            else if (part.type === "audio") audios++
            else documents++
            return { type: part.type, mimeType: parsed.mimeType, base64: parsed.base64 }
        })
        if (images > limits.maxImages) throw mediaError("too-many", `At most ${limits.maxImages} images per request`, { modality: "image", limit: limits.maxImages })
        if (audios > limits.maxAudio) throw mediaError("too-many", `At most ${limits.maxAudio} audio clips per request`, { modality: "audio", limit: limits.maxAudio })
        if (documents > limits.maxDocuments) throw mediaError("too-many", `At most ${limits.maxDocuments} documents per request`, { modality: "document", limit: limits.maxDocuments })
        return { role, parts }
    })
}

const IMAGE_MIMES = {
    openai: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    gemini: ["image/png", "image/jpeg", "image/webp"],
    anthropic: ["image/png", "image/jpeg", "image/webp", "image/gif"],
}
const OPENAI_AUDIO_MIMES = { "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/mpeg": "mp3", "audio/mp3": "mp3" }
// webm / mp4 / opus are what browsers and phones record; Gemini takes them as they are, so cloud calls need no conversion.
const GEMINI_AUDIO_MIMES = ["audio/wav", "audio/x-wav", "audio/mp3", "audio/mpeg", "audio/aiff", "audio/aac", "audio/ogg", "audio/flac", "audio/webm", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/opus"]

/** What a provider endpoint accepts. `audio: false` also covers "format not confirmed, refused for safety". */
function capabilitiesFor({ provider, stateful, model }) {
    if (provider === "openai") {
        return {
            image: true,
            imageMimes: IMAGE_MIMES.openai,
            // Audio input exists on Chat Completions audio models only; the Responses API format is unconfirmed.
            audio: !stateful && /audio/i.test(model || ""),
            audioMimes: Object.keys(OPENAI_AUDIO_MIMES),
            audioHint: "use wav or mp3",
        }
    }
    if (provider === "gemini") {
        return {
            image: true,
            imageMimes: IMAGE_MIMES.gemini,
            // Inline audio is documented for generateContent; the Interactions inline format is unconfirmed.
            audio: !stateful,
            audioMimes: GEMINI_AUDIO_MIMES,
            audioHint: "use wav, mp3, aiff, aac, ogg, flac, webm, mp4 or opus",
        }
    }
    if (provider === "anthropic") {
        // Messages API: image and PDF document blocks. No audio input on any Claude model.
        return { image: true, imageMimes: IMAGE_MIMES.anthropic, audio: false, audioMimes: [], document: true, documentMimes: [PDF_MIME] }
    }
    return { image: false, audio: false, imageMimes: [], audioMimes: [] }
}

/** Throws unless every media part in `normalized` is supported by `caps`. `label` names the endpoint in the message. */
function assertSupported(normalized, caps, label = "this endpoint") {
    for (const message of normalized) {
        for (const part of message.parts) {
            if (part.type === "text") continue
            if (!caps[part.type]) throw mediaError("unsupported-modality", `${label} does not support ${part.type} input`, { modality: part.type, engine: label })
            const allowed = (part.type === "image" ? caps.imageMimes : part.type === "audio" ? caps.audioMimes : caps.documentMimes) || []
            if (!allowed.includes(part.mimeType)) {
                const hint = part.type === "audio" && caps.audioHint ? ` (${caps.audioHint})` : ""
                throw mediaError("unsupported-format", `${label} does not accept ${part.mimeType}${hint}`, { modality: part.type, mimeType: part.mimeType })
            }
        }
    }
}

const dataUrlOf = (part) => `data:${part.mimeType};base64,${part.base64}`

function textOf(content) {
    if (typeof content === "string") return content
    return Array.isArray(content) ? content.filter((p) => p?.type === "text").map((p) => p.text).join(" ") : ""
}

function mapMessages(messages, mapPart) {
    if (!hasMedia(messages)) return messages
    const normalized = validateMessages(messages)
    return messages.map((message, i) => {
        const parts = normalized[i].parts
        if (parts.every((p) => p.type === "text")) return message
        return { ...message, content: parts.map(mapPart) }
    })
}

function mapOpenAIChat(messages) {
    return mapMessages(messages, (part) => {
        if (part.type === "text") return { type: "text", text: part.text }
        if (part.type === "image") return { type: "image_url", image_url: { url: dataUrlOf(part) } }
        return { type: "input_audio", input_audio: { data: part.base64, format: OPENAI_AUDIO_MIMES[part.mimeType] } }
    })
}

function mapOpenAIResponses(messages) {
    // The Responses API wants typed parts ("input_text", "input_image"), so every array-content message is normalised and
    // mapped, text-only arrays included. Only plain-string content is passed through unchanged.
    if (!messages.some((m) => Array.isArray(m?.content))) return messages
    const normalized = validateMessages(messages)
    return messages.map((message, i) => {
        if (typeof message?.content === "string") return message
        return {
            ...message,
            content: normalized[i].parts.map((part) =>
                part.type === "text" ? { type: "input_text", text: part.text } : { type: "input_image", image_url: dataUrlOf(part) }
            ),
        }
    })
}

function mapGeminiContents(messages) {
    const withoutSystem = messages.filter((m) => m.role !== "system")
    const normalized = hasMedia(messages) ? validateMessages(withoutSystem) : null
    return withoutSystem.map((m, i) => {
        const role = m.role === "assistant" ? "model" : "user"
        if (!normalized) return { role, parts: [{ text: textOf(m.content) }] }
        return {
            role,
            parts: normalized[i].parts.map((p) => (p.type === "text" ? { text: p.text } : { inlineData: { mimeType: p.mimeType, data: p.base64 } })),
        }
    })
}

/** Interactions API `input`: the last user message as a plain string, or typed blocks when it carries media. */
function mapGeminiInteractionsInput(messages) {
    const last = [...messages].reverse().find((m) => m.role === "user")
    if (!last) return ""
    if (!hasMedia([last])) return textOf(last.content)
    return validateMessages([last])[0].parts.map((p) => {
        if (p.type === "text") return { type: "text", text: p.text }
        return { type: p.type, mime_type: p.mimeType, data: p.base64 }
    })
}

/**
 * Anthropic Messages shape: { system, messages }. System messages are lifted out (the API takes `system` separately);
 * text-only turns stay plain strings, turns with media become typed blocks with base64 sources. Media is placed before
 * the text of its turn, which is the order Anthropic recommends for images and documents.
 */
function mapAnthropicMessages(messages) {
    const system = messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).filter(Boolean).join("\n\n")
    const turns = messages.filter((m) => m.role !== "system")
    const normalized = hasMedia(turns) ? validateMessages(turns) : null
    const mapped = turns.map((m, i) => {
        const role = m.role === "assistant" ? "assistant" : "user"
        if (!normalized || normalized[i].parts.every((p) => p.type === "text")) return { role, content: textOf(m.content) }
        const parts = normalized[i].parts
        const blocks = parts.map((p) => {
            if (p.type === "text") return { type: "text", text: p.text }
            return { type: p.type, source: { type: "base64", media_type: p.mimeType, data: p.base64 } }
        })
        return { role, content: [...blocks.filter((b) => b.type !== "text"), ...blocks.filter((b) => b.type === "text")] }
    })
    return { system: system || undefined, messages: mapped }
}

module.exports = {
    DEFAULT_LIMITS,
    isValidBase64,
    BASE64,
    decodedBytes,
    usesParts,
    hasMedia,
    textOf,
    validateMessages,
    capabilitiesFor,
    assertSupported,
    mapOpenAIChat,
    mapOpenAIResponses,
    mapGeminiContents,
    mapGeminiInteractionsInput,
    mapAnthropicMessages,
}

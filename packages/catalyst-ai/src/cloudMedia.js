// Server-side media handling for the cloud route. Clients can bypass the caps in contentParts.js, and this server
// spends paid API keys, so every media part is re-validated here before any provider is called. Four pure mappers turn
// the canonical parts ({type:"text"|"image"|"audio"}, media as base64 data URLs) into each provider API shape.
// Text-only requests are returned exactly as they came in. Never log request bodies from this module.
//
// Formats confirmed against provider docs: OpenAI Chat Completions (image_url, input_audio wav/mp3 on audio models),
// OpenAI Responses (input_image), Gemini generateContent (inlineData), Gemini Interactions (typed image block).
// NOT confirmed, so refused rather than guessed: audio on OpenAI Responses and on Gemini Interactions.

const DEFAULT_LIMITS = {
    imageBytes: 8 * 1024 * 1024,
    audioBytes: 10 * 1024 * 1024,
    maxImages: 4,
    maxAudio: 2,
}

function mediaError(reason, message, extra = {}) {
    return Object.assign(new Error(message), { reason, ...extra })
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

function decodedBytes(base64) {
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
    return Math.floor((base64.length * 3) / 4) - padding
}

function parseDataUrl(value) {
    if (typeof value !== "string" || !value.startsWith("data:")) return null
    const comma = value.indexOf(",")
    if (comma < 0) return null
    const header = value.slice(5, comma)
    if (!header.endsWith(";base64")) return null
    const mimeType = header.slice(0, -7)
    const base64 = value.slice(comma + 1)
    if (!mimeType || mimeType.includes(";") || !BASE64.test(base64)) return null
    return { mimeType, base64 }
}

/** true when any message carries array content, i.e. the request uses content parts at all. */
function usesParts(messages) {
    return Array.isArray(messages) && messages.some((m) => Array.isArray(m?.content))
}

/** true when any message carries an image or audio part. */
function hasMedia(messages) {
    return Array.isArray(messages) && messages.some((m) => Array.isArray(m?.content) && m.content.some((p) => p && (p.type === "image" || p.type === "audio")))
}

/** -> [{ role, parts: [{type:"text",text} | {type, mimeType, base64}] }]; throws a typed error on anything invalid. */
function validateMessages(messages, limits = DEFAULT_LIMITS) {
    let images = 0
    let audios = 0
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
            if (part.type !== "image" && part.type !== "audio") throw mediaError("invalid-part", `Unknown content part type "${String(part.type).slice(0, 20)}"`)
            if (role !== "user") throw mediaError("invalid-part", "Image and audio are only allowed in user messages")
            const parsed = parseDataUrl(part.data)
            if (!parsed) throw mediaError("invalid-part", `A ${part.type} part needs \`data\` as a base64 data URL`)
            if (!parsed.mimeType.startsWith(`${part.type}/`)) throw mediaError("invalid-part", `A ${part.type} part cannot carry ${parsed.mimeType}`)
            const cap = part.type === "image" ? limits.imageBytes : limits.audioBytes
            if (decodedBytes(parsed.base64) > cap) throw mediaError("too-large", `${part.type} is too large (limit ${cap} bytes)`, { modality: part.type, limit: cap })
            if (part.type === "image") images++
            else audios++
            return { type: part.type, mimeType: parsed.mimeType, base64: parsed.base64 }
        })
        if (images > limits.maxImages) throw mediaError("too-many", `At most ${limits.maxImages} images per request`, { modality: "image", limit: limits.maxImages })
        if (audios > limits.maxAudio) throw mediaError("too-many", `At most ${limits.maxAudio} audio clips per request`, { modality: "audio", limit: limits.maxAudio })
        return { role, parts }
    })
}

const IMAGE_MIMES = {
    openai: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    gemini: ["image/png", "image/jpeg", "image/webp"],
}
const OPENAI_AUDIO_MIMES = { "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/mpeg": "mp3", "audio/mp3": "mp3" }
const GEMINI_AUDIO_MIMES = ["audio/wav", "audio/x-wav", "audio/mp3", "audio/mpeg", "audio/aiff", "audio/aac", "audio/ogg", "audio/flac"]

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
            audioHint: "use wav, mp3, aiff, aac, ogg or flac",
        }
    }
    return { image: false, audio: false, imageMimes: [], audioMimes: [] }
}

/** Throws unless every media part in `normalized` is supported by `caps`. `label` names the endpoint in the message. */
function assertSupported(normalized, caps, label = "this endpoint") {
    for (const message of normalized) {
        for (const part of message.parts) {
            if (part.type === "text") continue
            if (!caps[part.type]) throw mediaError("unsupported-modality", `${label} does not support ${part.type} input`, { modality: part.type, engine: label })
            const allowed = part.type === "image" ? caps.imageMimes : caps.audioMimes
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
    return mapMessages(messages, (part) => {
        if (part.type === "text") return { type: "input_text", text: part.text }
        return { type: "input_image", image_url: dataUrlOf(part) }
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

module.exports = {
    DEFAULT_LIMITS,
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
}

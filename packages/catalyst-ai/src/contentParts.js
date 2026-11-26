// Multimodal input for useAI. Pure functions between `messages` and what an engine receives.
//
// A message's `content` is a string (as always) or an array of parts:
//   { type: "text", text }  |  { type: "image", data: "data:image/...;base64,..." }  |  { type: "audio", data: "data:audio/...;base64,..." }
// Media is never silently dropped: an engine that cannot take a modality gets a typed error instead.

export const DEFAULT_LIMITS = {
    imageBytes: 8 * 1024 * 1024,
    audioBytes: 20 * 1024 * 1024,
    maxImages: 4,
}

const MEDIA_TYPES = ["image", "audio"]
const DATA_URL = /^data:([^;,]+);base64,(.*)$/s

function inputError(reason, message, extra = {}) {
    return Object.assign(new Error(message), { reason, ...extra })
}

function decodedBytes(base64) {
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
    return Math.floor((base64.length * 3) / 4) - padding
}

function normalizePart(part, limits) {
    if (!part || typeof part !== "object") throw inputError("invalid-part", "Each content part must be an object")
    if (part.type === "text") {
        if (typeof part.text !== "string") throw inputError("invalid-part", "A text part needs a string `text`")
        return { type: "text", text: part.text }
    }
    if (!MEDIA_TYPES.includes(part.type)) {
        throw inputError("invalid-part", `Unknown content part type "${part.type}" (expected text, image or audio)`)
    }
    const match = typeof part.data === "string" ? DATA_URL.exec(part.data) : null
    if (!match) throw inputError("invalid-part", `A ${part.type} part needs \`data\` as a base64 data URL`)
    const [, mimeType, base64] = match
    if (!mimeType.startsWith(`${part.type}/`)) {
        throw inputError("invalid-part", `A ${part.type} part cannot carry ${mimeType}`)
    }
    const cap = part.type === "image" ? limits.imageBytes : limits.audioBytes
    if (decodedBytes(base64) > cap) {
        throw inputError("too-large", `${part.type} is too large (limit ${cap} bytes)`, { modality: part.type, limit: cap })
    }
    return { type: part.type, mimeType, base64 }
}

/** -> [{ role, parts: [{type:"text",text} | {type, mimeType, base64}] }]; validates types, data URLs and size limits. */
export function normalizeMessages(messages, limits = DEFAULT_LIMITS) {
    let images = 0
    return messages.map((message) => {
        const raw = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content
        if (!Array.isArray(raw) || raw.length === 0) {
            throw inputError("invalid-part", "Message content must be a string or a non-empty array of parts")
        }
        const parts = raw.map((part) => normalizePart(part, limits))
        images += parts.filter((p) => p.type === "image").length
        if (images > limits.maxImages) {
            throw inputError("too-many", `At most ${limits.maxImages} images per request`, { modality: "image", limit: limits.maxImages })
        }
        return { role: message.role, parts }
    })
}

/** Set of modalities used across the messages; always includes "text" only when text is present. */
export function getModalities(messages) {
    const set = new Set()
    for (const message of normalizeMessages(messages)) for (const part of message.parts) set.add(part.type)
    return set
}

/** Throws unless every requested modality is supported. `caps` is e.g. { text: true, image: true }. */
export function assertEngineSupports(modalities, caps, engine = "this engine") {
    for (const modality of modalities) {
        if (!caps?.[modality]) {
            throw inputError("unsupported-modality", `${engine} does not support ${modality} input`, { modality, engine })
        }
    }
}

function textOf(parts) {
    return parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join(" ")
}

function toPrompt(normalized) {
    return normalized.map((m) => `${m.role}: ${textOf(m.parts)}`).join("\n")
}

/** The `role: content` prompt string text-only engines get. Refuses to flatten media. */
export function toLegacyPrompt(messages) {
    const normalized = normalizeMessages(messages)
    if (normalized.some((m) => m.parts.some((p) => p.type !== "text"))) {
        throw inputError("unsupported-modality", "Media cannot be flattened into a text prompt")
    }
    return toPrompt(normalized)
}

/**
 * Request body for the native local server. Text-only stays {prompt, genConfig}.
 * Media rides inside genConfig.inputParts (ordered [{type, mimeType, base64}]) because catalyst-core's servers
 * forward genConfig to the plugin verbatim: no core change, and a core/plugin version mismatch cannot silently
 * drop an image. The text of every message stays in `prompt` (system prompt is prefixed server-side).
 */
export function buildNativeBody(messages, genConfig, { conversationId } = {}) {
    const normalized = normalizeMessages(messages)
    const media = normalized.flatMap((m) => m.parts.filter((p) => p.type !== "text"))
    const body = { prompt: toPrompt(normalized), genConfig: media.length ? { ...genConfig, inputParts: media } : genConfig }
    if (conversationId) body.conversationId = conversationId
    return body
}

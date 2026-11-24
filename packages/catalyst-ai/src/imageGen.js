// image.generate on the cloud route: request validation and the OpenAI / Gemini image adapters.
// Server-side only (CJS, loaded by route.js). Models come from config (`imageModel`), never hardcoded here, because
// provider image model names change often. Images come back as base64 in JSON; we never fetch or proxy provider URLs.

const MAX_PROMPT_CHARS = 4000
const MAX_IMAGES = 4
// WxH or "auto". Kept strict because the value is forwarded to the provider.
const SIZE_RE = /^(auto|\d{3,4}x\d{3,4})$/
const MIME_RE = /^image\/(png|jpeg|webp)$/
// Provider image payloads are large; refuse anything past this many base64 characters per image (~24 MB of bytes).
const MAX_B64_CHARS = 32 * 1024 * 1024

/** -> error string, or null when the body is valid. `n` is checked per provider by the adapters. */
function validateImageRequest(body) {
    const { prompt, n, size } = body ?? {}
    if (typeof prompt !== "string" || prompt.trim().length === 0) return "prompt must be a non-empty string"
    if (prompt.length > MAX_PROMPT_CHARS) return `prompt must be at most ${MAX_PROMPT_CHARS} characters`
    if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > MAX_IMAGES)) return `n must be an integer from 1 to ${MAX_IMAGES}`
    if (size !== undefined && (typeof size !== "string" || !SIZE_RE.test(size))) return 'size must be "auto" or WIDTHxHEIGHT, e.g. "1024x1024"'
    return null
}

function cleanImage(mimeType, data) {
    if (typeof data !== "string" || data.length === 0) return null
    if (data.length > MAX_B64_CHARS) return null
    return { mimeType: MIME_RE.test(mimeType) ? mimeType : "image/png", data }
}

function normalizeOpenAIImageUsage(usage, model, count) {
    return {
        model,
        images: count,
        promptTokens: usage?.input_tokens ?? 0,
        completionTokens: usage?.output_tokens ?? 0,
    }
}

function normalizeGeminiImageUsage(usageMetadata, model, count) {
    return {
        model,
        images: count,
        promptTokens: usageMetadata?.promptTokenCount ?? 0,
        completionTokens: usageMetadata?.candidatesTokenCount ?? 0,
    }
}

/** Builds the adapters around route.js's throwProviderError so provider failures keep the AI-000 shape. */
function createImageAdapters({ throwProviderError, createError }) {
    async function openaiImage({ apiKey, model, prompt, n = 1, size }) {
        const response = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model, prompt, n, ...(size && { size }) }),
        })
        if (!response.ok) await throwProviderError("openai", response)
        const data = await response.json()
        const images = (data.data ?? []).map((d) => cleanImage("image/png", d.b64_json)).filter(Boolean)
        if (images.length === 0) throw createError("openai returned no image data (only base64 results are supported)")
        return { images, usage: normalizeOpenAIImageUsage(data.usage, model, images.length) }
    }

    async function geminiImage({ apiKey, model, prompt, n = 1 }) {
        // generateContent returns one image per call; ask for more via the caller rather than looping paid calls here.
        if (n > 1) throw createError("gemini image generation returns one image per request; use n: 1")
        // nosemgrep: javascript.express.security.express-phantom-injection.express-phantom-injection - model is validated against MODEL_NAME_RE before the handler calls this; the host is a fixed literal.
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
            }),
        })
        if (!response.ok) await throwProviderError("gemini", response)
        const data = await response.json()
        const parts = data.candidates?.[0]?.content?.parts ?? []
        const images = parts.map((p) => cleanImage(p.inlineData?.mimeType, p.inlineData?.data)).filter(Boolean)
        if (images.length === 0) {
            const text = parts.map((p) => p.text).filter(Boolean).join(" ").slice(0, 200)
            throw createError(`gemini returned no image${text ? `: ${text}` : ""}`)
        }
        return { images, usage: normalizeGeminiImageUsage(data.usageMetadata, model, images.length) }
    }

    return { openai: openaiImage, gemini: geminiImage }
}

module.exports = { validateImageRequest, createImageAdapters, normalizeOpenAIImageUsage, normalizeGeminiImageUsage, MAX_PROMPT_CHARS, MAX_IMAGES }

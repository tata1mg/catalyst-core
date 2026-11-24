// speech.synthesize (text to audio) on the cloud route: request validation and the OpenAI / Gemini speech adapters.
// Server-side only (CJS, loaded by route.js). Models come from config (`speechModel`) or the request, never hardcoded
// here and never the chat `defaultModel`. Audio comes back as base64 in JSON.

const MAX_TEXT_CHARS = 4000
const VOICE_RE = /^[a-zA-Z0-9._-]+$/
const FORMATS = ["mp3", "wav", "opus"]
const OPENAI_MIME = { mp3: "audio/mpeg", wav: "audio/wav", opus: "audio/ogg" }
const DEFAULT_OPENAI_VOICE = "alloy"
const DEFAULT_GEMINI_VOICE = "Kore"
// Refuse anything past this many bytes of audio (~24 MB); base64 of that is 32 MB, same ceiling as imageGen.
const MAX_AUDIO_BYTES = 24 * 1024 * 1024
const MAX_B64_CHARS = 32 * 1024 * 1024

/** -> error string, or null when the body is valid. */
function validateSpeechRequest(body) {
    const { text, voice, format } = body ?? {}
    if (typeof text !== "string" || text.trim().length === 0) return "text must be a non-empty string"
    if (text.length > MAX_TEXT_CHARS) return `text must be at most ${MAX_TEXT_CHARS} characters`
    if (voice !== undefined && (typeof voice !== "string" || !VOICE_RE.test(voice))) return "voice contains invalid characters"
    if (format !== undefined && !FORMATS.includes(format)) return `format must be one of: ${FORMATS.join(", ")}`
    return null
}

/** Provider-specific checks, run by the route before an adapter is called, so a client mistake is a 400 (AI-003). -> error string or null. */
function validateProviderRequest(provider, body) {
    if (provider === "gemini" && body?.format !== undefined && body.format !== "wav") {
        return "gemini speech is returned as wav: omit format or use wav"
    }
    return null
}

/** Wraps raw 16-bit little-endian PCM in a 44-byte RIFF/WAVE header so browsers can play it. -> Buffer. */
function pcmToWav(pcm, { sampleRate = 24000, channels = 1, bitsPerSample = 16 } = {}) {
    const byteRate = (sampleRate * channels * bitsPerSample) / 8
    const blockAlign = (channels * bitsPerSample) / 8
    const header = Buffer.alloc(44)
    header.write("RIFF", 0, "ascii")
    header.writeUInt32LE(36 + pcm.length, 4)
    header.write("WAVE", 8, "ascii")
    header.write("fmt ", 12, "ascii")
    header.writeUInt32LE(16, 16) // fmt chunk size
    header.writeUInt16LE(1, 20) // PCM
    header.writeUInt16LE(channels, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(byteRate, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(bitsPerSample, 34)
    header.write("data", 36, "ascii")
    header.writeUInt32LE(pcm.length, 40)
    return Buffer.concat([header, pcm])
}

function sampleRateOf(mimeType) {
    const m = /rate=(\d{4,6})/.exec(mimeType || "")
    return m ? Number(m[1]) : 24000
}

function normalizeSpeechUsage(model, characters, usageMetadata) {
    return {
        model,
        characters,
        promptTokens: usageMetadata?.promptTokenCount ?? 0,
        completionTokens: usageMetadata?.candidatesTokenCount ?? 0,
    }
}

/** Builds the adapters around route.js's throwProviderError so provider failures keep the AI-000 shape. */
function createSpeechAdapters({ throwProviderError, createError }) {
    async function openaiSpeech({ apiKey, model, text, voice, format }) {
        const fmt = format || "mp3"
        const response = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model, input: text, voice: voice || DEFAULT_OPENAI_VOICE, response_format: fmt }),
        })
        if (!response.ok) await throwProviderError("openai", response)
        const declared = Number(response.headers?.get?.("content-length"))
        if (declared > MAX_AUDIO_BYTES) throw createError("openai returned audio larger than the allowed size")
        const bytes = Buffer.from(await response.arrayBuffer())
        if (bytes.length === 0) throw createError("openai returned no audio data")
        if (bytes.length > MAX_AUDIO_BYTES) throw createError("openai returned audio larger than the allowed size")
        return {
            audio: { mimeType: OPENAI_MIME[fmt], data: bytes.toString("base64") },
            usage: normalizeSpeechUsage(model, text.length),
        }
    }

    async function geminiSpeech({ apiKey, model, text, voice, format }) {
        // Gemini TTS returns raw PCM, which we wrap as WAV; other containers would need server-side transcoding.
        if (format && format !== "wav") throw createError("gemini speech is returned as wav; omit format or use wav")
        // nosemgrep: javascript.express.security.express-phantom-injection.express-phantom-injection - model is validated against MODEL_NAME_RE before the handler calls this; the host is a fixed literal.
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text }] }],
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || DEFAULT_GEMINI_VOICE } } },
                },
            }),
        })
        if (!response.ok) await throwProviderError("gemini", response)
        const data = await response.json()
        const parts = data.candidates?.[0]?.content?.parts ?? []
        const inline = parts.find((p) => typeof p.inlineData?.data === "string" && p.inlineData.data.length > 0)?.inlineData
        if (!inline) {
            const note = parts.map((p) => p.text).filter(Boolean).join(" ").slice(0, 200)
            throw createError(`gemini returned no audio${note ? `: ${note}` : ""}`)
        }
        if (inline.data.length > MAX_B64_CHARS) throw createError("gemini returned audio larger than the allowed size")
        const mime = String(inline.mimeType || "")
        // Already a playable container: pass through. Otherwise (audio/L16 PCM, the documented shape) wrap it.
        const playable = /^audio\/(wav|x-wav|wave|mpeg|mp3|ogg)\b/i.test(mime)
        const audio = playable
            ? { mimeType: mime.split(";")[0].toLowerCase(), data: inline.data }
            : { mimeType: "audio/wav", data: pcmToWav(Buffer.from(inline.data, "base64"), { sampleRate: sampleRateOf(mime) }).toString("base64") }
        return { audio, usage: normalizeSpeechUsage(model, text.length, data.usageMetadata) }
    }

    return { openai: openaiSpeech, gemini: geminiSpeech }
}

module.exports = { validateSpeechRequest, validateProviderRequest, createSpeechAdapters, pcmToWav, normalizeSpeechUsage, MAX_TEXT_CHARS, FORMATS }

const express = require("express")
const media = require("./cloudMedia")

const router = express.Router()

// catalyst-core/errors is ESM-only; route.js stays CJS (loaded via require.resolve
// in expressServer.js), so we load it lazily via dynamic import and cache the module.
let errorsModulePromise = null
function loadErrors() {
    if (!errorsModulePromise) errorsModulePromise = import("catalyst-core/errors")
    return errorsModulePromise
}

// Hard ceiling on how long a single /stream request may run upstream — protects
// against a hung provider connection holding a request open indefinitely.
const STREAM_TIMEOUT_MS = 120_000

// ─── helpers ────────────────────────────────────────────────────────────────

function getAIConfig() {
    try {
        return JSON.parse(process.env.AI_CONFIG || "{}")
    } catch {
        return {}
    }
}

function isAIEnabled() {
    return getAIConfig()?.enabled === true
}

function getProviderConfig(provider) {
    const cfg = getAIConfig()?.providers?.[provider]
    if (!cfg || !cfg.apiKey) return null
    return cfg
}

// Gemini and OpenAI model names are alphanumeric with dots/hyphens/colons/underscores
// (e.g. "gemini-2.0-flash", "gpt-4o-mini"). Gemini's model is interpolated directly into
// the request URL path (see geminiStream/geminiGenerate), so it must be constrained to
// this charset before use — otherwise req.body.model could inject "/", "?", or other
// URL-structural characters into the request sent to Google's API. (A bare ".." passes
// this charset check, but without a "/" it can't traverse a URL path segment.)
const MODEL_NAME_RE = /^[a-zA-Z0-9._:-]+$/

// Returns an error string if the request body is invalid, otherwise null.
function validateRequestBody(req, cfg, provider) {
    const { messages, model } = req.body ?? {}
    if (!Array.isArray(messages) || messages.length === 0) return "messages must be a non-empty array"
    const resolvedModel = model || cfg.defaultModel
    if (!resolvedModel) return "no model specified and provider has no defaultModel configured"
    if (typeof resolvedModel !== "string" || !MODEL_NAME_RE.test(resolvedModel)) return "model contains invalid characters"
    // Image/audio parts: re-validated server-side (client caps can be bypassed) and checked against what this
    // provider endpoint really accepts, before any paid call. Requests without array content skip this entirely.
    if (provider && media.usesParts(messages)) {
        try {
            const normalized = media.validateMessages(messages)
            const caps = media.capabilitiesFor({ provider, stateful: "conversationId" in req.body, model: resolvedModel })
            media.assertSupported(normalized, caps, `${provider}/${resolvedModel}`)
        } catch (err) {
            if (err.reason) return `${err.reason}: ${err.message}`
            throw err
        }
    }
    return null
}

function sseHeaders(res) {
    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")
    res.setHeader("X-Accel-Buffering", "no")
    res.flushHeaders()
}

// Wraps a non-ok provider response as a CatalystError (AI-000) and throws it,
// preserving the upstream status/body verbatim as `cause`.
async function throwProviderError(provider, response) {
    const { wrapProviderError } = await loadErrors()
    throw wrapProviderError(provider, response.status, await response.text())
}

// ─── usage normalization ──────────────────────────────────────────────────────
// Each provider/API reports token usage under different field names. Normalize
// to a common shape so the client doesn't need per-provider parsing logic.

// NOTE: completionTokens is normalized to mean "visible output only" across all
// providers/APIs. OpenAI's completion_tokens/output_tokens *include* reasoning
// tokens (reasoning_tokens is a subset, not additive) — Gemini's
// candidatesTokenCount *excludes* thoughts (thoughtsTokenCount is additive).
// Subtracting reasoning out here keeps totalTokens = prompt + completion +
// reasoning valid for every provider downstream.

// audioTokens is a subset of promptTokens that is billed at a different rate. The key is only present when audio was
// actually used, so text-only usage payloads stay exactly as they were.
function audioTokensField(count) {
    return typeof count === "number" && count > 0 ? { audioTokens: count } : {}
}

function normalizeOpenAIChatUsage(usage, model) {
    if (!usage) return null
    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0
    return {
        model,
        promptTokens: usage.prompt_tokens ?? 0,
        cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        completionTokens: (usage.completion_tokens ?? 0) - reasoningTokens,
        reasoningTokens,
        ...audioTokensField(usage.prompt_tokens_details?.audio_tokens),
    }
}

function normalizeOpenAIResponsesUsage(usage, model) {
    if (!usage) return null
    const reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? 0
    return {
        model,
        promptTokens: usage.input_tokens ?? 0,
        cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
        completionTokens: (usage.output_tokens ?? 0) - reasoningTokens,
        reasoningTokens,
        ...audioTokensField(usage.input_tokens_details?.audio_tokens),
    }
}

// stateless generateContent / streamGenerateContent
function normalizeGeminiUsage(usageMetadata, model) {
    if (!usageMetadata) return null
    return {
        model,
        promptTokens: usageMetadata.promptTokenCount ?? 0,
        cachedTokens: usageMetadata.cachedContentTokenCount ?? 0,
        completionTokens: usageMetadata.candidatesTokenCount ?? 0,
        reasoningTokens: usageMetadata.thoughtsTokenCount ?? 0,
        ...audioTokensField(
            usageMetadata.promptTokensDetails?.filter((d) => d.modality === "AUDIO").reduce((sum, d) => sum + (d.tokenCount ?? 0), 0)
        ),
    }
}

// stateful Interactions API — different field names entirely (verified live against v1beta/interactions)
function normalizeGeminiInteractionUsage(usage, model) {
    if (!usage) return null
    return {
        model,
        promptTokens: usage.total_input_tokens ?? 0,
        cachedTokens: usage.total_cached_tokens ?? 0,
        completionTokens: usage.total_output_tokens ?? 0,
        reasoningTokens: usage.total_thought_tokens ?? 0,
    }
}

// ─── OpenAI adapters ─────────────────────────────────────────────────────────

async function openaiStream({ apiKey, model, messages, genConfig, conversationId, stateful, res, signal }) {
    if (stateful) {
        // stateful: Responses API
        const endpoint = "https://api.openai.com/v1/responses"
        const body = {
            model,
            input: media.mapOpenAIResponses(messages),
            stream: true,
            ...(conversationId && { previous_response_id: conversationId }),
            ...(genConfig?.maxTokens && { max_output_tokens: genConfig.maxTokens }),
            ...(genConfig?.temperature != null && { temperature: genConfig.temperature }),
            ...(genConfig?.topP != null && { top_p: genConfig.topP }),
            context_management: [{ type: "compaction", compact_threshold: 80000 }],
        }

        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal,
        })
        if (!response.ok) await throwProviderError("openai", response)

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let sentConversationId = false

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() || ""
            for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed || !trimmed.startsWith("data:")) continue
                const payload = trimmed.slice(5).trim()
                if (payload === "[DONE]") { res.write("data: [DONE]\n\n"); res.end(); return }
                try {
                    const parsed = JSON.parse(payload)
                    if (!sentConversationId && parsed.type === "response.created" && parsed.response?.id) {
                        res.write(`data: ${JSON.stringify({ conversationId: parsed.response.id })}\n\n`)
                        sentConversationId = true
                    }
                    if (parsed.type === "response.output_text.delta" && parsed.delta != null) {
                        res.write(`data: ${JSON.stringify({ token: parsed.delta })}\n\n`)
                    }
                    if (parsed.type === "response.completed" && parsed.response?.usage) {
                        const usage = normalizeOpenAIResponsesUsage(parsed.response.usage, model)
                        if (usage) res.write(`data: ${JSON.stringify({ usage })}\n\n`)
                    }
                } catch (_) {}
            }
        }
    } else {
        // stateless: Chat Completions
        const endpoint = "https://api.openai.com/v1/chat/completions"
        const body = {
            model,
            messages: media.mapOpenAIChat(messages),
            stream: true,
            stream_options: { include_usage: true },
            ...(genConfig?.maxTokens && { max_tokens: genConfig.maxTokens }),
            ...(genConfig?.temperature != null && { temperature: genConfig.temperature }),
            ...(genConfig?.topP != null && { top_p: genConfig.topP }),
        }

        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal,
        })
        if (!response.ok) await throwProviderError("openai", response)

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() || ""
            for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed || !trimmed.startsWith("data:")) continue
                const payload = trimmed.slice(5).trim()
                if (payload === "[DONE]") { res.write("data: [DONE]\n\n"); res.end(); return }
                try {
                    const parsed = JSON.parse(payload)
                    const token = parsed.choices?.[0]?.delta?.content
                    if (token != null) res.write(`data: ${JSON.stringify({ token })}\n\n`)
                    if (parsed.usage) {
                        const usage = normalizeOpenAIChatUsage(parsed.usage, model)
                        if (usage) res.write(`data: ${JSON.stringify({ usage })}\n\n`)
                    }
                } catch (_) {}
            }
        }
    }

    res.write("data: [DONE]\n\n")
    res.end()
}

async function openaiGenerate({ apiKey, model, messages, genConfig, conversationId, stateful }) {
    if (stateful) {
        const endpoint = "https://api.openai.com/v1/responses"
        const body = {
            model,
            input: media.mapOpenAIResponses(messages),
            stream: false,
            ...(conversationId && { previous_response_id: conversationId }),
            ...(genConfig?.maxTokens && { max_output_tokens: genConfig.maxTokens }),
            ...(genConfig?.temperature != null && { temperature: genConfig.temperature }),
            ...(genConfig?.topP != null && { top_p: genConfig.topP }),
        }
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
        })
        if (!response.ok) await throwProviderError("openai", response)
        const data = await response.json()
        const output = data.output?.find((o) => o.type === "message")?.content?.find((c) => c.type === "output_text")?.text ?? ""
        return { output, conversationId: data.id ?? null, usage: normalizeOpenAIResponsesUsage(data.usage, model) }
    } else {
        const endpoint = "https://api.openai.com/v1/chat/completions"
        const body = {
            model,
            messages: media.mapOpenAIChat(messages),
            stream: false,
            ...(genConfig?.maxTokens && { max_tokens: genConfig.maxTokens }),
            ...(genConfig?.temperature != null && { temperature: genConfig.temperature }),
            ...(genConfig?.topP != null && { top_p: genConfig.topP }),
        }
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
        })
        if (!response.ok) await throwProviderError("openai", response)
        const data = await response.json()
        return { output: data.choices?.[0]?.message?.content ?? "", conversationId: null, usage: normalizeOpenAIChatUsage(data.usage, model) }
    }
}

// ─── Gemini adapters ──────────────────────────────────────────────────────────

function toGeminiContents(messages) {
    return media.mapGeminiContents(messages)
}

function geminiSystemInstruction(messages) {
    const sys = messages.find((m) => m.role === "system")
    return sys ? { parts: [{ text: media.textOf(sys.content) }] } : undefined
}

// Interactions API (v1beta/interactions) takes system_instruction as a plain string —
// unlike generateContent/streamGenerateContent, which need { parts: [{ text }] }.
// Confirmed via live 400: "Expected string, unexpected character: '{'"
function geminiInteractionsSystemInstruction(messages) {
    const sys = messages.find((m) => m.role === "system")
    return sys ? media.textOf(sys.content) : undefined
}

async function geminiStream({ apiKey, model, messages, genConfig, conversationId, stateful, res, signal }) {
    if (stateful) {
        // stateful: Interactions API (v1beta2)
        const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions"
        const sys = geminiInteractionsSystemInstruction(messages)
        const lastUserMsg = media.mapGeminiInteractionsInput(messages)
        const body = {
            model: `models/${model}`,
            input: lastUserMsg,
            stream: true,
            ...(conversationId && { previous_interaction_id: conversationId }),
            ...(sys && { system_instruction: sys }),
            generation_config: {
                ...(genConfig?.maxTokens && { max_output_tokens: genConfig.maxTokens }),
                ...(genConfig?.temperature != null && { temperature: genConfig.temperature }),
                ...(genConfig?.topP != null && { top_p: genConfig.topP }),
            },
        }

        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(body),
            signal,
        })
        if (!response.ok) await throwProviderError("gemini", response)

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() || ""
            for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed || !trimmed.startsWith("data:")) continue
                const payload = trimmed.slice(5).trim()
                if (payload === "[DONE]") { res.write("data: [DONE]\n\n"); res.end(); return }
                try {
                    const parsed = JSON.parse(payload)
                    if (parsed.event_type === "step.delta" && parsed.delta?.type === "text" && parsed.delta.text) {
                        res.write(`data: ${JSON.stringify({ token: parsed.delta.text })}\n\n`)
                    }
                    if (parsed.event_type === "interaction.completed" && parsed.interaction?.id) {
                        console.log(`[catalyst-ai] gemini session id: ${parsed.interaction.id}`)
                        res.write(`data: ${JSON.stringify({ conversationId: parsed.interaction.id })}\n\n`)
                        const usage = normalizeGeminiInteractionUsage(parsed.interaction?.usage, model)
                        if (usage) res.write(`data: ${JSON.stringify({ usage })}\n\n`)
                    }
                } catch (_) {}
            }
        }
    } else {
        // stateless: streamGenerateContent
        // nosemgrep: javascript.express.security.express-phantom-injection.express-phantom-injection - model is validated against MODEL_NAME_RE by validateRequestBody() before either route handler reaches here, so it can't contain "/", "?", ".." or other URL-structural characters. The host is a fixed literal.
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
        const sys = geminiSystemInstruction(messages)
        const body = {
            contents: toGeminiContents(messages),
            ...(sys && { system_instruction: sys }),
            generationConfig: {
                ...(genConfig?.maxTokens && { maxOutputTokens: genConfig.maxTokens }),
                ...(genConfig?.temperature != null && { temperature: genConfig.temperature }),
                ...(genConfig?.topP != null && { topP: genConfig.topP }),
            },
        }

        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(body),
            signal,
        })
        if (!response.ok) await throwProviderError("gemini", response)

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() || ""
            for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed || !trimmed.startsWith("data:")) continue
                const payload = trimmed.slice(5).trim()
                if (payload === "[DONE]") { res.write("data: [DONE]\n\n"); res.end(); return }
                try {
                    const parsed = JSON.parse(payload)
                    const token = parsed.candidates?.[0]?.content?.parts?.[0]?.text
                    if (token != null) res.write(`data: ${JSON.stringify({ token })}\n\n`)
                    if (parsed.usageMetadata) {
                        const usage = normalizeGeminiUsage(parsed.usageMetadata, model)
                        if (usage) res.write(`data: ${JSON.stringify({ usage })}\n\n`)
                    }
                } catch (_) {}
            }
        }
    }

    res.write("data: [DONE]\n\n")
    res.end()
}

async function geminiGenerate({ apiKey, model, messages, genConfig, conversationId, stateful }) {
    if (stateful) {
        // stateful non-streaming: Interactions API (v1beta2)
        const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions"
        const sys = geminiInteractionsSystemInstruction(messages)
        const lastUserMsg = media.mapGeminiInteractionsInput(messages)
        const body = {
            model: `models/${model}`,
            input: lastUserMsg,
            stream: false,
            ...(conversationId && { previous_interaction_id: conversationId }),
            ...(sys && { system_instruction: sys }),
            generation_config: {
                ...(genConfig?.maxTokens && { max_output_tokens: genConfig.maxTokens }),
                ...(genConfig?.temperature != null && { temperature: genConfig.temperature }),
                ...(genConfig?.topP != null && { top_p: genConfig.topP }),
            },
        }
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(body),
        })
        if (!response.ok) await throwProviderError("gemini", response)
        const data = await response.json()
        const text = data.steps?.find((s) => s.type === "model_output")?.content?.[0]?.text ?? ""
        return { output: text, conversationId: data.id ?? null, usage: normalizeGeminiInteractionUsage(data.usage, model) }
    } else {
        // stateless non-streaming: generateContent
        // nosemgrep: javascript.express.security.express-phantom-injection.express-phantom-injection - model is validated against MODEL_NAME_RE by validateRequestBody() before either route handler reaches here, so it can't contain "/", "?", ".." or other URL-structural characters. The host is a fixed literal.
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
        const sys = geminiSystemInstruction(messages)
        const body = {
            contents: toGeminiContents(messages),
            ...(sys && { system_instruction: sys }),
            generationConfig: {
                ...(genConfig?.maxTokens && { maxOutputTokens: genConfig.maxTokens }),
                ...(genConfig?.temperature != null && { temperature: genConfig.temperature }),
                ...(genConfig?.topP != null && { top_p: genConfig.topP }),
            },
        }
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(body),
        })
        if (!response.ok) await throwProviderError("gemini", response)
        const data = await response.json()
        return { output: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "", conversationId: null, usage: normalizeGeminiUsage(data.usageMetadata, model) }
    }
}

// ─── Anthropic (Claude) adapters ──────────────────────────────────────────────
// Messages API, stateless: the full history is sent every time and `conversationId` is ignored (returned as null).
// Supports text, images, PDFs (see cloudMedia.mapAnthropicMessages) and structured outputs. Claude takes no audio input
// and does no image generation or embeddings, so those stay with the other providers.

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages"
const ANTHROPIC_VERSION = "2023-06-01"
// max_tokens is required by the API. Streaming can afford a high default (no HTTP timeout to hit); callers cap it
// with genConfig.maxTokens.
const ANTHROPIC_DEFAULT_MAX_TOKENS = 16_000
const ANTHROPIC_DEFAULT_STREAM_MAX_TOKENS = 64_000

// Sampling parameters were removed on the current models: sending temperature/top_p to them is a 400. Older models still
// take them, so only the newer families are excluded (Fable, Mythos, Opus 4.7+/5, Sonnet 5+, Haiku 5+).
const NO_SAMPLING_RE = /^claude-(fable|mythos|opus-(4-[78]|5)|sonnet-5|haiku-5)/

// usage: input_tokens EXCLUDES cached reads and cache writes, which Anthropic reports separately. promptTokens is
// normalized to include them (as OpenAI and Gemini do) with cachedTokens the cached-read subset. output_tokens includes
// thinking tokens and the API does not break them out, so reasoningTokens stays 0 and thinking is billed as output.
function normalizeAnthropicUsage(usage, model) {
    if (!usage) return null
    const cacheRead = usage.cache_read_input_tokens ?? 0
    return {
        model,
        promptTokens: (usage.input_tokens ?? 0) + cacheRead + (usage.cache_creation_input_tokens ?? 0),
        cachedTokens: cacheRead,
        completionTokens: usage.output_tokens ?? 0,
        reasoningTokens: 0,
    }
}

function anthropicBody({ model, messages, genConfig, stream }) {
    const { system, messages: turns } = media.mapAnthropicMessages(messages)
    const sampling = !NO_SAMPLING_RE.test(model)
    return {
        model,
        max_tokens: genConfig?.maxTokens || (stream ? ANTHROPIC_DEFAULT_STREAM_MAX_TOKENS : ANTHROPIC_DEFAULT_MAX_TOKENS),
        messages: turns,
        ...(system && { system }),
        ...(stream && { stream: true }),
        ...(sampling && genConfig?.temperature != null && { temperature: genConfig.temperature }),
        ...(sampling && genConfig?.topP != null && { top_p: genConfig.topP }),
        // Structured outputs: genConfig.responseSchema is a JSON Schema object the reply must match.
        ...(genConfig?.responseSchema && typeof genConfig.responseSchema === "object" && {
            output_config: { format: { type: "json_schema", schema: genConfig.responseSchema } },
        }),
    }
}

function anthropicHeaders(apiKey) {
    return { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION }
}

// A safety decline arrives as a normal 200 with stop_reason "refusal", not as an HTTP error.
function anthropicRefusal(stopReason, stopDetails) {
    if (stopReason !== "refusal") return null
    const category = stopDetails?.category ? ` (${stopDetails.category})` : ""
    return new Error(`The model declined this request${category}`)
}

async function anthropicStream({ apiKey, model, messages, genConfig, res, signal }) {
    const response = await fetch(ANTHROPIC_ENDPOINT, {
        method: "POST",
        headers: anthropicHeaders(apiKey),
        body: JSON.stringify(anthropicBody({ model, messages, genConfig, stream: true })),
        signal,
    })
    if (!response.ok) await throwProviderError("anthropic", response)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let usage = {}
    let stopReason = null
    let stopDetails = null

    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""
        for (const line of lines) {
            const trimmed = line.trim()
            // Frames are `event: <name>` + `data: <json>`; the JSON carries the same name in `type`, so only data lines matter.
            if (!trimmed.startsWith("data:")) continue
            let parsed
            try { parsed = JSON.parse(trimmed.slice(5).trim()) } catch (_) { continue }
            if (parsed.type === "error") throw new Error(parsed.error?.message || "Claude stream error")
            if (parsed.type === "message_start") usage = { ...usage, ...parsed.message?.usage }
            else if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
                res.write(`data: ${JSON.stringify({ token: parsed.delta.text })}\n\n`)
            } else if (parsed.type === "message_delta") {
                usage = { ...usage, ...parsed.usage }
                stopReason = parsed.delta?.stop_reason ?? stopReason
                stopDetails = parsed.delta?.stop_details ?? stopDetails
            }
        }
    }

    const refusal = anthropicRefusal(stopReason, stopDetails)
    if (refusal) throw refusal
    const normalized = normalizeAnthropicUsage(usage, model)
    if (normalized) res.write(`data: ${JSON.stringify({ usage: normalized })}\n\n`)
    res.write("data: [DONE]\n\n")
    res.end()
}

async function anthropicGenerate({ apiKey, model, messages, genConfig }) {
    const response = await fetch(ANTHROPIC_ENDPOINT, {
        method: "POST",
        headers: anthropicHeaders(apiKey),
        body: JSON.stringify(anthropicBody({ model, messages, genConfig, stream: false })),
    })
    if (!response.ok) await throwProviderError("anthropic", response)
    const data = await response.json()
    const refusal = anthropicRefusal(data.stop_reason, data.stop_details)
    if (refusal) throw refusal
    const output = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("")
    return { output, conversationId: null, usage: normalizeAnthropicUsage(data.usage, model) }
}

// ─── provider registry ────────────────────────────────────────────────────────

const PROVIDERS = {
    openai: { stream: openaiStream, generate: openaiGenerate },
    gemini: { stream: geminiStream, generate: geminiGenerate },
    anthropic: { stream: anthropicStream, generate: anthropicGenerate },
}

// ─── routes ───────────────────────────────────────────────────────────────────

// Additive `code` field alongside the existing `{ error }` shape — does not
// change the response contract, just gives clients an AI-xxx code to look up.
async function sendCodedError(res, status, code, message) {
    const { getDocUrl } = await loadErrors()
    res.status(status).json({ error: message, code, docUrl: getDocUrl(code) })
}

// GET /ai/providers — returns list of configured provider ids, no keys exposed
router.get("/providers", async (req, res) => {
    if (!isAIEnabled()) {
        const { ERROR_CODES } = await loadErrors()
        await sendCodedError(res, 403, ERROR_CODES.AI_DISABLED, "AI is disabled. Set AI_CONFIG.enabled=true to enable.")
        return
    }
    const providers = Object.entries(getAIConfig()?.providers ?? {})
        .filter(([, cfg]) => cfg?.apiKey)
        .map(([id, cfg]) => ({ id, defaultModel: cfg.defaultModel ?? null }))
    res.json({ providers })
})

router.post("/:provider/stream", async (req, res) => {
    const { ERROR_CODES } = await loadErrors()
    if (!isAIEnabled()) {
        await sendCodedError(res, 403, ERROR_CODES.AI_DISABLED, "AI is disabled. Set AI_CONFIG.enabled=true to enable.")
        return
    }
    const { provider } = req.params
    const adapter = PROVIDERS[provider]
    if (!adapter) { res.status(404).json({ error: `Unknown provider: ${provider}` }); return }

    const cfg = getProviderConfig(provider)
    if (!cfg) {
        await sendCodedError(res, 404, ERROR_CODES.AI_PROVIDER_NOT_CONFIGURED, `Provider "${provider}" not configured`)
        return
    }

    const validationError = validateRequestBody(req, cfg, provider)
    if (validationError) {
        await sendCodedError(res, 400, ERROR_CODES.AI_INVALID_REQUEST_BODY, validationError)
        return
    }

    const { messages, genConfig = {}, conversationId, model } = req.body
    const stateful = "conversationId" in req.body
    const resolvedModel = model || cfg.defaultModel

    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), STREAM_TIMEOUT_MS)
    // res "close" fires when the response socket actually closes (client disconnect
    // or response finished) — req "close" fires as soon as the request body has been
    // fully read, which for a small JSON POST body happens almost immediately and
    // would abort the stream before it starts.
    res.on("close", () => abortController.abort())

    sseHeaders(res)
    try {
        // nosemgrep: javascript.express.security.express-phantom-injection.express-phantom-injection - adapter.stream dispatches to openaiStream/geminiStream, neither of which uses PhantomJS. resolvedModel is validated against MODEL_NAME_RE by validateRequestBody() above before this call, and the only outbound request hosts are fixed literals (api.openai.com / generativelanguage.googleapis.com) — not attacker-controllable.
        await adapter.stream({
            apiKey: cfg.apiKey,
            model: resolvedModel,
            messages,
            genConfig,
            conversationId,
            stateful,
            res,
            signal: abortController.signal,
        })
    } catch (err) {
        // err.code is only an AI-xxx string when err is a CatalystError. On the
        // client-disconnect path (res "close" -> abortController.abort()) fetch
        // rejects with a DOMException whose .code is the numeric legacy value 20 —
        // attaching that as `code` would be a bogus registry lookup for callers.
        const { CatalystError } = await loadErrors()
        const code = err instanceof CatalystError ? err.code : undefined
        // Log the upstream cause too (bounded — provider response bodies can be
        // long) so a failed request is diagnosable from server logs alone; the
        // client response below stays as err.message only, never the cause.
        const causeMessage = err.cause?.message
        const logSuffix = causeMessage ? `${err.message} — cause: ${causeMessage.slice(0, 500)}` : err.message
        console.error("[catalyst-ai] %s stream error:", provider, code ? `[${code}] ${logSuffix}` : logSuffix)
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ error: err.message, code })}\n\n`)
            res.end()
        }
    } finally {
        clearTimeout(timeout)
    }
})

router.post("/:provider/generate", async (req, res) => {
    const { ERROR_CODES } = await loadErrors()
    if (!isAIEnabled()) {
        await sendCodedError(res, 403, ERROR_CODES.AI_DISABLED, "AI is disabled. Set AI_CONFIG.enabled=true to enable.")
        return
    }
    const { provider } = req.params
    const adapter = PROVIDERS[provider]
    if (!adapter) { res.status(404).json({ error: `Unknown provider: ${provider}` }); return }

    const cfg = getProviderConfig(provider)
    if (!cfg) {
        await sendCodedError(res, 404, ERROR_CODES.AI_PROVIDER_NOT_CONFIGURED, `Provider "${provider}" not configured`)
        return
    }

    const validationError = validateRequestBody(req, cfg, provider)
    if (validationError) {
        await sendCodedError(res, 400, ERROR_CODES.AI_INVALID_REQUEST_BODY, validationError)
        return
    }

    const { messages, genConfig = {}, conversationId, model } = req.body
    const stateful = "conversationId" in req.body
    const resolvedModel = model || cfg.defaultModel

    try {
        // nosemgrep: javascript.express.security.express-phantom-injection.express-phantom-injection - adapter.generate dispatches to openaiGenerate/geminiGenerate, neither of which uses PhantomJS. resolvedModel is validated against MODEL_NAME_RE by validateRequestBody() above before this call, and the only outbound request hosts are fixed literals (api.openai.com / generativelanguage.googleapis.com) — not attacker-controllable.
        // nosemgrep: javascript.express.security.express-wkhtml-injection.express-wkhtmltoimage-injection - false positive: no wkhtmltoimage/PhantomJS is used; see the note above on adapter.generate.
        const result = await adapter.generate({ apiKey: cfg.apiKey, model: resolvedModel, messages, genConfig, conversationId, stateful })
        res.json({ ...result, model: resolvedModel })
    } catch (err) {
        const { CatalystError } = await loadErrors()
        const code = err instanceof CatalystError ? err.code : undefined
        // Log the upstream cause too (bounded — provider response bodies can be
        // long) so a failed request is diagnosable from server logs alone; the
        // client response below stays as err.message only, never the cause.
        const causeMessage = err.cause?.message
        const logSuffix = causeMessage ? `${err.message} — cause: ${causeMessage.slice(0, 500)}` : err.message
        console.error("[catalyst-ai] %s generate error:", provider, code ? `[${code}] ${logSuffix}` : logSuffix)
        res.status(500).json({ error: err.message, code })
    }
})

module.exports = router

// Testable internals, attached to the router (an Express router is a plain
// function, so this is a safe extra property — expressServer.js does
// `app.use(aiBasePath, aiRouter)` and Express ignores unrecognized
// properties on it). Exported this way rather than changing
// `module.exports` to an object so every existing require("catalyst-ai/route")
// call site keeps working unchanged; only test/errors.test.cjs-style
// contract tests reach into `_internal`.
router._internal = {
    getAIConfig,
    isAIEnabled,
    getProviderConfig,
    validateRequestBody,
    media,
    MODEL_NAME_RE,
    normalizeOpenAIChatUsage,
    normalizeOpenAIResponsesUsage,
    normalizeGeminiUsage,
    normalizeGeminiInteractionUsage,
    normalizeAnthropicUsage,
    anthropicBody,
    throwProviderError,
}

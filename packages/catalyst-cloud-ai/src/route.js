const express = require("express")

const router = express.Router()

// ─── helpers ────────────────────────────────────────────────────────────────

function getAIConfig() {
    return JSON.parse(process.env.AI_CONFIG || "{}")
}

function isAIEnabled() {
    return getAIConfig()?.enabled === true
}

function getProviderConfig(provider) {
    const cfg = getAIConfig()?.providers?.[provider]
    if (!cfg || !cfg.apiKey) return null
    return cfg
}

function sseHeaders(res) {
    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")
    res.setHeader("X-Accel-Buffering", "no")
    res.flushHeaders()
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

function normalizeOpenAIChatUsage(usage, model) {
    if (!usage) return null
    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0
    return {
        model,
        promptTokens: usage.prompt_tokens ?? 0,
        cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        completionTokens: (usage.completion_tokens ?? 0) - reasoningTokens,
        reasoningTokens,
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

async function openaiStream({ apiKey, model, messages, genConfig, conversationId, res }) {
    if (conversationId !== undefined) {
        // stateful: Responses API
        const endpoint = "https://api.openai.com/v1/responses"
        const body = {
            model,
            input: messages,
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
        })
        if (!response.ok) throw new Error(`OpenAI Responses API error (${response.status}): ${await response.text()}`)

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
            messages,
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
        })
        if (!response.ok) throw new Error(`OpenAI API error (${response.status}): ${await response.text()}`)

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

async function openaiGenerate({ apiKey, model, messages, genConfig, conversationId }) {
    if (conversationId !== undefined) {
        const endpoint = "https://api.openai.com/v1/responses"
        const body = {
            model,
            input: messages,
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
        if (!response.ok) throw new Error(`OpenAI Responses API error (${response.status}): ${await response.text()}`)
        const data = await response.json()
        const output = data.output?.find((o) => o.type === "message")?.content?.find((c) => c.type === "output_text")?.text ?? ""
        return { output, conversationId: data.id ?? null, usage: normalizeOpenAIResponsesUsage(data.usage, model) }
    } else {
        const endpoint = "https://api.openai.com/v1/chat/completions"
        const body = {
            model,
            messages,
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
        if (!response.ok) throw new Error(`OpenAI API error (${response.status}): ${await response.text()}`)
        const data = await response.json()
        return { output: data.choices?.[0]?.message?.content ?? "", conversationId: null, usage: normalizeOpenAIChatUsage(data.usage, model) }
    }
}

// ─── Gemini adapters ──────────────────────────────────────────────────────────

function toGeminiContents(messages) {
    return messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }))
}

function geminiSystemInstruction(messages) {
    const sys = messages.find((m) => m.role === "system")
    return sys ? { parts: [{ text: sys.content }] } : undefined
}

// Interactions API (v1beta/interactions) takes system_instruction as a plain string —
// unlike generateContent/streamGenerateContent, which need { parts: [{ text }] }.
// Confirmed via live 400: "Expected string, unexpected character: '{'"
function geminiInteractionsSystemInstruction(messages) {
    const sys = messages.find((m) => m.role === "system")
    return sys ? sys.content : undefined
}

async function geminiStream({ apiKey, model, messages, genConfig, conversationId, stateful, res }) {
    if (stateful) {
        // stateful: Interactions API (v1beta2)
        const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions"
        const sys = geminiInteractionsSystemInstruction(messages)
        const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? ""
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
        })
        if (!response.ok) throw new Error(`Gemini Interactions API error (${response.status}): ${await response.text()}`)

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
                        console.log(`[@catalyst/cloud-ai] gemini session id: ${parsed.interaction.id}`)
                        res.write(`data: ${JSON.stringify({ conversationId: parsed.interaction.id })}\n\n`)
                        const usage = normalizeGeminiInteractionUsage(parsed.interaction?.usage, model)
                        if (usage) res.write(`data: ${JSON.stringify({ usage })}\n\n`)
                    }
                } catch (_) {}
            }
        }
    } else {
        // stateless: streamGenerateContent
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
        })
        if (!response.ok) throw new Error(`Gemini API error (${response.status}): ${await response.text()}`)

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
        const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? ""
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
        if (!response.ok) throw new Error(`Gemini Interactions API error (${response.status}): ${await response.text()}`)
        const data = await response.json()
        const text = data.steps?.find((s) => s.type === "model_output")?.content?.[0]?.text ?? ""
        return { output: text, conversationId: data.id ?? null, usage: normalizeGeminiInteractionUsage(data.usage, model) }
    } else {
        // stateless non-streaming: generateContent
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
        if (!response.ok) throw new Error(`Gemini API error (${response.status}): ${await response.text()}`)
        const data = await response.json()
        return { output: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "", conversationId: null, usage: normalizeGeminiUsage(data.usageMetadata, model) }
    }
}

// ─── provider registry ────────────────────────────────────────────────────────

const PROVIDERS = {
    openai: { stream: openaiStream, generate: openaiGenerate },
    gemini: { stream: geminiStream, generate: geminiGenerate },
}

// ─── routes ───────────────────────────────────────────────────────────────────

// GET /ai/providers — returns list of configured provider ids, no keys exposed
router.get("/providers", (req, res) => {
    if (!isAIEnabled()) { res.status(403).json({ error: "AI is disabled. Set AI_CONFIG.enabled=true to enable." }); return }
    const providers = Object.entries(getAIConfig()?.providers ?? {})
        .filter(([, cfg]) => cfg?.apiKey)
        .map(([id, cfg]) => ({ id, defaultModel: cfg.defaultModel ?? null }))
    res.json({ providers })
})

router.post("/:provider/stream", async (req, res) => {
    if (!isAIEnabled()) { res.status(403).json({ error: "AI is disabled. Set AI_CONFIG.enabled=true to enable." }); return }
    const { provider } = req.params
    const adapter = PROVIDERS[provider]
    if (!adapter) { res.status(404).json({ error: `Unknown provider: ${provider}` }); return }

    const cfg = getProviderConfig(provider)
    if (!cfg) { res.status(404).json({ error: `Provider "${provider}" not configured` }); return }

    const { messages, genConfig = {}, conversationId, model } = req.body
    const stateful = "conversationId" in req.body
    const resolvedModel = model || cfg.defaultModel

    sseHeaders(res)
    try {
        await adapter.stream({ apiKey: cfg.apiKey, model: resolvedModel, messages, genConfig, conversationId, stateful, res })
    } catch (err) {
        console.error("[@catalyst/cloud-ai] %s stream error:", provider, err.message)
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
        res.end()
    }
})

router.post("/:provider/generate", async (req, res) => {
    if (!isAIEnabled()) { res.status(403).json({ error: "AI is disabled. Set AI_CONFIG.enabled=true to enable." }); return }
    const { provider } = req.params
    const adapter = PROVIDERS[provider]
    if (!adapter) { res.status(404).json({ error: `Unknown provider: ${provider}` }); return }

    const cfg = getProviderConfig(provider)
    if (!cfg) { res.status(404).json({ error: `Provider "${provider}" not configured` }); return }

    const { messages, genConfig = {}, conversationId, model } = req.body
    const stateful = "conversationId" in req.body
    const resolvedModel = model || cfg.defaultModel

    try {
        const result = await adapter.generate({ apiKey: cfg.apiKey, model: resolvedModel, messages, genConfig, conversationId, stateful })
        res.json({ ...result, model: resolvedModel })
    } catch (err) {
        console.error("[@catalyst/cloud-ai] %s generate error:", provider, err.message)
        res.status(500).json({ error: err.message })
    }
})

module.exports = router

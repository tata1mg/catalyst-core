const express = require("express")

const router = express.Router()

// ─── helpers ────────────────────────────────────────────────────────────────

function getProviderConfig(provider) {
    const aiConfig = JSON.parse(process.env.AI_CONFIG || "{}")
    const cfg = aiConfig?.providers?.[provider]
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
        return { output, conversationId: data.id ?? null }
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
        return { output: data.choices?.[0]?.message?.content ?? "", conversationId: null }
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

async function geminiStream({ apiKey, model, messages, genConfig, conversationId, res }) {
    if (conversationId !== undefined) {
        // stateful: Interactions API
        const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions"
        const sys = geminiSystemInstruction(messages)
        const body = {
            model: `models/${model}`,
            input: toGeminiContents(messages).map((c) => c.parts[0].text).join("\n"),
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
                    if (parsed.event_type === "interaction.completed" && parsed.id) {
                        res.write(`data: ${JSON.stringify({ conversationId: parsed.id })}\n\n`)
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
                } catch (_) {}
            }
        }
    }

    res.write("data: [DONE]\n\n")
    res.end()
}

async function geminiGenerate({ apiKey, model, messages, genConfig, conversationId }) {
    if (conversationId !== undefined) {
        // stateful non-streaming: Interactions API
        const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions"
        const sys = geminiSystemInstruction(messages)
        const body = {
            model: `models/${model}`,
            input: toGeminiContents(messages).map((c) => c.parts[0].text).join("\n"),
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
        const text = data.steps?.find((s) => s.type === "model_output")?.content ?? ""
        return { output: text, conversationId: data.id ?? null }
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
        return { output: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "", conversationId: null }
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
    const aiConfig = JSON.parse(process.env.AI_CONFIG || "{}")
    const providers = Object.entries(aiConfig?.providers ?? {})
        .filter(([, cfg]) => cfg?.apiKey)
        .map(([id, cfg]) => ({ id, defaultModel: cfg.defaultModel ?? null }))
    res.json({ providers })
})

router.post("/:provider/stream", async (req, res) => {
    const { provider } = req.params
    const adapter = PROVIDERS[provider]
    if (!adapter) { res.status(404).json({ error: `Unknown provider: ${provider}` }); return }

    const cfg = getProviderConfig(provider)
    if (!cfg) { res.status(404).json({ error: `Provider "${provider}" not configured` }); return }

    const { messages, genConfig = {}, conversationId, model } = req.body
    const resolvedModel = model || cfg.defaultModel

    sseHeaders(res)
    try {
        await adapter.stream({ apiKey: cfg.apiKey, model: resolvedModel, messages, genConfig, conversationId, res })
    } catch (err) {
        console.error(`[@catalyst/cloud-ai] ${provider} stream error:`, err.message)
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
        res.end()
    }
})

router.post("/:provider/generate", async (req, res) => {
    const { provider } = req.params
    const adapter = PROVIDERS[provider]
    if (!adapter) { res.status(404).json({ error: `Unknown provider: ${provider}` }); return }

    const cfg = getProviderConfig(provider)
    if (!cfg) { res.status(404).json({ error: `Provider "${provider}" not configured` }); return }

    const { messages, genConfig = {}, conversationId, model } = req.body
    const resolvedModel = model || cfg.defaultModel

    try {
        const result = await adapter.generate({ apiKey: cfg.apiKey, model: resolvedModel, messages, genConfig, conversationId })
        res.json(result)
    } catch (err) {
        console.error(`[@catalyst/cloud-ai] ${provider} generate error:`, err.message)
        res.status(500).json({ error: err.message })
    }
})

module.exports = router

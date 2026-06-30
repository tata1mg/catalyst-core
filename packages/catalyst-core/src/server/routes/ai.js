import express from "express"

const router = express.Router()

// Chat Completions API — stateless, existing behaviour
async function streamChatCompletions({ endpoint, apiKey, model, messages, genConfig, res }) {
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages,
            stream: true,
            ...(genConfig?.maxTokens && { max_tokens: genConfig.maxTokens }),
            ...(genConfig?.temperature != null && { temperature: genConfig.temperature }),
            ...(genConfig?.topP != null && { top_p: genConfig.topP }),
        }),
    })

    if (!response.ok) {
        const errText = await response.text()
        throw new Error(`OpenAI API error (${response.status}): ${errText}`)
    }

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
            if (payload === "[DONE]") {
                res.write("data: [DONE]\n\n")
                res.end()
                return
            }
            try {
                const parsed = JSON.parse(payload)
                const token = parsed.choices?.[0]?.delta?.content
                if (token != null) res.write(`data: ${JSON.stringify({ token })}\n\n`)
            } catch (_) {}
        }
    }

    res.write("data: [DONE]\n\n")
    res.end()
}

// Responses API — stateful, persists conversation_id across calls
async function streamResponses({ responsesEndpoint, apiKey, model, messages, conversationId, genConfig, res }) {
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

    const response = await fetch(responsesEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    })

    if (!response.ok) {
        const errText = await response.text()
        throw new Error(`OpenAI Responses API error (${response.status}): ${errText}`)
    }

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
            if (!trimmed) continue

            if (!trimmed.startsWith("data:")) continue
            const payload = trimmed.slice(5).trim()
            if (payload === "[DONE]") {
                console.log(`[catalyst-core/ai:responses] [DONE] received`)
                res.write("data: [DONE]\n\n")
                res.end()
                return
            }
            try {
                const parsed = JSON.parse(payload)

                // response.created carries the response id — use as conversation handle
                if (!sentConversationId && parsed.type === "response.created" && parsed.response?.id) {
                    res.write(`data: ${JSON.stringify({ conversationId: parsed.response.id })}\n\n`)
                    sentConversationId = true
                }

                // token is in parsed.delta for response.output_text.delta events
                if (parsed.type === "response.output_text.delta" && parsed.delta != null) {
                    res.write(`data: ${JSON.stringify({ token: parsed.delta })}\n\n`)
                }
            } catch (_) {}
        }
    }

    res.write("data: [DONE]\n\n")
    res.end()
}

router.post("/stream", async (req, res) => {
    const aiConfig = JSON.parse(process.env.AI_CONFIG || "{}")
    const { endpoint, model, enabled } = aiConfig

    if (!enabled || !endpoint) {
        res.status(404).json({ error: "AI not configured" })
        return
    }

    const apiKey = process.env.OPENAI_API_KEY
    const { messages, model: reqModel, genConfig = {}, conversationId } = req.body
    const resolvedModel = reqModel || model

    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")
    res.setHeader("X-Accel-Buffering", "no")
    res.setHeader("Transfer-Encoding", "chunked")
    res.flushHeaders()

    try {
        if (conversationId !== undefined) {
            const responsesEndpoint = endpoint.replace("/chat/completions", "/responses")
            await streamResponses({ responsesEndpoint, apiKey, model: resolvedModel, messages, conversationId, genConfig, res })
        } else {
            await streamChatCompletions({ endpoint, apiKey, model: resolvedModel, messages, genConfig, res })
        }
    } catch (err) {
        console.error("[catalyst-core/ai] error:", err.message)
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
        res.end()
    }
})

export default router

/**
 * Anthropic Provider
 * Handles communication with Anthropic's Claude API
 */

import { ANTHROPIC_CONFIG, formatMessages, extractSystemMessage } from "./anthropic-utils.js"

/**
 * Generate text using Anthropic (non-streaming)
 */
export async function textGenerate(options = {}) {
    const {
        apiKey,
        prompt,
        messages,
        model = ANTHROPIC_CONFIG.defaultModel,
        temperature = 0.7,
        maxTokens = 1000,
        topP,
        topK,
        stop,
    } = options

    if (!apiKey) {
        throw new Error("Anthropic API key is required")
    }

    const url = `${ANTHROPIC_CONFIG.baseURL}/messages`

    const requestBody = {
        model,
        messages: formatMessages(prompt, messages),
        max_tokens: maxTokens,
        temperature,
        stream: false,
    }

    // Add system message if present
    const systemMessage = extractSystemMessage(messages)
    if (systemMessage) {
        requestBody.system = systemMessage
    }

    // Add optional parameters
    if (topP !== undefined) requestBody.top_p = topP
    if (topK !== undefined) requestBody.top_k = topK
    if (stop) requestBody.stop_sequences = Array.isArray(stop) ? stop : [stop]

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "x-api-key": apiKey,
                "anthropic-version": ANTHROPIC_CONFIG.version,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
        })

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.error?.message || `Anthropic API error: ${response.status}`)
        }

        const data = await response.json()

        // Extract text from content blocks
        const textContent =
            data.content
                ?.filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("") || ""

        return {
            text: textContent,
            message: {
                role: "assistant",
                content: textContent,
            },
            usage: {
                promptTokens: data.usage?.input_tokens || 0,
                completionTokens: data.usage?.output_tokens || 0,
                totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
            },
            finishReason: data.stop_reason || "stop",
            metadata: {
                model: data.model,
                id: data.id,
            },
        }
    } catch (error) {
        throw new Error(`Anthropic generation failed: ${error.message}`)
    }
}

/**
 * Stream text using Anthropic
 */
export async function textStream(options = {}) {
    const {
        apiKey,
        prompt,
        messages,
        model = ANTHROPIC_CONFIG.defaultModel,
        temperature = 0.7,
        maxTokens = 1000,
        topP,
        topK,
        stop,
    } = options

    if (!apiKey) {
        throw new Error("Anthropic API key is required")
    }

    const url = `${ANTHROPIC_CONFIG.baseURL}/messages`

    const requestBody = {
        model,
        messages: formatMessages(prompt, messages),
        max_tokens: maxTokens,
        temperature,
        stream: true,
    }

    // Add system message if present
    const systemMessage = extractSystemMessage(messages)
    if (systemMessage) {
        requestBody.system = systemMessage
    }

    // Add optional parameters
    if (topP !== undefined) requestBody.top_p = topP
    if (topK !== undefined) requestBody.top_k = topK
    if (stop) requestBody.stop_sequences = Array.isArray(stop) ? stop : [stop]

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "x-api-key": apiKey,
                "anthropic-version": ANTHROPIC_CONFIG.version,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
        })

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.error?.message || `Anthropic API error: ${response.status}`)
        }

        return response.body
    } catch (error) {
        throw new Error(`Anthropic streaming failed: ${error.message}`)
    }
}

/**
 * Process Anthropic stream and convert to standard format
 */
export function createStreamProcessor() {
    return {
        async *processStream(reader) {
            const decoder = new TextDecoder()
            let buffer = ""

            try {
                while (true) {
                    const { done, value } = await reader.read()

                    if (done) break

                    buffer += decoder.decode(value, { stream: true })
                    const lines = buffer.split("\n")
                    buffer = lines.pop() || ""

                    for (const line of lines) {
                        if (!line.trim() || !line.startsWith("data: ")) continue

                        const data = line.slice(6)

                        try {
                            const parsed = JSON.parse(data)

                            // Handle content block delta
                            if (parsed.type === "content_block_delta") {
                                const text = parsed.delta?.text
                                if (text) {
                                    yield {
                                        type: "text-delta",
                                        delta: text,
                                    }
                                }
                            }

                            // Handle message completion
                            if (parsed.type === "message_stop") {
                                yield {
                                    type: "done",
                                }
                            }
                            } catch (e) {
                                // Failed to parse stream chunk
                            }
                    }
                }
            } catch (error) {
                yield {
                    type: "error",
                    error: error.message,
                }
            }
        },
    }
}
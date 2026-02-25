/**
 * OpenAI Provider
 * Handles communication with OpenAI's API
 */
import { PROVIDER_DEFAULTS } from "../../config/defaults.js"
import {
    OPENAI_CONFIG,
    formatMessages,
    validateApiKey,
    handleOpenAIError,
    extractResponsesText,
    extractResponsesDeltaText,
    convertChatToResponsesFormat,
    buildResponsesAPIRequestBody,
} from "./openai-utils.js"

/**
 * Generate text using OpenAI (non-streaming)
 */
export async function textGenerate(options = {}) {
    const {
        apiKey,
        prompt,
        messages,
        model = OPENAI_CONFIG.defaultModel,
        systemPrompt,
        temperature = 0.7,
        maxTokens = 1000,
        topP,
        frequencyPenalty,
        presencePenalty,
        stop,
        user,
        seed,
        responseFormat,
        tools,
        toolChoice,
        logitBias,
        n = 1,
    } = options

    // Validate API key
    validateApiKey(apiKey)

    const url = `${OPENAI_CONFIG.baseURL}/chat/completions`

    // Apply defaults for parameters
    const finalModel = model || OPENAI_CONFIG.defaultModel
    const finalTemperature = temperature ?? PROVIDER_DEFAULTS.openai.temperature
    const finalMaxTokens = maxTokens || PROVIDER_DEFAULTS.openai.maxTokens
    const finalN = n ?? PROVIDER_DEFAULTS.openai.n

    // Build request body
    const requestBody = {
        model: finalModel,
        messages: formatMessages(prompt, messages, systemPrompt),
        temperature: finalTemperature,
        max_tokens: finalMaxTokens,
        stream: false,
        n: finalN,
    }

    // Add optional parameters
    if (topP !== undefined) requestBody.top_p = topP
    if (frequencyPenalty !== undefined) requestBody.frequency_penalty = frequencyPenalty
    if (presencePenalty !== undefined) requestBody.presence_penalty = presencePenalty
    if (stop) requestBody.stop = stop
    if (user) requestBody.user = user
    if (seed !== undefined) requestBody.seed = seed
    if (logitBias) requestBody.logit_bias = logitBias

    // Advanced features
    if (responseFormat) {
        requestBody.response_format = responseFormat // e.g., { type: 'json_object' }
    }
    if (tools && Array.isArray(tools) && tools.length > 0) {
        requestBody.tools = tools
        if (toolChoice) requestBody.tool_choice = toolChoice
    }

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
        })

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            const error = new Error(errorData.error?.message || `OpenAI API error: ${response.status}`)
            throw handleOpenAIError(error, response)
        }

        const data = await response.json()

        // Convert Chat Completion API format to Response API format for consistency
        const result = convertChatToResponsesFormat(data)

        return result
    } catch (error) {
        if (error.status) {
            throw error // Already handled
        }
        throw new Error(`OpenAI generation failed: ${error.message}`)
    }
}

/**
 * Stream text using OpenAI
 */
export async function textStream(options = {}) {
    const {
        apiKey,
        prompt,
        messages,
        model = OPENAI_CONFIG.defaultModel,
        systemPrompt,
        temperature = 0.7,
        maxTokens = 1000,
        topP,
        frequencyPenalty,
        presencePenalty,
        stop,
        user,
        seed,
        responseFormat,
        tools,
        toolChoice,
        streamOptions,
    } = options

    // Validate API key
    validateApiKey(apiKey)

    const url = `${OPENAI_CONFIG.baseURL}/chat/completions`

    // Apply defaults for parameters
    const finalModel = model || OPENAI_CONFIG.defaultModel
    const finalTemperature = temperature ?? PROVIDER_DEFAULTS.openai.temperature
    const finalMaxTokens = maxTokens || PROVIDER_DEFAULTS.openai.maxTokens

    // Build request body
    const requestBody = {
        model: finalModel,
        messages: formatMessages(prompt, messages, systemPrompt),
        temperature: finalTemperature,
        max_tokens: finalMaxTokens,
        stream: true,
    }

    // Add optional parameters
    if (topP !== undefined) requestBody.top_p = topP
    if (frequencyPenalty !== undefined) requestBody.frequency_penalty = frequencyPenalty
    if (presencePenalty !== undefined) requestBody.presence_penalty = presencePenalty
    if (stop) requestBody.stop = stop
    if (user) requestBody.user = user
    if (seed !== undefined) requestBody.seed = seed

    // Advanced features
    if (responseFormat) {
        requestBody.response_format = responseFormat
    }
    if (tools && Array.isArray(tools) && tools.length > 0) {
        requestBody.tools = tools
        if (toolChoice) requestBody.tool_choice = toolChoice
    }
    if (streamOptions) {
        requestBody.stream_options = streamOptions // e.g., { include_usage: true }
    }

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
        })

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            const error = new Error(errorData.error?.message || `OpenAI API error: ${response.status}`)
            throw handleOpenAIError(error, response)
        }

        return response.body
    } catch (error) {
        if (error.status) {
            throw error
        }
        throw new Error(`OpenAI streaming failed: ${error.message}`)
    }
}

/**
 * Process OpenAI Chat Completion stream and convert to Response API format
 * Converts Chat Completion API format to standardized Response API pattern
 */
export function createStreamProcessor() {
    return {
        async *processStream(reader) {
            const decoder = new TextDecoder()
            let buffer = ""
            let streamStarted = false
            let streamMetadata = {}

            try {
                while (true) {
                    const { done, value } = await reader.read()

                    if (done) break

                    buffer += decoder.decode(value, { stream: true })
                    const lines = buffer.split("\n")
                    // Keep incomplete line in buffer
                    buffer = buffer.endsWith("\n") ? "" : lines.pop() || ""

                    for (const line of lines) {
                        if (!line.trim() || !line.startsWith("data: ")) continue

                        const data = line.slice(6)
                        if (data === "[DONE]") {
                            // Convert to Response API done event format
                            yield {
                                type: "done",
                                usage: streamMetadata.usage,
                                responseId: streamMetadata.id,
                                finishReason: streamMetadata.finishReason || "stop",
                            }
                            continue
                        }

                        try {
                            const parsed = JSON.parse(data)
                            const choice = parsed.choices?.[0]

                            if (!choice) continue

                            // Emit response-created event on first chunk (Response API pattern)
                            if (!streamStarted && parsed.id) {
                                streamStarted = true
                                streamMetadata.id = parsed.id
                                streamMetadata.model = parsed.model
                                streamMetadata.created = parsed.created

                                yield {
                                    type: "response-created",
                                    responseId: parsed.id,
                                    model: parsed.model,
                                    created: parsed.created,
                                }
                            }

                            // Handle text content delta - already matches Response API format
                            const content = choice.delta?.content
                            if (content) {
                                yield {
                                    type: "text-delta",
                                    delta: content,
                                }
                            }

                            // Handle function calls (legacy) - convert to Response API tool-call format
                            const functionCall = choice.delta?.function_call
                            if (functionCall) {
                                yield {
                                    type: "tool-call",
                                    toolCall: {
                                        type: "function",
                                        function: functionCall,
                                    },
                                }
                            }

                            // Handle tool calls (current) - convert to Response API format
                            const toolCalls = choice.delta?.tool_calls
                            if (toolCalls && toolCalls.length > 0) {
                                for (const toolCall of toolCalls) {
                                    yield {
                                        type: "tool-call",
                                        toolCall: toolCall,
                                    }
                                }
                            }

                            // Store finish reason for final done event
                            if (choice.finish_reason) {
                                streamMetadata.finishReason = choice.finish_reason
                            }

                            // Store usage info for final done event (if stream_options.include_usage is true)
                            if (parsed.usage) {
                                streamMetadata.usage = {
                                    promptTokens: parsed.usage.prompt_tokens,
                                    completionTokens: parsed.usage.completion_tokens,
                                    totalTokens: parsed.usage.total_tokens,
                                }
                            }
                        } catch (e) {
                            yield {
                                type: "error",
                                error: `Failed to parse stream chunk: ${e.message}`,
                            }
                            // Continue processing other lines instead of breaking
                        }
                    }
                }
            } catch (error) {
                yield {
                    type: "error",
                    error: error.message || "Stream processing failed",
                }
            } finally {
                // Ensure reader is released

                reader.releaseLock()
            }
        },
    }
}

/**
 * Generate using new Responses API (Stateful, with native tools)
 * This is the recommended API for new applications (2025+)
 */
export async function responseGenerate(options = {}) {
    const {
        apiKey,
        prompt,
        messages,
        model = OPENAI_CONFIG.defaultModel,
        systemPrompt,
        temperature = 0.7,
        maxTokens = 1000,
        topP,
        frequencyPenalty,
        presencePenalty,
        stop,
        user,
        seed,
        responseFormat,
        // New Responses API specific options
        store = PROVIDER_DEFAULTS.openai.store ?? false, // Enable stateful conversations
        previousResponseId, // Continue from previous response
        background = false, // Enable background processing for long tasks
        tools, // Native tools: web_search, code_interpreter, image_generation
        toolChoice,
        reasoningEffort = "medium", // low/medium/high (for o3-mini, o4-mini models)
        metadata, // Custom metadata for tracking
        
    } = options

    // Validate API key
    validateApiKey(apiKey)

    const url = `${OPENAI_CONFIG.responsesURL}`

    // Apply defaults for parameters
    const finalModel = model || OPENAI_CONFIG.defaultModel
    const finalTemperature = temperature ?? PROVIDER_DEFAULTS.openai.temperature
    const finalMaxTokens = maxTokens || PROVIDER_DEFAULTS.openai.maxTokens

    // Build request body using utility function
    // NOTE: Responses API does NOT accept `max_tokens` (chat/completions param).
    // Use `max_output_tokens`; fall back to `max_completion_tokens` on 400 unknown_parameter.
    const requestBody = buildResponsesAPIRequestBody({
        model: finalModel,
        temperature: finalTemperature,
        maxTokens: finalMaxTokens,
        prompt,
        messages,
        systemPrompt,
        previousResponseId,
        topP,
        frequencyPenalty,
        presencePenalty,
        stop,
        user,
        seed,
        reasoningEffort,
        metadata,
        tools,
        toolChoice,
        store,
        background,
        stream: false,
    })

    // Note: responseFormat and logitBias are deprecated in Responses API
    // Use text.format instead of response_format
    if (responseFormat) {
        // Handle legacy response_format parameter
        if (responseFormat.type === "json_object") {
            requestBody.text = { format: "json" }
        }
    }


    try {
        const doFetch = async (body) =>
            fetch(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "OpenAI-Beta": "responses=v1", // Beta header for new API
                },
                body: JSON.stringify(body),
            })

        let response = await doFetch(requestBody)

        // Fallback between max_output_tokens and max_completion_tokens
        if (!response.ok) {
            let errorData = await response.json().catch(() => ({}))
            const unknownParam =
                errorData?.error?.code === "unknown_parameter" ? errorData?.error?.param : undefined

            if (unknownParam === "max_output_tokens" && requestBody.max_output_tokens !== undefined) {
                const retryBody = { ...requestBody }
                retryBody.max_completion_tokens = retryBody.max_output_tokens
                delete retryBody.max_output_tokens
                response = await doFetch(retryBody)
                if (!response.ok) {
                    errorData = await response.json().catch(() => ({}))
                }
            }

            // If still failing, surface the latest error
            if (!response.ok) {
                const error = new Error(errorData.error?.message || `OpenAI API error: ${response.status}`)
                throw handleOpenAIError(error, response)
            }
        }

        const data = await response.json()

        // Handle background mode response
        if (background && data.status === "in_progress") {
            return {
                type: "background",
                responseId: data.id,
                status: data.status,
                pollUrl: `${OPENAI_CONFIG.responsesURL}/${data.id}`,
            }
        }

        // Handle multiple choices if n > 1
        const outputs = data.output || []
        const extractedText = extractResponsesText(data)

        const result = {
            text: extractedText,
            output: outputs[0],
            choices: outputs.map((output, index) => ({
                text: extractResponsesText({ output: [output] }),
                output: output,
                finishReason: output.finish_reason,
                index: index,
            })),
            responseId: data.id, // Store for continuing conversation
            conversationId: data.conversation_id, // For stateful conversations
            usage: {
                promptTokens: data.usage?.prompt_tokens || 0,
                completionTokens: data.usage?.completion_tokens || 0,
                totalTokens: data.usage?.total_tokens || 0,
            },
            finishReason: outputs[0]?.finish_reason || "stop",
            metadata: {
                model: data.model,
                id: data.id,
                created: data.created,
                conversationId: data.conversation_id,
                systemFingerprint: data.system_fingerprint,
            },
        }

        return result
    } catch (error) {
        if (error.status) {
            throw error // Already handled
        }
        throw new Error(`OpenAI Responses API failed: ${error.message}`)
    }
}

/**
 * Stream using new Responses API with rich event types
 * Features: event-driven SSE, reasoning streams, native tools
 */
export async function responseStream(options = {}) {
    const {
        apiKey,
        prompt,
        messages,
        model = OPENAI_CONFIG.defaultModel,
        systemPrompt,
        temperature = 0.7,
        maxTokens = 1000,
        topP,
        frequencyPenalty,
        presencePenalty,
        stop,
        user,
        seed,

        tools,
        toolChoice,
        previousResponseId,
        reasoningEffort,
        includeReasoning = false, // Stream reasoning tokens separately
        metadata,
    } = options

    // Validate API key
    validateApiKey(apiKey)

    const url = `${OPENAI_CONFIG.responsesURL}`

    // Apply defaults for parameters
    const finalModel = model || OPENAI_CONFIG.defaultModel
    const finalTemperature = temperature ?? PROVIDER_DEFAULTS.openai.temperature
    const finalMaxTokens = maxTokens || PROVIDER_DEFAULTS.openai.maxTokens

    // Build request body using utility function
    // NOTE: Responses API does NOT accept `max_tokens`.
    // Use `max_output_tokens`; fall back to `max_completion_tokens` on 400 unknown_parameter.
    const requestBody = buildResponsesAPIRequestBody({
        model: finalModel,
        temperature: finalTemperature,
        maxTokens: finalMaxTokens,
        prompt,
        messages,
        systemPrompt,
        previousResponseId,
        topP,
        frequencyPenalty,
        presencePenalty,
        stop,
        user,
        seed,
        reasoningEffort:
            reasoningEffort && (model?.includes("o3") || model?.includes("o4") || model?.includes("gpt-5"))
                ? reasoningEffort
                : undefined,
        includeReasoning,
        metadata,
        tools,
        toolChoice,
        stream: true,
    })

    try {
        const doFetch = async (body) =>
            fetch(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "OpenAI-Beta": "responses=v1", // Required for Responses API
                },
                body: JSON.stringify(body),
            })
        let response = await doFetch(requestBody)

        // Fallback between max_output_tokens and max_completion_tokens
        if (!response.ok) {
            let errorData = await response.json().catch(() => ({}))

            const unknownParam =
                errorData?.error?.code === "unknown_parameter" ? errorData?.error?.param : undefined

            if (unknownParam === "max_output_tokens" && requestBody.max_output_tokens !== undefined) {
                const retryBody = { ...requestBody }
                retryBody.max_completion_tokens = retryBody.max_output_tokens
                delete retryBody.max_output_tokens
                response = await doFetch(retryBody)

                if (!response.ok) {
                    errorData = await response.json().catch(() => ({}))
                }
            }

            if (!response.ok) {
                const error = new Error(errorData.error?.message || `OpenAI API error: ${response.status}`)
                throw handleOpenAIError(error, response)
            }
        }
        return response.body
    } catch (error) {
        if (error.status) {
            throw error
        }
        throw new Error(`OpenAI Responses API streaming failed: ${error.message}`)
    }
}

/**
 * New Stream Processor for Responses API
 * Handles rich event types: response.created, response.output_item.delta, response.done
 */
export function createResponseStreamProcessor() {
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
                    buffer = buffer.endsWith("\n") ? "" : lines.pop() || ""

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i]
                        if (!line.trim()) continue

                        // Parse event type
                        if (line.startsWith("event: ")) {
                            const eventType = line.slice(7).trim()

                            // Get next line for data
                            const dataLine = lines[i + 1]
                            if (!dataLine?.startsWith("data: ")) continue

                            const data = dataLine.slice(6)

                            // Handle [DONE] marker
                            if (data === "[DONE]") {
                                yield {
                                    type: "done",
                                }
                                continue
                            }

                            try {
                                const parsed = JSON.parse(data)

                                switch (eventType) {
                                    case "response.created":
                                        yield {
                                            type: "response-created",
                                            responseId: parsed.response?.id,
                                            conversationId: parsed.conversation_id,
                                        }
                                        break

                                    case "response.output_item.delta": {
                                        const deltaText = extractResponsesDeltaText(parsed)
                                        if (deltaText) {
                                            yield {
                                                type: "text-delta",
                                                delta: deltaText,
                                            }
                                        }
                                        break
                                    }

                                    // Some API versions emit output text deltas under a different event name
                                    case "response.output_text.delta": {
                                        const deltaText = extractResponsesDeltaText(parsed)
                                        if (deltaText) {
                                            yield {
                                                type: "text-delta",
                                                delta: deltaText,
                                            }
                                        }
                                        break
                                    }

                                    // NEW: Handle response.output_text.done (complete text)
                                    case "response.output_text.done": {
                                        const text = parsed.text || ""
                                        if (text) {
                                            yield {
                                                type: "output-text-done",
                                                delta: text,
                                            }
                                        }
                                        break
                                    }

                                    // NEW: Handle response.content_part.done (alternative format)
                                    case "response.content_part.done": {
                                        const text = parsed.part?.text || ""
                                        if (text) {
                                            yield {
                                                type: "content-part-done",
                                                delta: text,
                                            }
                                        }
                                        break
                                    }

                                    // NEW: Handle response.completed (final completion event)
                                    case "response.completed": {
                                        const response = parsed.response
                                        yield {
                                            type: "done",
                                            usage: response?.usage
                                                ? {
                                                      promptTokens:
                                                          response.usage.input_tokens ||
                                                          response.usage.prompt_tokens ||
                                                          0,
                                                      completionTokens:
                                                          response.usage.output_tokens ||
                                                          response.usage.completion_tokens ||
                                                          0,
                                                      totalTokens: response.usage.total_tokens || 0,
                                                  }
                                                : undefined,
                                            responseId: response?.id,
                                            finishReason: response?.output?.[0]?.status || "stop",
                                        }
                                        break
                                    }

                                    case "response.reasoning.delta":
                                        // Reasoning tokens (thinking process)
                                        if (parsed.delta?.reasoning) {
                                            yield {
                                                type: "reasoning-delta",
                                                reasoning: parsed.delta.reasoning,
                                            }
                                        }
                                        break

                                    case "response.tool_call":
                                        yield {
                                            type: "tool-call",
                                            toolCall: parsed.tool_call,
                                        }
                                        break

                                    case "response.done":
                                        yield {
                                            type: "done",
                                            usage: parsed.usage
                                                ? {
                                                      promptTokens: parsed.usage.prompt_tokens,
                                                      completionTokens: parsed.usage.completion_tokens,
                                                      totalTokens: parsed.usage.total_tokens,
                                                  }
                                                : undefined,
                                            responseId: parsed.id,
                                            finishReason: parsed.finish_reason,
                                        }
                                        break

                                    default:
                                        // Handle other event types
                                        yield {
                                            type: "event",
                                            eventType,
                                            data: parsed,
                                        }
                                }
                            } catch (e) {
                                // Failed to parse stream event
                            }

                            i++ // Skip the data line we just processed
                        }
                        // Fallback: handle old-style data: lines without event:
                        else if (line.startsWith("data: ")) {
                            const data = line.slice(6)
                            if (data === "[DONE]") {
                                yield {
                                    type: "done",
                                }
                                continue
                            }

                            try {
                                const parsed = JSON.parse(data)
                                // Fallback: treat as full response payload
                                const content = extractResponsesText(parsed)
                                if (content) {
                                    yield {
                                        type: "text-delta",
                                        delta: content,
                                    }
                                }
                            } catch (e) {
                                // Failed to parse stream data
                            }
                        }
                    }
                }
            } catch (error) {
                yield {
                    type: "error",
                    error: error.message || "Stream processing failed",
                }
            } finally {
                // Ensure reader is released
                try {
                    reader.releaseLock()
                } catch (e) {
                    // Reader might already be released
                }
            }
        },
    }
}

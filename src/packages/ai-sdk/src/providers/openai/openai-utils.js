/**
 * OpenAI Utility Functions
 * Helper functions for OpenAI provider
 */

import { PROVIDER_DEFAULTS } from "../../config/defaults.js"

/**
 * OpenAI Provider Configuration
 */
export const OPENAI_CONFIG = {
    baseURL: PROVIDER_DEFAULTS.openai.baseURL,
    chatCompletionsURL:
        PROVIDER_DEFAULTS.openai.chatCompletionsURL || `${PROVIDER_DEFAULTS.openai.baseURL}/chat/completions`,
    responsesURL: PROVIDER_DEFAULTS.openai.responsesURL || `${PROVIDER_DEFAULTS.openai.baseURL}/responses`,
    defaultModel: PROVIDER_DEFAULTS.openai.defaultModel,
    models: {
        // Latest GPT-5 Models (2025-2026)
        "gpt-5": "gpt-5", // Flagship multimodal model
        "gpt-5-pro": "gpt-5-pro", // Maximum compute "Thinking" mode

        // GPT-4 Models (2024-2025)
        "gpt-4o": "gpt-4o", // Most capable, multimodal
        "gpt-4o-mini": "gpt-4o-mini", // Fast, affordable, recommended
        "gpt-4-turbo": "gpt-4-turbo", // Previous generation
        "gpt-4": "gpt-4", // Original GPT-4

        // GPT-3.5 Models
        "gpt-3.5-turbo": "gpt-3.5-turbo", // Legacy, use gpt-4o-mini instead

        // Reasoning Models (o-series) - Optimized for Responses API
        "o3-mini": "o3-mini", // High-speed reasoning (24% faster than o1-mini)
        "o4-mini": "o4-mini", // Ultra-low cost reasoning
        o1: "o1", // Advanced reasoning
        "o1-mini": "o1-mini", // Fast reasoning
        "o1-preview": "o1-preview", // Preview version

        // Specific versions (for production stability)
        "gpt-4o-2024-11-20": "gpt-4o-2024-11-20",
        "gpt-4o-mini-2024-07-18": "gpt-4o-mini-2024-07-18",
        "gpt-4-turbo-2024-04-09": "gpt-4-turbo-2024-04-09",
    },

    // Model capabilities
    capabilities: {
        "gpt-5": { vision: true, functions: true, json: true, maxTokens: 32768, nativeTools: true },
        "gpt-5-pro": { vision: true, functions: true, json: true, maxTokens: 65536, nativeTools: true },
        "gpt-4o": { vision: true, functions: true, json: true, maxTokens: 16384, nativeTools: false },
        "gpt-4o-mini": { vision: true, functions: true, json: true, maxTokens: 16384, nativeTools: false },
        "gpt-4-turbo": { vision: true, functions: true, json: true, maxTokens: 4096, nativeTools: false },
        "gpt-4": { vision: false, functions: true, json: true, maxTokens: 8192, nativeTools: false },
        "gpt-3.5-turbo": { vision: false, functions: true, json: true, maxTokens: 4096, nativeTools: false },
        "o3-mini": {
            vision: false,
            functions: true,
            json: true,
            maxTokens: 65536,
            nativeTools: true,
            reasoning: true,
        },
        "o4-mini": {
            vision: false,
            functions: true,
            json: true,
            maxTokens: 65536,
            nativeTools: true,
            reasoning: true,
        },
        o1: {
            vision: false,
            functions: false,
            json: false,
            maxTokens: 32768,
            nativeTools: false,
            reasoning: true,
        },
        "o1-mini": {
            vision: false,
            functions: false,
            json: false,
            maxTokens: 65536,
            nativeTools: false,
            reasoning: true,
        },
        "o1-preview": {
            vision: false,
            functions: false,
            json: false,
            maxTokens: 32768,
            nativeTools: false,
            reasoning: true,
        },
    },

    // Native tools available in Responses API
    nativeTools: {
        webSearch: "web_search",
        codeInterpreter: "code_interpreter",
        imageGeneration: "image_generation",
    },
}

/**
 * Format messages for OpenAI API
 * Handles text, images, and system prompts
 * Cleans out custom fields that OpenAI doesn't accept (id, timestamp, metadata, etc.)
 */
export function formatMessages(prompt, messages, systemPrompt) {
    let formattedMessages = []

    // Add system prompt if provided
    if (systemPrompt) {
        formattedMessages.push({
            role: "system",
            content: systemPrompt,
        })
    }

    // Handle message array
    if (messages && Array.isArray(messages)) {
        // Clean messages: Only include fields that OpenAI API accepts
        const cleanedMessages = messages.map((msg) => {
            const cleanMsg = {
                role: msg.role,
                content: msg.content,
            }

            // Include optional OpenAI-supported fields if present
            if (msg.name) cleanMsg.name = msg.name
            if (msg.function_call) cleanMsg.function_call = msg.function_call
            if (msg.tool_calls) cleanMsg.tool_calls = msg.tool_calls
            if (msg.tool_call_id) cleanMsg.tool_call_id = msg.tool_call_id

            return cleanMsg
        })

        formattedMessages = [...formattedMessages, ...cleanedMessages]
    }
    // Handle simple prompt
    else if (prompt) {
        formattedMessages.push({
            role: "user",
            content: prompt,
        })
    } else {
        throw new Error("Either prompt or messages must be provided")
    }

    return formattedMessages
}

/**
 * Validate API key format
 */
export function validateApiKey(apiKey) {
    if (!apiKey) {
        throw new Error("OpenAI API key is required")
    }
    if (!apiKey.startsWith("sk-")) {
        throw new Error('Invalid OpenAI API key format. Must start with "sk-"')
    }
    return true
}

/**
 * Get model capabilities
 */
export function getModelCapabilities(model) {
    const capabilities = OPENAI_CONFIG.capabilities[model] || OPENAI_CONFIG.capabilities["gpt-4o-mini"]
    return capabilities
}

/**
 * Handle OpenAI API errors with detailed messages
 */
export function handleOpenAIError(error, response) {
    const status = response?.status

    // Specific error messages based on status code
    const errorMessages = {
        400: "Bad request. Check your parameters.",
        401: "Invalid API key. Please check your OpenAI API key.",
        403: "Forbidden. Your API key may not have access to this model.",
        404: "Model not found. The requested model may not exist or is not available.",
        429: "Rate limit exceeded. Please slow down your requests.",
        500: "OpenAI server error. Please try again later.",
        503: "OpenAI service unavailable. Please try again later.",
    }

    const message = errorMessages[status] || error.message || "OpenAI API error"

    const enhancedError = new Error(message)
    enhancedError.status = status
    enhancedError.originalError = error

    return enhancedError
}

/**
 * List available models
 */
export function listModels() {
    return Object.keys(OPENAI_CONFIG.models)
}

/**
 * Check if model supports a capability
 */
export function supportsCapability(model, capability) {
    const capabilities = getModelCapabilities(model)
    return capabilities[capability] || false
}

/**
 * Get recommended model for use case
 */
export function getRecommendedModel(useCase = "general") {
    const recommendations = {
        general: "gpt-4o-mini", // Best balance of speed and quality
        chat: "gpt-4o-mini", // Fast and affordable for chat
        complex: "gpt-5", // Most capable (2025)
        complexThinking: "gpt-5-pro", // Maximum compute for deep research
        vision: "gpt-4o", // Supports images
        reasoning: "o3-mini", // High-speed reasoning (2025)
        reasoningFast: "o3-mini", // Fastest reasoning
        reasoningAffordable: "o4-mini", // Most cost-effective reasoning
        fast: "gpt-4o-mini", // Fastest general purpose
        affordable: "gpt-4o-mini", // Most cost-effective
        legacy: "gpt-3.5-turbo", // Backward compatibility
    }

    return recommendations[useCase] || recommendations.general
}

/**
 * Check if model supports Responses API native tools
 */
export function supportsNativeTools(model) {
    const capabilities = getModelCapabilities(model)
    return capabilities.nativeTools || false
}

/**
 * Check if model supports reasoning features
 */
export function supportsReasoning(model) {
    const capabilities = getModelCapabilities(model)
    return capabilities.reasoning || false
}

/**
 * Format input for Responses API
 * Converts messages/prompt to the new `input` format
 *
 * NOTE: This function only formats the `input` field. The `systemPrompt` parameter
 * is kept for signature compatibility but is NOT used here. System prompts should
 * be handled separately as the top-level `instructions` field in the request body
 * by the calling function (responseGenerate/responseStream).
 *
 * @param {string} prompt - Simple text prompt
 * @param {Array} messages - Array of message objects
 * @param {string} systemPrompt - System instructions (not used here, handled separately as `instructions`)
 * @returns {string|Array} - Formatted input for Responses API
 */
export function formatResponsesInput(prompt, messages) {
    // If we have messages array, format it properly
    if (messages && Array.isArray(messages) && messages.length > 0) {
        // Filter out system messages since they should be in top-level `instructions`
        const nonSystemMessages = messages.filter((msg) => msg.role !== "system")

        // Clean messages: Only include fields that OpenAI API accepts
        // Remove custom fields like id, timestamp, metadata, etc.
        const cleanedMessages = nonSystemMessages.map((msg) => {
            const cleanMsg = {
                role: msg.role,
                content: msg.content,
            }

            // Include optional OpenAI-supported fields if present
            if (msg.name) cleanMsg.name = msg.name
            if (msg.function_call) cleanMsg.function_call = msg.function_call
            if (msg.tool_calls) cleanMsg.tool_calls = msg.tool_calls
            if (msg.tool_call_id) cleanMsg.tool_call_id = msg.tool_call_id

            return cleanMsg
        })

        return cleanedMessages
    }

    // If only prompt, return as simple string or wrapped in object
    if (prompt) {
        // Simple string format is valid for Responses API
        return [{ role: "user", content: prompt }]
    }

    throw new Error("Either prompt or messages must be provided")
}

/**
 * Build Responses API request body
 * Creates a properly formatted request body for OpenAI Responses API
 *
 * OPENAI RESPONSES API BODY FORMAT (Complete Structure):
 * ========================================================
 *
 * REQUIRED PARAMETERS:
 * - model: string (e.g., "gpt-4o", "gpt-5", "o3-mini")
 * - input: string | array of input items (or previous_response_id for continuation)
 *
 * CORE PARAMETERS:
 * - temperature: number (0-2, default: 1.0)
 * - max_output_tokens: number (max tokens in output)
 * - instructions: string (system/developer instructions, replaces system message)
 * - stream: boolean (enable SSE streaming)
 * - stream_options: object { include_reasoning: boolean }
 *
 * CONVERSATION & CONTEXT:
 * - conversation: string | object (conversation ID or config)
 * - previous_response_id: string (for multi-turn conversations)
 * - context_management: array of { type, compact_threshold }
 *
 * TEXT OUTPUT:
 * - text: { format: "plain" | "json", verbosity: string }
 *
 * TOOLS & FUNCTION CALLING:
 * - tools: array of tool definitions (web_search, file_search, code_interpreter, computer, function, custom, mcp)
 * - tool_choice: "auto" | "none" | "required" | object
 * - parallel_tool_calls: boolean
 * - max_tool_calls: number
 *
 * REASONING (o-series, gpt-5 models):
 * - reasoning: { effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh", summary: "auto" | "concise" | "detailed" }
 *
 * INCLUDE ADDITIONAL DATA:
 * - include: array of strings (e.g., "web_search_call.action.sources", "reasoning.encrypted_content")
 *
 * PROMPT MANAGEMENT:
 * - prompt: { id, version, variables }
 *
 * CACHING:
 * - prompt_cache_key: string
 * - prompt_cache_retention: "in-memory" | "24h"
 *
 * SERVICE & STORAGE:
 * - service_tier: "auto" | "default" | "flex" | "priority"
 * - store: boolean
 * - background: boolean
 *
 * SAMPLING PARAMETERS:
 * - top_p: number (0-1)
 * - top_logprobs: number (0-20)
 * - stop: string | array
 * - seed: number
 *
 * SAFETY & METADATA:
 * - truncation: "auto" | "disabled"
 * - safety_identifier: string (hashed user ID)
 * - user: string (deprecated, use safety_identifier)
 * - metadata: object (16 key-value pairs max)
 *
 * DEPRECATED/UNSUPPORTED PARAMETERS (will be ignored):
 * - frequency_penalty (not supported in Responses API)
 * - presence_penalty (not supported in Responses API)
 * - logit_bias (not supported in Responses API)
 * - response_format (use text.format instead)
 * - max_tokens (use max_output_tokens instead)
 * - messages (use input instead)
 *
 * @param {Object} options - Configuration options
 * @returns {Object} - Formatted request body
 */
export function buildResponsesAPIRequestBody(options = {}) {
    const {
        model,
        temperature,
        maxTokens,
        prompt,
        messages,
        systemPrompt,
        previousResponseId,
        conversation,
        topP,
        stop,
        user,
        seed,
        reasoningEffort,
        includeReasoning = false,
        metadata,
        tools,
        toolChoice,
        parallelToolCalls,
        maxToolCalls,
        textFormat,
        textVerbosity,
        include,
        promptCacheKey,
        promptCacheRetention,
        serviceTier,
        store,
        truncation,
        safetyIdentifier,
        background,
        contextManagement,
        topLogprobs,
        stream = false,
    } = options

    // Build base request body with required fields
    const requestBody = {
        model,
        stream,
    }

    // Stream options (required for streaming)
    if (stream) {
        requestBody.stream_options = {}
        if (includeReasoning) {
            requestBody.stream_options.include_reasoning = true
        }
    }

    // Core parameters
    if (temperature !== undefined) requestBody.temperature = temperature
    if (maxTokens !== undefined) requestBody.max_output_tokens = maxTokens

    // System instructions (top-level for Responses API)
    if (systemPrompt) {
        requestBody.instructions = systemPrompt
    }

    // Input handling
    if (previousResponseId) {
        requestBody.previous_response_id = previousResponseId
        // Only add input if we have new messages/prompt to add to the conversation
        if (prompt || messages) {
            requestBody.input = formatResponsesInput(prompt, messages)
        }
    } else if (conversation) {
        requestBody.conversation = conversation
        if (prompt || messages) {
            requestBody.input = formatResponsesInput(prompt, messages)
        }
    } else {
        // New conversation - input is required
        requestBody.input = formatResponsesInput(prompt, messages)
    }

    // Reasoning configuration (for o-series and gpt-5 models)
    if (reasoningEffort) {
        requestBody.reasoning = { effort: reasoningEffort }
    }

    // Text output configuration
    if (textFormat || textVerbosity) {
        requestBody.text = {}
        if (textFormat) requestBody.text.format = textFormat
        if (textVerbosity) requestBody.text.verbosity = textVerbosity
    }

    // Tools configuration
    if (tools && Array.isArray(tools) && tools.length > 0) {
        requestBody.tools = tools
        if (toolChoice !== undefined) requestBody.tool_choice = toolChoice
        if (parallelToolCalls !== undefined) requestBody.parallel_tool_calls = parallelToolCalls
        if (maxToolCalls !== undefined) requestBody.max_tool_calls = maxToolCalls
    }

    // Include additional data in response
    if (include && Array.isArray(include) && include.length > 0) {
        requestBody.include = include
    }

    // Optional sampling parameters (only supported parameters)
    if (topP !== undefined) requestBody.top_p = topP
    if (topLogprobs !== undefined) requestBody.top_logprobs = topLogprobs
    if (stop !== undefined) requestBody.stop = stop
    if (seed !== undefined) requestBody.seed = seed

    // Note: frequency_penalty, presence_penalty, and logit_bias are NOT supported
    // in Responses API and are silently ignored if passed

    // Context management
    if (contextManagement && Array.isArray(contextManagement)) {
        requestBody.context_management = contextManagement
    }

    // Caching
    if (promptCacheKey) requestBody.prompt_cache_key = promptCacheKey
    if (promptCacheRetention) requestBody.prompt_cache_retention = promptCacheRetention

    // Service configuration
    if (serviceTier) requestBody.service_tier = serviceTier
    if (store !== undefined) requestBody.store = store
    if (truncation) requestBody.truncation = truncation
    if (background !== undefined) requestBody.background = background

    // Safety and metadata
    if (safetyIdentifier) requestBody.safety_identifier = safetyIdentifier
    if (user) requestBody.user = user
    if (metadata) requestBody.metadata = metadata

    // Note: These parameters are NOT supported in Responses API
    // frequency_penalty, presence_penalty are deprecated
    // Use the moderation parameter or text configuration instead

    return requestBody
}

/**
 * Validate Responses API request body structure
 * Ensures all parameters match the Responses API specification
 *
 * @param {Object} requestBody - Request body to validate
 * @returns {Object} - Validation result with isValid and errors array
 */
export function validateResponsesAPIPayload(requestBody) {
    const errors = []

    // Required fields
    if (!requestBody.model) {
        errors.push("Missing required field: model")
    }

    // Input validation (required unless continuing with previous_response_id)
    if (!requestBody.previous_response_id && !requestBody.input) {
        errors.push("Missing required field: input (or previous_response_id for continuation)")
    }

    // Input format validation
    if (requestBody.input) {
        if (typeof requestBody.input !== "string" && !Array.isArray(requestBody.input)) {
            errors.push("Invalid input format: must be string or array")
        }

        if (Array.isArray(requestBody.input)) {
            const hasInvalidMessage = requestBody.input.some((msg) => !msg.role || !msg.content)
            if (hasInvalidMessage) {
                errors.push("Invalid input array: each message must have role and content")
            }
        }
    }

    // Check for old Chat Completions parameters
    if (requestBody.messages) {
        errors.push("Invalid parameter: 'messages' should be 'input' in Responses API")
    }

    if (requestBody.max_tokens) {
        errors.push(
            "Invalid parameter: 'max_tokens' should be 'max_output_tokens' or 'max_completion_tokens' in Responses API"
        )
    }

    if (requestBody.response_format) {
        errors.push("Invalid parameter: 'response_format' should be 'text.format' in Responses API")
    }

    // Token limit validation
    if (requestBody.max_output_tokens && typeof requestBody.max_output_tokens !== "number") {
        errors.push("Invalid max_output_tokens: must be a number")
    }

    if (requestBody.max_completion_tokens && typeof requestBody.max_completion_tokens !== "number") {
        errors.push("Invalid max_completion_tokens: must be a number")
    }

    // Store parameter validation
    if (requestBody.store !== undefined && typeof requestBody.store !== "boolean") {
        errors.push("Invalid store parameter: must be boolean")
    }

    // Tools validation
    if (requestBody.tools) {
        if (!Array.isArray(requestBody.tools)) {
            errors.push("Invalid tools parameter: must be an array")
        } else {
            const hasInvalidTool = requestBody.tools.some((tool) => !tool.type)
            if (hasInvalidTool) {
                errors.push("Invalid tools: each tool must have a type property")
            }
        }
    }

    // Reasoning effort validation
    if (requestBody.reasoning?.effort) {
        const validEfforts = ["none", "minimal", "low", "medium", "high", "xhigh"]
        if (!validEfforts.includes(requestBody.reasoning.effort)) {
            errors.push(`Invalid reasoning.effort: must be one of ${validEfforts.join(", ")}`)
        }
    }

    // Check for deprecated parameters
    if (requestBody.frequency_penalty !== undefined) {
        errors.push("Deprecated parameter: 'frequency_penalty' is not supported in Responses API")
    }

    if (requestBody.presence_penalty !== undefined) {
        errors.push("Deprecated parameter: 'presence_penalty' is not supported in Responses API")
    }

    if (requestBody.logit_bias !== undefined) {
        errors.push("Deprecated parameter: 'logit_bias' is not supported in Responses API")
    }

    if (requestBody.reasoning_effort !== undefined) {
        errors.push("Invalid parameter: 'reasoning_effort' should be 'reasoning.effort' in Responses API")
    }

    return {
        isValid: errors.length === 0,
        errors: errors,
    }
}

/**
 * Validate Chat Completions API request body structure
 * Ensures all parameters match the Chat Completions API specification
 *
 * @param {Object} requestBody - Request body to validate
 * @returns {Object} - Validation result with isValid and errors array
 */
export function validateChatCompletionsPayload(requestBody) {
    const errors = []

    // Required fields
    if (!requestBody.model) {
        errors.push("Missing required field: model")
    }

    if (!requestBody.messages) {
        errors.push("Missing required field: messages")
    }

    // Messages validation
    if (requestBody.messages && !Array.isArray(requestBody.messages)) {
        errors.push("Invalid messages format: must be an array")
    }

    if (Array.isArray(requestBody.messages)) {
        const hasInvalidMessage = requestBody.messages.some((msg) => !msg.role || !msg.content)
        if (hasInvalidMessage) {
            errors.push("Invalid messages array: each message must have role and content")
        }
    }

    // Check for Responses API specific parameters
    if (requestBody.input) {
        errors.push("Invalid parameter: 'input' should be 'messages' in Chat Completions API")
    }

    if (requestBody.instructions) {
        errors.push(
            "Invalid parameter: 'instructions' not supported in Chat Completions API (use system message)"
        )
    }

    if (requestBody.previous_response_id) {
        errors.push("Invalid parameter: 'previous_response_id' not supported in Chat Completions API")
    }

    if (requestBody.max_output_tokens) {
        errors.push("Invalid parameter: 'max_output_tokens' should be 'max_tokens' in Chat Completions API")
    }

    // Token limit validation
    if (requestBody.max_tokens && typeof requestBody.max_tokens !== "number") {
        errors.push("Invalid max_tokens: must be a number")
    }

    // Tools validation
    if (requestBody.tools) {
        if (!Array.isArray(requestBody.tools)) {
            errors.push("Invalid tools parameter: must be an array")
        }
    }

    return {
        isValid: errors.length === 0,
        errors: errors,
    }
}

/**
 * Extract text content from Responses API output
 * Handles the new `output` array structure
 *
 * @param {Object} data - Response data from Responses API
 * @returns {string} - Extracted text content
 */
export function extractResponsesText(data) {
    if (!data.output || !Array.isArray(data.output)) {
        return ""
    }

    // Find the message item with output_text
    const messageItem = data.output.find((item) => item.type === "message")

    if (!messageItem?.content || !Array.isArray(messageItem.content)) {
        return ""
    }

    // Extract text from content array
    const textContent = messageItem.content
        .filter((c) => c.type === "output_text")
        .map((c) => c.text)
        .join("")

    return textContent
}

/**
 * Extract text delta from Responses API streaming events
 * Handles response.output_item.delta and response.output_text.delta events
 *
 * @param {Object} parsed - Parsed SSE event data
 * @returns {string} - Extracted text delta
 */
export function extractResponsesDeltaText(parsed) {
    // Handle different delta structures
    if (parsed.delta && typeof parsed.delta === "string") {
        return parsed.delta
    }

    if (parsed.delta?.content) {
        // Content can be string or array of content items
        if (typeof parsed.delta.content === "string") {
            return parsed.delta.content
        }

        if (Array.isArray(parsed.delta.content)) {
            return parsed.delta.content
                .filter((c) => c.type === "output_text" || c.type === "text")
                .map((c) => c.text || c.delta?.text || "")
                .join("")
        }
    }

    // Fallback for item with content array
    if (parsed.content && Array.isArray(parsed.content)) {
        return parsed.content
            .filter((c) => c.type === "output_text")
            .map((c) => c.text)
            .join("")
    }

    return ""
}

/**
 * Parse Responses API output items
 * Categorizes output items by type (reasoning, tool calls, messages)
 *
 * @param {Object} data - Response data from Responses API
 * @returns {Object} - Categorized output items
 */
export function parseResponsesOutput(data) {
    if (!data.output || !Array.isArray(data.output)) {
        return {
            reasoning: [],
            toolCalls: [],
            messages: [],
            text: "",
        }
    }

    const result = {
        reasoning: [],
        toolCalls: [],
        messages: [],
        text: "",
    }

    data.output.forEach((item) => {
        switch (item.type) {
            case "reasoning":
                result.reasoning.push({
                    id: item.id,
                    content: item.content,
                    summary: item.summary,
                })
                break

            case "web_search_call":
            case "code_interpreter_call":
            case "function_call":
                result.toolCalls.push({
                    id: item.id,
                    type: item.type,
                    data: item[item.type] || item,
                })
                break

            case "message":
                result.messages.push({
                    id: item.id,
                    role: item.role,
                    status: item.status,
                    content: item.content,
                })

                // Extract text from message content
                if (item.content && Array.isArray(item.content)) {
                    const text = item.content
                        .filter((c) => c.type === "output_text")
                        .map((c) => c.text)
                        .join("")
                    result.text += text
                }
                break
        }
    })

    return result
}

/**
 * Convert Responses API response to Chat Completions format
 * For backward compatibility with existing code expecting Chat Completions structure
 *
 * @param {Object} data - Response data from Responses API
 * @returns {Object} - Chat Completions compatible format
 */
export function convertResponsesToChatFormat(data) {
    const text = extractResponsesText(data)
    const parsed = parseResponsesOutput(data)

    return {
        id: data.id,
        object: "chat.completion",
        created: data.created_at,
        model: data.model,
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: text,
                },
                finish_reason: parsed.messages[0]?.status || "stop",
            },
        ],
        usage: {
            prompt_tokens: data.usage?.prompt_tokens || 0,
            completion_tokens: data.usage?.completion_tokens || 0,
            total_tokens: data.usage?.total_tokens || 0,
        },
        // Preserve Responses API specific fields
        responseId: data.id,
        conversationId: data.conversation_id,
        output: data.output,
        parsedOutput: parsed,
    }
}

/**
 * Convert Chat Completion API response to Responses API format
 * This standardizes the format to use Response API pattern everywhere
 *
 * @param {Object} data - Chat Completion API response
 * @returns {Object} - Response API format
 */
export function convertChatToResponsesFormat(data) {
    const choice = data.choices?.[0]
    const content = choice?.message?.content || ""

    return {
        id: data.id,
        object: "response",
        created_at: data.created,
        model: data.model,
        status: "completed",
        output: [
            {
                type: "message",
                role: "assistant",
                content: [
                    {
                        type: "output_text",
                        text: content,
                    },
                ],
                status: choice?.finish_reason || "stop",
            },
        ],
        usage: {
            prompt_tokens: data.usage?.prompt_tokens || 0,
            completion_tokens: data.usage?.completion_tokens || 0,
            total_tokens: data.usage?.total_tokens || 0,
        },
        // Preserve Chat Completion API specific fields for reference
        chatCompletionId: data.id,
        finishReason: choice?.finish_reason,
    }
}

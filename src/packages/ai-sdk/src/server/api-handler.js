/**
 * API Handler
 * Server-side handler for processing AI requests
 * Supports both streaming and non-streaming responses
 */

import * as openaiProvider from "../providers/openai/index.js"
import * as anthropicProvider from "../providers/anthropic/index.js"
import { formatSSE } from "../core/stream-processor.js"
import { API_HANDLER_DEFAULTS, VALIDATION_DEFAULTS, ERROR_MESSAGES } from "../config/defaults.js"
import { extractResponsesText } from "../providers/openai/openai-utils.js"

/**
 * Available providers
 */
const PROVIDERS = {
    openai: openaiProvider,
    anthropic: anthropicProvider,
}

/**
 * Get provider by name
 */
function getProvider(providerName) {
    const provider = PROVIDERS[providerName]
    if (!provider) {
        throw new Error(
            `Unsupported provider: ${providerName}. Available: ${Object.keys(PROVIDERS).join(", ")}`
        )
    }
    return provider
}

/**
 * Validate request body
 */
function validateRequest(body, hasDefaultApiKey = false) {
    if (!body) {
        return { valid: false, error: "Request body is required" }
    }

    if (!body.prompt && !body.messages) {
        return { valid: false, error: ERROR_MESSAGES.MISSING_PROMPT_OR_MESSAGES }
    }

    if (!body.apiKey && !hasDefaultApiKey) {
        return { valid: false, error: ERROR_MESSAGES.MISSING_API_KEY }
    }

    // Validate messages array if provided
    if (body.messages) {
        if (!Array.isArray(body.messages)) {
            return { valid: false, error: ERROR_MESSAGES.INVALID_MESSAGES_FORMAT }
        }

        if (body.messages.length === 0) {
            return { valid: false, error: ERROR_MESSAGES.EMPTY_MESSAGES }
        }

        // Check max messages count
        if (body.messages.length > VALIDATION_DEFAULTS.messages.maxCount) {
            return {
                valid: false,
                error: `Messages array exceeds maximum count of ${VALIDATION_DEFAULTS.messages.maxCount}`,
            }
        }

        // Validate message structure
        for (let i = 0; i < body.messages.length; i++) {
            const msg = body.messages[i]
            if (!msg.role || typeof msg.role !== "string") {
                return { valid: false, error: `Message at index ${i} missing valid role` }
            }
            if (msg.content === undefined || msg.content === null) {
                return { valid: false, error: `Message at index ${i} missing content` }
            }
        }
    }

    // Validate prompt if provided
    if (body.prompt) {
        if (typeof body.prompt !== "string") {
            return { valid: false, error: "Prompt must be a string" }
        }
        if (body.prompt.trim().length === 0) {
            return { valid: false, error: ERROR_MESSAGES.EMPTY_PROMPT }
        }
        if (body.prompt.length > VALIDATION_DEFAULTS.prompt.maxLength) {
            return {
                valid: false,
                error: `Prompt exceeds maximum length of ${VALIDATION_DEFAULTS.prompt.maxLength} characters`,
            }
        }
    }

    // Validate optional parameters using validation defaults
    if (body.temperature !== undefined) {
        const temp = Number(body.temperature)
        const { min, max } = VALIDATION_DEFAULTS.temperature
        if (isNaN(temp) || temp < min || temp > max) {
            return { valid: false, error: `${ERROR_MESSAGES.INVALID_TEMPERATURE} (${min}-${max})` }
        }
    }

    if (body.maxTokens !== undefined) {
        const tokens = Number(body.maxTokens)
        if (isNaN(tokens) || tokens < VALIDATION_DEFAULTS.tokens.min) {
            return { valid: false, error: ERROR_MESSAGES.INVALID_MAX_TOKENS }
        }
        if (tokens > VALIDATION_DEFAULTS.tokens.max) {
            return {
                valid: false,
                error: `maxTokens exceeds maximum of ${VALIDATION_DEFAULTS.tokens.max}`,
            }
        }
    }

    return { valid: true }
}

/**
 * Handle non-streaming generation
 */
async function handleGeneration(req, res, provider) {
    try {
        const result = await provider.textGenerate(req.body)

        // textGenerate now returns Response API format (converted from Chat Completions)
        // Extract text from Response API output structure
        const text = extractResponsesText(result)

        // Normalize response format for consistent client consumption
        const normalizedResult = {
            ...result,
            text: text,
            content: text,
            // Keep original Response API fields
        }

        res.json(normalizedResult)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
}

/**
 * Handle streaming generation
 */
async function handleStreaming(req, res, provider) {
    try {
        // Set SSE headers from defaults with explicit no-cache
        Object.entries(API_HANDLER_DEFAULTS.headers).forEach(([key, value]) => {
            res.setHeader(key, value)
        })
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Cache-Control", "no-cache, no-transform")
        res.setHeader("X-Accel-Buffering", "no") // Disable nginx buffering

        // Disable compression for this response
        res.removeHeader("Content-Encoding")
        
        // Force unbuffered mode in Node.js
        res.socket?.setNoDelay?.(true)
        res.socket?.setTimeout?.(0)

        // Send initial data to establish connection
        // NOTE: this must be real newlines (\n), not the literal characters "\\n".
        // In SSE, a comment line starts with ":" and an empty line ends the event.
        res.write(":ok\n\n")
        if (res.flush) res.flush()
        // Get stream from provider
        const streamBody = await provider.textStream(req.body)
        const reader = streamBody.getReader()

        // Create stream processor
        const processor = provider.createStreamProcessor()

        // Process and send chunks
        for await (const chunk of processor.processStream(reader)) {
            if (chunk.type === "text-delta") {
                const sseData = formatSSE({
                    type: "text-delta",
                    delta: chunk.delta,
                })
                res.write(sseData)
                // Flush the response immediately to ensure streaming
                if (res.flush) {
                    res.flush()
                }
                // Fallback for environments without res.flush
                if (res.socket && !res.flush) {
                    res.socket.write('')
                }
            } else if (chunk.type === "error") {
                res.write(
                    formatSSE({
                        type: "error",
                        error: chunk.error,
                    })
                )
                if (res.flush) res.flush()
                break
                } else if (chunk.type === "done") {
                    res.write("data: [DONE]\n\n")
                    if (res.flush) res.flush()
                    break
                }
        }

        res.end()
    } catch (error) {
        // Try to send error as SSE if headers already sent
        if (res.headersSent) {
            try {
                res.write(
                    formatSSE({
                        type: "error",
                        error: error.message,
                    })
                )
                res.end()
            } catch (writeError) {
                try {
                    res.end()
                } catch {
                    // Connection already closed
                }
            }
        } else {
            // Headers not sent yet, send as JSON error
            try {
                res.status(500).json({ error: error.message })
            } catch (jsonError) {
                // Failed to send error response
            }
        }
    }
}

/**
 * Handle non-streaming generation using new Responses API
 */
async function handleResponseGeneration(req, res, provider) {
    try {
        const result = await provider.responseGenerate(req.body)

        // Normalize response format for consistent client consumption
        // Responses API returns: result.text (already extracted), result.output (raw), result.responseId
        // We need to ensure 'content' field exists for compatibility with useDialogue hook
        const normalizedResult = {
            ...result,
            content: result.text || "",
            // Keep original fields for backward compatibility
        }

        res.json(normalizedResult)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
}

/**
 * Handle streaming using new Responses API
 */
async function handleResponseStreaming(req, res, provider) {
    try {

        // Set SSE headers with explicit no-cache and chunked encoding
        Object.entries(API_HANDLER_DEFAULTS.headers).forEach(([key, value]) => {
            res.setHeader(key, value)
        })
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Cache-Control", "no-cache, no-transform")
        res.setHeader("X-Accel-Buffering", "no") // Disable nginx buffering
        res.removeHeader("Content-Encoding")
        
        // Force unbuffered mode in Node.js
        res.socket?.setNoDelay?.(true)
        res.socket?.setTimeout?.(0)

        // NOTE: this must be real newlines (\n), not the literal characters "\\n".
        res.write(":ok\n\n")
        if (res.flush) res.flush()
        const streamBody = await provider.responseStream(req.body)
        const reader = streamBody.getReader()

        // Use new Responses API stream processor
        const processor = provider.createResponseStreamProcessor()

        // Process and send chunks
        for await (const chunk of processor.processStream(reader)) {
            // Send all chunk types as SSE
            const sseData = formatSSE(chunk)
            res.write(sseData)
            
            // Force immediate flush - critical for streaming
            if (res.flush) {
                res.flush()
            }
            // Fallback for environments without res.flush
            if (res.socket && !res.flush) {
                res.socket.write('')
            }

            if (chunk.type === "done" || chunk.type === "error") {
                break
            }
        }

        res.end()
    } catch (error) {
        if (res.headersSent) {
            try {
                res.write(
                    formatSSE({
                        type: "error",
                        error: error.message,
                    })
                )
                res.end()
            } catch (writeError) {
                try {
                    res.end()
                } catch {
                    // Connection already closed
                }
            }
        } else {
            try {
                res.status(500).json({ error: error.message })
            } catch (jsonError) {
                // Failed to send error response
            }
        }
    }
}

/**
 * Create API handler
 *
 * @param {Object} config - Handler configuration
 * @param {string} config.provider - Default provider name
 * @param {string} config.apiKey - Default API key
 * @param {string} config.model - Default model
 * @param {boolean} config.useChatCompletions - Use legacy Chat Completions API (default: false = Responses API)
 * @param {boolean} config.store - Enable stateful conversations (Responses API only)
 * @param {string} config.reasoningEffort - Reasoning effort: low/medium/high (for o3-mini, o4-mini)
 * @param {boolean} config.includeReasoning - Stream reasoning tokens (Responses API only)
 *
 * @returns {Function} Express/Node.js request handler
 */
export function createAPIHandler(config = {}) {
    return async (req, res) => {
        // Only accept POST requests
        if (req.method !== "POST") {
            return res.status(405).json({ error: "Method not allowed" })
        }

        try {

            // Merge config with request body
            const requestData = {
                ...config,
                ...req.body,
                apiKey: req.body.apiKey || config.apiKey,
            }

            // Validate request (pass whether we have default API key)
            const validation = validateRequest(requestData, !!config.apiKey)
            if (!validation.valid) {
                return res.status(400).json({ error: validation.error })
            }

            // Get provider
            const providerName = requestData.provider || "openai"
            const provider = getProvider(providerName)

            // Update request body with merged data
            req.body = requestData

            // Check which API to use
            const useChatCompletions = requestData.useChatCompletions ?? config.useChatCompletions ?? false

            // Handle based on API selection and stream mode
            if (!useChatCompletions && provider.responseGenerate && provider.responseStream) {
                // Use Responses API (default)
                if (requestData.stream) {
                    await handleResponseStreaming(req, res, provider)
                } else {
                    await handleResponseGeneration(req, res, provider)
                }
            } else {
                // Use legacy Chat Completions API
                if (requestData.stream) {
                    await handleStreaming(req, res, provider)
                } else {
                    await handleGeneration(req, res, provider)
                }
            }
            } catch (error) {
                if (!res.headersSent) {
                res.status(500).json({ error: error.message })
            }
        }
    }
}

/**
 * Create chat-specific handler
 */
export function createChatHandler(config = {}) {
    return createAPIHandler({
        ...config,
        stream: config.stream ?? API_HANDLER_DEFAULTS.stream,
    })
}

/**
 * Create completion-specific handler
 */
export function createCompletionHandler(config = {}) {
    return createAPIHandler({
        ...config,
        stream: config.stream ?? API_HANDLER_DEFAULTS.stream,
    })
}

/**
 * Express middleware for parsing body
 */
export function bodyParserMiddleware(req, res, next) {
    if (req.method === "POST") {
        let body = ""

        req.on("data", (chunk) => {
            body += chunk.toString()
        })

        req.on("end", () => {
            try {
                req.body = JSON.parse(body)
                next()
            } catch (error) {
                res.status(400).json({ error: "Invalid JSON" })
            }
        })
    } else {
        next()
    }
}

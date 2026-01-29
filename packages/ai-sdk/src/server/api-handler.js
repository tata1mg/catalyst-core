/**
 * API Handler
 * Server-side handler for processing AI requests
 * Supports both streaming and non-streaming responses
 */

import * as openaiProvider from "./providers/openai.js"
import * as anthropicProvider from "./providers/anthropic.js"
import { formatSSE } from "../core/stream-processor.js"

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
        return { valid: false, error: "Either prompt or messages is required" }
    }

    if (!body.apiKey && !hasDefaultApiKey) {
        return { valid: false, error: "API key is required" }
    }

    // Validate messages array if provided
    if (body.messages) {
        if (!Array.isArray(body.messages)) {
            return { valid: false, error: "Messages must be an array" }
        }

        if (body.messages.length === 0) {
            return { valid: false, error: "Messages array cannot be empty" }
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
            return { valid: false, error: "Prompt cannot be empty" }
        }
    }

    // Validate optional parameters
    if (body.temperature !== undefined) {
        const temp = Number(body.temperature)
        if (isNaN(temp) || temp < 0 || temp > 2) {
            return { valid: false, error: "Temperature must be between 0 and 2" }
        }
    }

    if (body.maxTokens !== undefined) {
        const tokens = Number(body.maxTokens)
        if (isNaN(tokens) || tokens < 1) {
            return { valid: false, error: "maxTokens must be a positive number" }
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
        res.json(result)
    } catch (error) {
        console.error("Generation error:", error)
        res.status(500).json({ error: error.message })
    }
}

/**
 * Handle streaming generation
 */
async function handleStreaming(req, res, provider) {
    try {
        console.log("🌊 Starting streaming response...")

        // Set SSE headers
        res.setHeader("Content-Type", "text/event-stream")
        res.setHeader("Cache-Control", "no-cache, no-transform")
        res.setHeader("Connection", "keep-alive")
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("X-Accel-Buffering", "no") // Disable nginx buffering
        
        // Disable compression for this response
        res.removeHeader("Content-Encoding")
        
        // Send initial data to establish connection
        res.write(":ok\\n\\n")
        if (res.flush) res.flush()

        console.log("📡 Calling provider.textStream...")
        // Get stream from provider
        const streamBody = await provider.textStream(req.body)
        const reader = streamBody.getReader()

        console.log("✅ Stream initialized, processing chunks...")

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
                if (res.flush) res.flush()
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
                res.write("data: [DONE]\\n\\n")
                if (res.flush) res.flush()
                break
            }
        }

        res.end()
    } catch (error) {
        console.error("Streaming error:", error)

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
                console.error("Failed to write error to stream:", writeError)
                // Connection might be broken, just end silently
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
                console.error("Failed to send JSON error:", jsonError)
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
            console.log("📥 API Request received:", {
                method: req.method,
                hasBody: !!req.body,
                bodyKeys: req.body ? Object.keys(req.body) : [],
                configKeys: Object.keys(config),
            })

            // Merge config with request body
            const requestData = {
                ...config,
                ...req.body,
                apiKey: req.body.apiKey || config.apiKey,
            }

            console.log("🔑 API Key status:", {
                hasApiKey: !!requestData.apiKey,
                apiKeySource: req.body.apiKey ? "request" : "config",
                provider: requestData.provider,
                model: requestData.model,
            })

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

            // Handle based on stream mode
            if (requestData.stream) {
                await handleStreaming(req, res, provider)
            } else {
                await handleGeneration(req, res, provider)
            }
        } catch (error) {
            console.error("API handler error:", error)

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
        stream: true, // Default to streaming for chat
    })
}

/**
 * Create completion-specific handler
 */
export function createCompletionHandler(config = {}) {
    return createAPIHandler({
        ...config,
        stream: true, // Default to streaming for completion
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

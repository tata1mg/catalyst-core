/**
 * Anthropic Utility Functions
 * Helper functions for Anthropic provider
 */

/**
 * Anthropic Provider Configuration
 */
export const ANTHROPIC_CONFIG = {
    baseURL: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-sonnet-20241022",
    version: "2023-06-01",
    models: {
        "claude-3-opus": "claude-3-opus-20240229",
        "claude-3-sonnet": "claude-3-sonnet-20240229",
        "claude-3-haiku": "claude-3-haiku-20240307",
        "claude-3-5-sonnet": "claude-3-5-sonnet-20241022",
    },
}

/**
 * Format messages for Anthropic API
 */
export function formatMessages(prompt, messages) {
    if (messages && Array.isArray(messages)) {
        return messages
            .filter((msg) => msg.role !== "system")
            .map((msg) => ({
                role: msg.role === "assistant" ? "assistant" : "user",
                content: msg.content,
            }))
    }

    if (prompt) {
        return [{ role: "user", content: prompt }]
    }

    throw new Error("Either prompt or messages must be provided")
}

/**
 * Extract system message if present
 */
export function extractSystemMessage(messages) {
    if (!messages || !Array.isArray(messages)) return null
    const systemMsg = messages.find((msg) => msg.role === "system")
    return systemMsg?.content || null
}

/**
 * List available models
 */
export function listModels() {
    return Object.keys(ANTHROPIC_CONFIG.models)
}
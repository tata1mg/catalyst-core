/**
 * Anthropic Provider - Main Export
 * 
 * This module provides the Anthropic provider interface
 * for the AI SDK.
 */

import { textGenerate, textStream, createStreamProcessor } from "./anthropic.js"
import { ANTHROPIC_CONFIG, listModels } from "./anthropic-utils.js"

// Export provider functions
export { textGenerate, textStream, createStreamProcessor }

// Export utility functions
export { listModels }

/**
 * Export provider info
 */
export const providerInfo = {
    name: "anthropic",
    models: ANTHROPIC_CONFIG.models,
    defaultModel: ANTHROPIC_CONFIG.defaultModel,
}
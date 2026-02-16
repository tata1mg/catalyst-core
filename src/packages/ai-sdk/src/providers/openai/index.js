/**
 * OpenAI Provider - Main Export
 * 
 * This module provides the OpenAI provider interface
 * for the AI SDK.
 */

import { 
    textGenerate, 
    textStream, 
    createStreamProcessor,
    responseGenerate,
    responseStream,
    createResponseStreamProcessor 
} from "./openai.js"
import {
    OPENAI_CONFIG,
    listModels,
    supportsCapability,
    getRecommendedModel,
    supportsNativeTools,
    supportsReasoning,
} from "./openai-utils.js"

// Export provider functions (Chat Completions API - Legacy)
export { textGenerate, textStream, createStreamProcessor }

// Export new Responses API functions (Recommended for new apps)
export { responseGenerate, responseStream, createResponseStreamProcessor }

// Export utility functions
export { 
    listModels, 
    supportsCapability, 
    getRecommendedModel,
    supportsNativeTools,
    supportsReasoning,
}

/**
 * Export provider info
 */
export const providerInfo = {
    name: "openai",
    models: OPENAI_CONFIG.models,
    defaultModel: OPENAI_CONFIG.defaultModel,
    capabilities: OPENAI_CONFIG.capabilities,
    nativeTools: OPENAI_CONFIG.nativeTools,
    listModels,
    supportsCapability,
    getRecommendedModel,
    supportsNativeTools,
    supportsReasoning,
}
/**
 * @ai-sdk/core
 * Main export file for AI SDK
 * 
 * A lightweight AI SDK for building LLM-powered applications with React
 * Supports OpenAI and Anthropic with streaming capabilities
 */

// ==========================================
// CLIENT-SIDE EXPORTS
// ==========================================
export * from "./client/index.js"

// ==========================================
// SERVER-SIDE EXPORTS
// ==========================================
export * from "./server/index.js"

// ==========================================
// CORE UTILITIES
// ==========================================
export * from "./core/index.js"

// ==========================================
// DEFAULT EXPORT (for convenience)
// ==========================================
import { textGenerate, textStream, useDialogue, usePrompt } from "./client/index.js"
import { createAPIHandler, createChatHandler, createCompletionHandler } from "./server/index.js"

export default {
    // Client
    textGenerate,
    textStream,
    useDialogue,
    usePrompt,
    
    // Server
    createAPIHandler,
    createChatHandler,
    createCompletionHandler,
}

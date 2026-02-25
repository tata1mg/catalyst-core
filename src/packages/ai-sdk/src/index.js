/**
 * @catalyst/ai-sdk
 * Main export file for AI SDK
 *
 * A lightweight AI SDK for building LLM-powered applications
 * Supports OpenAI and Anthropic with streaming capabilities
 *
 * This entry point exports:
 * - Client functions: textGenerate, textStream
 *
 * For server handlers: @catalyst/ai-sdk/server
 * For React hooks: @catalyst/ai-sdk-react
 * For core utilities: @catalyst/ai-sdk/core
 */

// ==========================================
// PUBLIC CLIENT API
// ==========================================
// Client functions
export { textGenerate, textGenerateWithMessages } from "./client/text-generate.js"
export { textStream, textStreamWithMessages } from "./client/text-stream.js"

// ==========================================
// DEFAULT EXPORT (for convenience)
// ==========================================
import { textGenerate, textStream } from "./client/index.js"

export default {
    // Client functions
    textGenerate,
    textStream,
}

/**
 * AI SDK Client Exports
 * Client-side functionality (text generation and streaming)
 * 
 * Note: React hooks are NOT exported from here
 * For React hooks, use: @catalyst/ai-sdk/react
 */

// Core functions
export { textGenerate, textGenerateWithMessages } from "./text-generate.js"
export { textStream, textStreamWithMessages } from "./text-stream.js"
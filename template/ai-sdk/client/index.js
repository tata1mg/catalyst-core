/**
 * AI SDK Client Exports
 * Main client-side functionality
 */

// Core functions
export { textGenerate, textGenerateWithMessages } from "./text-generate.js"
export { textStream, textStreamWithMessages } from "./text-stream.js"

// React Hooks (re-export from hooks/index.js for convenience)
export { useDialogue, usePrompt } from "./hooks/index.js"
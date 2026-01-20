/**
 * AI SDK v2
 * Main export file
 * 
 * Client => Server => LLM flow with streaming support
 */

// ==========================================
// CLIENT-SIDE EXPORTS
// ==========================================

// Core functions
export { textGenerate, textGenerateWithMessages } from './client/text-generate.js';
export { textStream, textStreamWithMessages } from './client/text-stream.js';

// React Hooks
export { useDialogue } from './client/hooks/use-dialogue.js';
export { usePrompt } from './client/hooks/use-prompt.js';

// ==========================================
// SERVER-SIDE EXPORTS
// ==========================================

// API Handlers
export {
  createAPIHandler,
  createChatHandler,
  createCompletionHandler,
  bodyParserMiddleware
} from './server/api-handler.js';

// Providers
export * as openaiProvider from './server/providers/openai.js';
export * as anthropicProvider from './server/providers/anthropic.js';

// ==========================================
// CORE UTILITIES
// ==========================================

// Stream processing
export {
  processTextStream,
  createStreamWrapper,
  parseSSELine,
  formatSSE,
  createCompletionSignal
} from './core/stream-processor.js';

// HTTP client
export {
  makeRequest,
  makeJSONRequest,
  makeStreamRequest,
  createAbortController,
  handleAPIError,
  validatePayload
} from './core/http-client.js';

// State management
export {
  createInitialChatState,
  createInitialCompletionState,
  CHAT_ACTIONS,
  COMPLETION_ACTIONS,
  chatReducer,
  completionReducer,
  generateId,
  createMessage,
  validateMessage
} from './core/state-manager.js';

// ==========================================
// EXAMPLES
// ==========================================

export { ChatExample } from './examples/ChatExample.js';
export { CompletionExample } from './examples/CompletionExample.js';

// ==========================================
// DEFAULT EXPORT (for convenience)
// ==========================================

export default {
  // Client
  textGenerate,
  textStream,
  useDialogue,
  usePrompt,
  
  // Server
  createAPIHandler,
  createChatHandler,
  createCompletionHandler
};
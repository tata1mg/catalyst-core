/**
 * AI SDK Core Exports
 * Core utilities and processors
 */

// Stream processing
export {
    processTextStream,
    createStreamWrapper,
    parseSSELine,
    formatSSE,
    createCompletionSignal,
} from "./stream-processor.js"

// HTTP client
export {
    makeRequest,
    makeJSONRequest,
    makeStreamRequest,
    createAbortController,
    handleAPIError,
    validatePayload,
} from "./http-client.js"

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
    validateMessage,
} from "./state-manager.js"

// Rate limiter (default export, re-exported as named)
export { default as RateLimiter } from "./rate-limiter.js"
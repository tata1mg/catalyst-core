/**
 * AI SDK Core Exports
 * Core utilities and processors
 * 
 * Note: State management has been moved to @catalyst/ai-sdk-react
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

// Rate limiter (default export, re-exported as named)
export { default as RateLimiter } from "./rate-limiter.js"
/**
 * AI SDK Core Exports
 * Core utilities and processors
 * 
 * Note: State management has been moved to @catalyst/ai-sdk-react
 */

// Stream processing (public API for client-side usage)
export {
    processTextStream,
    createStreamWrapper,
    createCompletionSignal,
} from "./stream-processor.js"

// Note: parseSSELine and formatSSE are internal utilities used by api-handler.js
// They are not exported as they are implementation details of the SSE protocol

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

// Note: Configuration defaults (PROVIDER_DEFAULTS, HTTP_CLIENT_DEFAULTS, etc.)
// are internal and not exported. Internal modules import directly from ../config/defaults.js
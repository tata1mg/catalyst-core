/**
 * AI SDK Server Exports
 * Server-side API handlers ONLY
 *
 * Providers (OpenAI, Anthropic) are internal implementation details
 * and should NOT be exposed to end users. They are used internally
 * by the API handlers.
 */

const isBrowserRuntime = typeof window !== "undefined" && typeof window.document !== "undefined"

const isNodeRuntime =
    typeof process !== "undefined" &&
    process.release?.name === "node" &&
    typeof process.versions?.node === "string"

if (!isNodeRuntime || isBrowserRuntime) {
    const error = new Error(
        "[AI SDK] `@catalyst/ai-sdk/server` is restricted to Node.js environments. " +
            "Use `@catalyst/ai-sdk/client` instead for browser usage."
    )
    error.code = "ERR_AI_SDK_SERVER_ONLY"
    throw error
}

// ==========================================
// PUBLIC SERVER API (High-level handlers only)
// ==========================================
export {
    createAPIHandler,
    createChatHandler,
    createCompletionHandler,
    bodyParserMiddleware,
} from "./api-handler.js"

// ==========================================
// INTERNAL ONLY - NOT EXPORTED
// ==========================================
// Providers (openai.js, anthropic.js) are internal implementation details.
// End users should use createAPIHandler with provider name as string:
// Example: createAPIHandler({ provider: "openai", ... })

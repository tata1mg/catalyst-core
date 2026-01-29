/**
 * @catalyst/ai-sdk-react
 * React hooks and state management for AI SDK
 *
 * A React integration layer for @catalyst/ai-sdk providing hooks for
 * building LLM-powered applications with OpenAI and Anthropic
 *
 * This package provides:
 * - React hooks: useDialogue, usePrompt
 * - State management utilities
 * 
 * Core functionality is provided by @catalyst/ai-sdk/core
 */

// ==========================================
// PUBLIC REACT HOOKS API
// ==========================================
export { useDialogue, usePrompt } from "./hooks/index.js"

// ==========================================
// STATE MANAGEMENT UTILITIES
// ==========================================
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

// ==========================================
// DEFAULT EXPORT (for convenience)
// ==========================================
import { useDialogue, usePrompt } from "./hooks/index.js"

export default {
    useDialogue,
    usePrompt,
}
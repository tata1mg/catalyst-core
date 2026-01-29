/**
 * State Manager
 * Manages component state with reducers
 */

/**
 * Create initial state for chat
 */
export function createInitialChatState(options = {}) {
    return {
        messages: options.initialMessages || [],
        input: options.initialInput || "",
        isLoading: false,
        error: null,
    }
}

/**
 * Create initial state for completion
 */
export function createInitialCompletionState(options = {}) {
    return {
        completion: options.initialCompletion || "",
        input: options.initialInput || "",
        isLoading: false,
        error: null,
    }
}

/**
 * Chat state actions
 */
export const CHAT_ACTIONS = {
    SET_MESSAGES: "SET_MESSAGES",
    ADD_MESSAGE: "ADD_MESSAGE",
    UPDATE_LAST_MESSAGE: "UPDATE_LAST_MESSAGE",
    SET_INPUT: "SET_INPUT",
    SET_LOADING: "SET_LOADING",
    SET_ERROR: "SET_ERROR",
    RESET: "RESET",
}

/**
 * Completion state actions
 */
export const COMPLETION_ACTIONS = {
    SET_COMPLETION: "SET_COMPLETION",
    APPEND_COMPLETION: "APPEND_COMPLETION",
    SET_INPUT: "SET_INPUT",
    SET_LOADING: "SET_LOADING",
    SET_ERROR: "SET_ERROR",
    RESET: "RESET",
}

/**
 * Chat reducer
 */
export function chatReducer(state, action) {
    switch (action.type) {
        case CHAT_ACTIONS.SET_MESSAGES:
            return { ...state, messages: action.payload }

        case CHAT_ACTIONS.ADD_MESSAGE:
            return { ...state, messages: [...state.messages, action.payload] }

        case CHAT_ACTIONS.UPDATE_LAST_MESSAGE: {
            const messages = [...state.messages]
            if (messages.length > 0) {
                const lastMsg = messages[messages.length - 1]
                messages[messages.length - 1] = { ...lastMsg, ...action.payload }
            }
            return { ...state, messages }
        }
        case CHAT_ACTIONS.SET_INPUT:
            return { ...state, input: action.payload }

        case CHAT_ACTIONS.SET_LOADING:
            return { ...state, isLoading: action.payload }

        case CHAT_ACTIONS.SET_ERROR:
            return { ...state, error: action.payload, isLoading: false }

        case CHAT_ACTIONS.RESET:
            return createInitialChatState(action.payload || {})

        default:
            return state
    }
}

/**
 * Completion reducer
 */
export function completionReducer(state, action) {
    switch (action.type) {
        case COMPLETION_ACTIONS.SET_COMPLETION:
            return { ...state, completion: action.payload }

        case COMPLETION_ACTIONS.APPEND_COMPLETION:
            return { ...state, completion: state.completion + action.payload }

        case COMPLETION_ACTIONS.SET_INPUT:
            return { ...state, input: action.payload }

        case COMPLETION_ACTIONS.SET_LOADING:
            return { ...state, isLoading: action.payload }

        case COMPLETION_ACTIONS.SET_ERROR:
            return { ...state, error: action.payload, isLoading: false }

        case COMPLETION_ACTIONS.RESET:
            return createInitialCompletionState(action.payload || {})

        default:
            return state
    }
}

/**
 * Generate unique ID
 */
export function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Create message object
 */
export function createMessage(role, content, metadata = {}) {
    return {
        id: generateId(),
        role,
        content,
        timestamp: new Date().toISOString(),
        ...metadata,
    }
}

/**
 * Validate message
 */
export function validateMessage(message) {
    if (!message) return false
    if (!message.role || !["user", "assistant", "system"].includes(message.role)) return false
    if (typeof message.content !== "string") return false
    return true
}

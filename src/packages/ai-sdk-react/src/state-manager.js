/**
 * State Manager
 * Manages component state with reducers
 */

/**
 * Create initial state for chat
 */
export function createInitialChatState(options = {}) {
    return {
        messageHistory: options.initialMessages || [],
        userQuery: options.initialInput || "",
        isLoading: false,
        error: null,
        // Responses API stateful conversation support
        responseId: null, // Last response ID for continuing conversations
        conversationId: null, // Conversation ID for stateful sessions
        metadata: null, // Additional metadata from response
    }
}

/**
 * Create initial state for completion
 */
export function createInitialCompletionState(options = {}) {
    return {
        output: options.initialCompletion || "",
        userQuery: options.initialInput || "",
        isLoading: false,
        error: null,
        // Responses API stateful conversation support
        responseId: null, // Last response ID
        conversationId: null, // Conversation ID for stateful sessions
        metadata: null, // Additional metadata from response
    }
}

/**
 * Chat state actions
 */
export const CHAT_ACTIONS = {
    SET_MESSAGES: "SET_MESSAGES",
    ADD_MESSAGE: "ADD_MESSAGE",
    UPDATE_LAST_MESSAGE: "UPDATE_LAST_MESSAGE",
    SET_USER_QUERY: "SET_USER_QUERY",
    SET_LOADING: "SET_LOADING",
    SET_ERROR: "SET_ERROR",
    RESET: "RESET",
    // Responses API support
    SET_RESPONSE_ID: "SET_RESPONSE_ID",
    SET_CONVERSATION_ID: "SET_CONVERSATION_ID",
    SET_METADATA: "SET_METADATA",
}

/**
 * Completion state actions
 */
export const COMPLETION_ACTIONS = {
    SET_OUTPUT: "SET_OUTPUT",
    APPEND_OUTPUT: "APPEND_OUTPUT",
    SET_USER_QUERY: "SET_USER_QUERY",
    SET_LOADING: "SET_LOADING",
    SET_ERROR: "SET_ERROR",
    RESET: "RESET",
    // Responses API support
    SET_RESPONSE_ID: "SET_RESPONSE_ID",
    SET_CONVERSATION_ID: "SET_CONVERSATION_ID",
    SET_METADATA: "SET_METADATA",
}

/**
 * Chat reducer
 */
export function chatReducer(state, action) {
    switch (action.type) {
        case CHAT_ACTIONS.SET_MESSAGES:
            return { ...state, messageHistory: action.payload }

        case CHAT_ACTIONS.ADD_MESSAGE:
            return { ...state, messageHistory: [...state.messageHistory, action.payload] }

        case CHAT_ACTIONS.UPDATE_LAST_MESSAGE: {
            const messageHistory = [...state.messageHistory]
            if (messageHistory.length > 0) {
                const lastMsg = messageHistory[messageHistory.length - 1]
                messageHistory[messageHistory.length - 1] = { ...lastMsg, ...action.payload }
            }
            return { ...state, messageHistory }
        }
        case CHAT_ACTIONS.SET_USER_QUERY:
            return { ...state, userQuery: action.payload }

        case CHAT_ACTIONS.SET_LOADING:
            return { ...state, isLoading: action.payload }

        case CHAT_ACTIONS.SET_ERROR:
            return { ...state, error: action.payload, isLoading: false }

        case CHAT_ACTIONS.RESET:
            return createInitialChatState(action.payload || {})

        // Responses API support
        case CHAT_ACTIONS.SET_RESPONSE_ID:
            return { ...state, responseId: action.payload }

        case CHAT_ACTIONS.SET_CONVERSATION_ID:
            return { ...state, conversationId: action.payload }

        case CHAT_ACTIONS.SET_METADATA:
            return { ...state, metadata: action.payload }

        default:
            return state
    }
}

/**
 * Completion reducer
 */
export function completionReducer(state, action) {
    switch (action.type) {
        case COMPLETION_ACTIONS.SET_OUTPUT:
            return { ...state, output: action.payload }

        case COMPLETION_ACTIONS.APPEND_OUTPUT:
            return { ...state, output: state.output + action.payload }

        case COMPLETION_ACTIONS.SET_USER_QUERY:
            return { ...state, userQuery: action.payload }

        case COMPLETION_ACTIONS.SET_LOADING:
            return { ...state, isLoading: action.payload }

        case COMPLETION_ACTIONS.SET_ERROR:
            return { ...state, error: action.payload, isLoading: false }

        case COMPLETION_ACTIONS.RESET:
            return createInitialCompletionState(action.payload || {})

        // Responses API support
        case COMPLETION_ACTIONS.SET_RESPONSE_ID:
            return { ...state, responseId: action.payload }

        case COMPLETION_ACTIONS.SET_CONVERSATION_ID:
            return { ...state, conversationId: action.payload }

        case COMPLETION_ACTIONS.SET_METADATA:
            return { ...state, metadata: action.payload }

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

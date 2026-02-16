/**
 * useDialogue Hook
 * React hook for managing chat conversations with streaming support
 */

import { useReducer, useCallback, useRef, useEffect } from "react"
import { chatReducer, createInitialChatState, CHAT_ACTIONS, createMessage } from "../state-manager.js"
import { makeRequest, createAbortController, processTextStream } from "catalyst-core/ai-sdk/core"
import { REACT_HOOKS_DEFAULTS } from "../config/defaults.js"

/**
 * useDialogue hook
 *
 * @param {Object} options - Configuration options
 * @param {string} options.api - API endpoint (default from config)
 * @param {Array} options.initialMessages - Initial messages
 * @param {boolean} options.stream - Enable streaming (default from config)
 * @param {boolean} options.useChatCompletions - Use legacy Chat Completions API (default: false = Responses API)
 * @param {Function} options.onFinish - Called when response finishes (receives responseId and metadata)
 * @param {Function} options.onError - Called on error
 * @param {Object} options.headers - Additional headers
 * @param {Object} options.body - Additional body parameters
 *
 * @returns {Object} Chat state and methods
 */
export function useDialogue(options = {}) {
    const {
        api = REACT_HOOKS_DEFAULTS.api.dialogue,
        initialMessages = [],
        stream = REACT_HOOKS_DEFAULTS.stream,
        useChatCompletions = false,
        onFinish,
        onError,
        headers: customHeaders = {},
        body: customBody = {},
    } = options

    // State management
    const [state, dispatch] = useReducer(chatReducer, { initialMessages }, createInitialChatState)

    // Refs
    const abortControllerRef = useRef(null)

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort()
                abortControllerRef.current = null
            }
        }
    }, [])

    /**
     * Sends a message to the AI and handles the response
     *
     * Purpose: Core function that manages the entire message flow:
     * - Adds user message to chat history
     * - Makes API request to the backend
     * - Handles both streaming and non-streaming responses
     * - Updates UI state during the conversation
     *
     * Used for: Initiating AI conversations and receiving responses
     *
     * @param {string} content - The message content to send
     * @param {Object} options - Additional request options to merge with customBody
     * @returns {Promise<void>}
     */
    const sendMessage = useCallback(
        async (content, options = {}) => {
            if (!content || !content.trim()) {
                return
            }

            try {
                // Create user message
                const userMessage = createMessage("user", content)

                dispatch({ type: CHAT_ACTIONS.ADD_MESSAGE, payload: userMessage })
                dispatch({ type: CHAT_ACTIONS.SET_LOADING, payload: true })

                // Create assistant message placeholder
                const assistantMessage = createMessage("assistant", "")
                dispatch({ type: CHAT_ACTIONS.ADD_MESSAGE, payload: assistantMessage })

                // Create abort controller
                abortControllerRef.current = createAbortController()

                // Get current messages from state (excluding the assistant placeholder just added)
                const currentMessages = [...state.messageHistory.slice(0, -1), userMessage]

                const requestBody = {
                    messages: currentMessages,
                    stream,
                    ...customBody,
                    ...options,
                }

                // Responses API: Add previousResponseId for stateful conversations
                // Only when NOT using Chat Completions API (i.e., using Responses API)
                if (!useChatCompletions && state.responseId) {
                    requestBody.previousResponseId = state.responseId
                    // When using Responses API, only send new messages (not entire history)
                    requestBody.messages = [userMessage]
                }

                // Make request
                const response = await makeRequest(api, {
                    method: "POST",
                    headers: customHeaders,
                    body: requestBody,
                    signal: abortControllerRef.current.signal,
                })

                if (stream) {
                    // Process streaming response
                    let accumulatedContent = ""
                    let streamMetadata = {}

                    await processTextStream(response.body, {
                        onChunk: (chunk) => {
                            accumulatedContent += chunk
                            dispatch({
                                type: CHAT_ACTIONS.UPDATE_LAST_MESSAGE,
                                payload: { content: accumulatedContent },
                            })
                        },
                        onMetadata: (metadata) => {
                            streamMetadata = metadata

                            // Store Responses API metadata (responseId, conversationId)
                            if (metadata.responseId) {
                                dispatch({ type: CHAT_ACTIONS.SET_RESPONSE_ID, payload: metadata.responseId })
                            }
                            if (metadata.conversationId) {
                                dispatch({
                                    type: CHAT_ACTIONS.SET_CONVERSATION_ID,
                                    payload: metadata.conversationId,
                                })
                            }
                            if (metadata.metadata) {
                                dispatch({ type: CHAT_ACTIONS.SET_METADATA, payload: metadata.metadata })
                            }
                        },
                        onComplete: (fullText) => {
                            dispatch({ type: CHAT_ACTIONS.SET_LOADING, payload: false })
                            if (onFinish) {
                                onFinish(
                                    createMessage("assistant", fullText),
                                    streamMetadata.responseId,
                                    streamMetadata.metadata
                                )
                            }
                        },
                        onError: (error) => {
                            dispatch({ type: CHAT_ACTIONS.SET_ERROR, payload: error })
                            if (onError) {
                                onError(error)
                            }
                        },
                    })
                } else {
                    // Process non-streaming response
                    const data = await response.json()
                    // Handle both Chat Completions and Responses API formats
                    // Chat Completions: data.text or data.message.content
                    // Responses API: data.text or data.content (normalized by server)
                    // Normalized by server: data.content (primary field)
                    const content = data.content || data.text || data.message?.content || ""

                    dispatch({
                        type: CHAT_ACTIONS.UPDATE_LAST_MESSAGE,
                        payload: { content },
                    })
                    dispatch({ type: CHAT_ACTIONS.SET_LOADING, payload: false })

                    // Store Responses API metadata (responseId, conversationId)
                    if (data.responseId) {
                        dispatch({ type: CHAT_ACTIONS.SET_RESPONSE_ID, payload: data.responseId })
                    }
                    if (data.conversationId) {
                        dispatch({ type: CHAT_ACTIONS.SET_CONVERSATION_ID, payload: data.conversationId })
                    }
                    if (data.metadata) {
                        dispatch({ type: CHAT_ACTIONS.SET_METADATA, payload: data.metadata })
                    }

                    if (onFinish) {
                        onFinish(createMessage("assistant", content), data.responseId, data.metadata)
                    }
                }
            } catch (error) {
                if (error.name !== "AbortError") {
                    dispatch({ type: CHAT_ACTIONS.SET_ERROR, payload: error })
                    dispatch({ type: CHAT_ACTIONS.SET_LOADING, payload: false })
                    if (onError) {
                        onError(error)
                    }
                } else {
                    // AbortError - loading already set to false by stop()
                    dispatch({ type: CHAT_ACTIONS.SET_LOADING, payload: false })
                }
            } finally {
                abortControllerRef.current = null
            }
        },
        [
            state.messageHistory,
            state.responseId,
            stream,
            customBody,
            useChatCompletions,
            api,
            customHeaders,
            onFinish,
            onError,
        ]
    )

    /**
     * Manually appends a message to the chat history
     *
     * Purpose: Allows direct injection of messages into the conversation
     * without triggering an API call
     *
     * Used for:
     * - Adding system messages
     * - Programmatically inserting pre-defined responses
     * - Testing or debugging chat flows
     * - Adding context messages without AI interaction
     *
     * @param {Object} message - Message object with role and content
     */
    const appendMessage = useCallback((message) => {
        dispatch({ type: CHAT_ACTIONS.ADD_MESSAGE, payload: message })
    }, [])

    /**
     * Regenerates the last assistant response with a new AI-generated reply
     *
     * Purpose: Allows users to regenerate the AI's last response if they're
     * not satisfied with it or if an error occurred
     *
     * Used for:
     * - Retrying failed responses
     * - Getting alternative responses to the same prompt
     * - Recovering from errors without retyping the message
     *
     * How it works:
     * - Finds the last user message in the conversation
     * - Removes all messages after it (including previous assistant response)
     * - Resends the user message to generate a new response
     *
     * @returns {Promise<void>}
     */
    const regenerateResponse = useCallback(async () => {
        if (state.messageHistory.length === 0) return

        // Find last user message
        const lastUserMessageIndex = [...state.messageHistory]
            .reverse()
            .findIndex((msg) => msg.role === "user")

        if (lastUserMessageIndex === -1) return

        const actualIndex = state.messageHistory.length - 1 - lastUserMessageIndex
        const lastUserMessage = state.messageHistory[actualIndex]

        // Remove messages after last user message
        const newMessages = state.messageHistory.slice(0, actualIndex + 1)
        dispatch({ type: CHAT_ACTIONS.SET_MESSAGES, payload: newMessages })

        // Resend the message
        await sendMessage(lastUserMessage.content)
    }, [sendMessage, state.messageHistory])

    /**
     * Aborts the ongoing AI response generation
     *
     * Purpose: Cancels an in-progress API request and stops streaming
     *
     * Used for:
     * - Canceling long-running responses
     * - Stopping responses the user doesn't want to wait for
     * - Preventing unwanted responses when user changes their mind
     *
     * Why it's needed:
     * - Saves API costs by stopping unnecessary generation
     * - Improves UX by giving users control over response generation
     * - Prevents resource waste on streaming responses
     *
     * @returns {void}
     */
    const abortGeneration = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
            abortControllerRef.current = null
            dispatch({ type: CHAT_ACTIONS.SET_LOADING, payload: false })
        }
    }, [])

    /**
     * Clears all messages and resets the conversation
     *
     * Purpose: Resets the entire chat state to start a fresh conversation
     *
     * Used for:
     * - Starting a new conversation topic
     * - Clearing chat history for privacy
     * - Resetting state after errors
     * - Providing a "new chat" functionality
     *
     * Why it's needed:
     * - Users need ability to start fresh conversations
     * - Prevents context overflow in long conversations
     * - Essential for multi-conversation UIs
     *
     * @returns {void}
     */
    const clear = useCallback(() => {
        abortGeneration()
        dispatch({ type: CHAT_ACTIONS.RESET, payload: { initialMessages: [] } })
    }, [abortGeneration])

    /**
     * Handles user input changes in the text field
     *
     * Purpose: Updates the input state as user types their message
     *
     * Used for:
     * - Binding to textarea/input onChange events
     * - Tracking user's message before submission
     * - Enabling controlled input components
     *
     * Why it's needed:
     * - React requires controlled components for form inputs
     * - Allows validation or modification before sending
     * - Enables features like character counting or input validation
     *
     * @param {Event|string} e - Event object or direct string value
     * @returns {void}
     */
    const handleInputChange = useCallback((e) => {
        const value = e.target?.value ?? e
        dispatch({ type: CHAT_ACTIONS.SET_USER_QUERY, payload: value })
    }, [])

    /**
     * Handles form submission when user sends a message
     *
     * Purpose: Manages the message sending flow when user submits the form
     * (typically by pressing Enter or clicking Send button)
     *
     * Used for:
     * - Binding to form onSubmit events
     * - Validating input before sending
     * - Preventing submission during loading state
     * - Clearing input after successful send
     *
     * Why it's needed:
     * - Provides proper form handling with preventDefault
     * - Prevents duplicate submissions while loading
     * - Ensures empty messages aren't sent
     * - Automatically clears input for next message
     *
     * @param {Event} e - Form submit event
     * @returns {void}
     */
    const handleSubmit = useCallback(
        (e) => {
            if (e && e.preventDefault) {
                e.preventDefault()
            }

            if (state.userQuery.trim() && !state.isLoading) {
                sendMessage(state.userQuery)
                dispatch({ type: CHAT_ACTIONS.SET_USER_QUERY, payload: "" })
            }
        },
        [state.userQuery, state.isLoading, sendMessage]
    )

    /**
     * Manually sets the entire message history
     *
     * Purpose: Replaces the complete conversation history with a new set
     * of messages
     *
     * Used for:
     * - Loading conversation history from storage/database
     * - Restoring previous chat sessions
     * - Implementing conversation templates
     * - Programmatically setting conversation context
     *
     * Why it's needed:
     * - Enables persistent chat history across sessions
     * - Allows conversation state management
     * - Supports conversation import/export features
     * - Essential for multi-session chat applications
     *
     * @param {Array} messages - Array of message objects to set
     * @returns {void}
     */
    const setMessageHistory = useCallback((messages) => {
        dispatch({ type: CHAT_ACTIONS.SET_MESSAGES, payload: messages })
    }, [])

    return {
        // State
        messageHistory: state.messageHistory,
        userQuery: state.userQuery,
        isLoading: state.isLoading,
        error: state.error,

        // Responses API stateful conversation support
        responseId: state.responseId, // Last response ID for continuing conversations
        conversationId: state.conversationId, // Conversation ID for tracking sessions
        metadata: state.metadata, // Additional response metadata

        // Methods
        sendMessage,
        appendMessage,
        regenerateResponse,
        abortGeneration,
        clear,
        setMessageHistory,

        // Form handlers
        handleInputChange,
        handleSubmit,
    }
}

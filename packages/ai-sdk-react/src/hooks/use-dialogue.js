/**
 * useDialogue Hook
 * React hook for managing chat conversations with streaming support
 */

import React, { useReducer, useCallback, useRef, useEffect } from "react"
import { chatReducer, createInitialChatState, CHAT_ACTIONS, createMessage } from "../state-manager.js"
import { makeRequest, createAbortController } from "@catalyst/ai-sdk/core"
import { processTextStream } from "@catalyst/ai-sdk/core"

/**
 * useDialogue hook
 *
 * @param {Object} options - Configuration options
 * @param {string} options.api - API endpoint (default: '/api/prompt')
 * @param {Array} options.initialMessages - Initial messages
 * @param {boolean} options.stream - Enable streaming (default: true)
 * @param {Function} options.onFinish - Called when response finishes
 * @param {Function} options.onError - Called on error
 * @param {Object} options.headers - Additional headers
 * @param {Object} options.body - Additional body parameters
 *
 * @returns {Object} Chat state and methods
 */
export function useDialogue(options = {}) {
    const {
        api = "/api/dialogue",
        initialMessages = [],
        stream = true,
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

                // Add user message to state
                dispatch({ type: CHAT_ACTIONS.ADD_MESSAGE, payload: userMessage })
                dispatch({ type: CHAT_ACTIONS.SET_LOADING, payload: true })
                // dispatch({ type: CHAT_ACTIONS.SET_ERROR, payload: null })

                // Create assistant message placeholder
                const assistantMessage = createMessage("assistant", "")
                dispatch({ type: CHAT_ACTIONS.ADD_MESSAGE, payload: assistantMessage })

                // Create abort controller
                abortControllerRef.current = createAbortController()

                // Get current messages from state (excluding the assistant placeholder just added)
                const currentMessages = [...state.messages.slice(0, -1), userMessage]

                const requestBody = {
                    messages: currentMessages,
                    stream,
                    ...customBody,
                    ...options,
                }

                console.log("🎯 [useDialogue] Sending request:", {
                    api,
                    messageCount: currentMessages.length,
                    hasStream: requestBody.stream,
                    customBodyKeys: Object.keys(customBody),
                })

                // Make request
                const response = await makeRequest(api, {
                    method: "POST",
                    headers: customHeaders,
                    body: requestBody,
                    signal: abortControllerRef.current.signal,
                })

                console.log("📥 [useDialogue] Response received")

                if (stream) {
                    // Process streaming response
                    console.log("🌊 [useDialogue] Starting stream processing")
                    let accumulatedContent = ""

                    await processTextStream(response.body, {
                        onChunk: (chunk) => {
                            accumulatedContent += chunk
                            dispatch({
                                type: CHAT_ACTIONS.UPDATE_LAST_MESSAGE,
                                payload: { content: accumulatedContent },
                            })
                        },
                        onComplete: (fullText) => {
                            dispatch({ type: CHAT_ACTIONS.SET_LOADING, payload: false })
                            if (onFinish) {
                                onFinish(createMessage("assistant", fullText))
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
                    console.log("📦 [useDialogue] Processing non-streaming response")
                    const data = await response.json()
                    const content = data.text || data.content || ""

                    dispatch({
                        type: CHAT_ACTIONS.UPDATE_LAST_MESSAGE,
                        payload: { content },
                    })
                    dispatch({ type: CHAT_ACTIONS.SET_LOADING, payload: false })

                    if (onFinish) {
                        onFinish(createMessage("assistant", content))
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
        [api, stream, customHeaders, customBody, onFinish, onError, state.messages]
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
    const append = useCallback((message) => {
        dispatch({ type: CHAT_ACTIONS.ADD_MESSAGE, payload: message })
    }, [])

    /**
     * Reloads/regenerates the last assistant response
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
     * - Resend the user message to generate a new response
     * 
     * @returns {Promise<void>}
     */
    const reload = useCallback(async () => {
        if (state.messages.length === 0) return

        // Find last user message
        const lastUserMessageIndex = [...state.messages].reverse().findIndex((msg) => msg.role === "user")

        if (lastUserMessageIndex === -1) return

        const actualIndex = state.messages.length - 1 - lastUserMessageIndex
        const lastUserMessage = state.messages[actualIndex]

        // Remove messages after last user message
        const newMessages = state.messages.slice(0, actualIndex + 1)
        dispatch({ type: CHAT_ACTIONS.SET_MESSAGES, payload: newMessages })

        // Resend the message
        await sendMessage(lastUserMessage.content)
    }, [sendMessage, state.messages])

    /**
     * Stops the current AI response generation
     * 
     * Purpose: Aborts an in-progress API request and stops streaming
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
    const stop = useCallback(() => {
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
        stop()
        dispatch({ type: CHAT_ACTIONS.RESET, payload: { initialMessages: [] } })
    }, [stop])

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
        dispatch({ type: CHAT_ACTIONS.SET_INPUT, payload: value })
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

            if (state.input.trim() && !state.isLoading) {
                sendMessage(state.input)
                dispatch({ type: CHAT_ACTIONS.SET_INPUT, payload: "" })
            }
        },
        [state.input, state.isLoading, sendMessage]
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
    const setMessages = useCallback((messages) => {
        dispatch({ type: CHAT_ACTIONS.SET_MESSAGES, payload: messages })
    }, [])

    return {
        // State
        messages: state.messages,
        input: state.input,
        isLoading: state.isLoading,
        error: state.error,

        // Methods
        sendMessage,
        append,
        reload,
        stop,
        clear,
        setMessages,

        // Form handlers
        handleInputChange,
        handleSubmit,
    }
}
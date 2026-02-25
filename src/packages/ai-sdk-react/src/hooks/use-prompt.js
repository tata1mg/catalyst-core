/**
 * usePrompt Hook
 * React hook for text completion with streaming support
 */

import  { useReducer, useCallback, useRef, useEffect } from "react"
import { completionReducer, createInitialCompletionState, COMPLETION_ACTIONS } from "../state-manager.js"
import { makeRequest, createAbortController, processTextStream } from "catalyst-core/ai-sdk/core"
import { REACT_HOOKS_DEFAULTS } from "../config/defaults.js"

/**
 * usePrompt hook
 *
 * @param {Object} options - Configuration options
 * @param {string} options.api - API endpoint (default from config)
 * @param {string} options.initialCompletion - Initial completion text (default from config)
 * @param {boolean} options.stream - Enable streaming (default from config)
 * @param {boolean} options.useChatCompletions - Use legacy Chat Completions API (default: false = Responses API)
 * @param {Function} options.onFinish - Called when completion finishes (receives responseId and metadata)
 * @param {Function} options.onError - Called on error
 * @param {Function} options.onResponse - Called when response starts
 * @param {Object} options.headers - Additional headers
 * @param {Object} options.body - Additional body parameters
 *
 * @returns {Object} Completion state and methods
 */
export function usePrompt(options = {}) {
    const {
        api = REACT_HOOKS_DEFAULTS.api.prompt,
        initialCompletion = REACT_HOOKS_DEFAULTS.initialCompletion,
        stream = REACT_HOOKS_DEFAULTS.stream,
        useChatCompletions = false,
        onFinish,
        onError,
        onResponse,
        headers: customHeaders = {},
        body: customBody = {},
    } = options

    // State management
    const [state, dispatch] = useReducer(
        completionReducer,
        { initialCompletion },
        createInitialCompletionState
    )

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
     * Generate AI response for the given prompt
     *
     * Sends a request to the AI service and handles the response (streaming or non-streaming).
     * Automatically manages loading states and error handling.
     */
    const generateResponse = useCallback(
        async (prompt, options = {}) => {
            if (!prompt || !prompt.trim()) {
                return
            }

            try {
                // Reset output and set loading
                dispatch({ type: COMPLETION_ACTIONS.SET_OUTPUT, payload: "" })
                dispatch({ type: COMPLETION_ACTIONS.SET_LOADING, payload: true })
                dispatch({ type: COMPLETION_ACTIONS.SET_ERROR, payload: null })

                // Create abort controller
                abortControllerRef.current = createAbortController()

                // Prepare request body
                const requestBody = {
                    prompt,
                    stream,
                    ...customBody,
                    ...options,
                }

                // Responses API: Add previousResponseId for stateful continuations
                // Only when NOT using Chat Completions API (i.e., using Responses API)
                if (!useChatCompletions && state.responseId) {
                    requestBody.previousResponseId = state.responseId
                }

                // Make request
                const response = await makeRequest(api, {
                    method: "POST",
                    headers: customHeaders,
                    body: requestBody,
                    signal: abortControllerRef.current.signal,
                })

                // Call onResponse if provided
                if (onResponse) {
                    onResponse(response)
                }

                let completionText = ""

                if (stream) {
                    // Process streaming response
                    let streamMetadata = {}
                    
                    await processTextStream(response.body, {
                        onChunk: (chunk) => {
                            completionText += chunk
                            dispatch({
                                type: COMPLETION_ACTIONS.SET_OUTPUT,
                                payload: completionText,
                            })
                        },
                        onMetadata: (metadata) => {
                            streamMetadata = metadata
                            
                            // Store Responses API metadata (responseId, conversationId)
                            if (metadata.responseId) {
                                dispatch({ type: COMPLETION_ACTIONS.SET_RESPONSE_ID, payload: metadata.responseId })
                            }
                            if (metadata.conversationId) {
                                dispatch({ type: COMPLETION_ACTIONS.SET_CONVERSATION_ID, payload: metadata.conversationId })
                            }
                            if (metadata.metadata) {
                                dispatch({ type: COMPLETION_ACTIONS.SET_METADATA, payload: metadata.metadata })
                            }
                        },
                        onComplete: (fullText) => {
                            dispatch({ type: COMPLETION_ACTIONS.SET_LOADING, payload: false })
                            if (onFinish) {
                                onFinish(prompt, fullText, streamMetadata.responseId, streamMetadata.metadata)
                            }
                        },
                        onError: (error) => {
                            dispatch({ type: COMPLETION_ACTIONS.SET_ERROR, payload: error })
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
                    // Responses API: data.text or data.output[0].content
                    // Normalized by server: data.content
                    completionText = data.content || data.text || data.message?.content || data.output?.[0]?.content || ""

                    dispatch({
                        type: COMPLETION_ACTIONS.SET_OUTPUT,
                        payload: completionText,
                    })
                    dispatch({ type: COMPLETION_ACTIONS.SET_LOADING, payload: false })

                    // Store Responses API metadata (responseId, conversationId)
                    if (data.responseId) {
                        dispatch({ type: COMPLETION_ACTIONS.SET_RESPONSE_ID, payload: data.responseId })
                    }
                    if (data.conversationId) {
                        dispatch({ type: COMPLETION_ACTIONS.SET_CONVERSATION_ID, payload: data.conversationId })
                    }
                    if (data.metadata) {
                        dispatch({ type: COMPLETION_ACTIONS.SET_METADATA, payload: data.metadata })
                    }

                    if (onFinish) {
                        onFinish(prompt, completionText, data.responseId, data.metadata)
                    }
                }

                return completionText
            } catch (error) {
                if (error.name !== "AbortError") {
                    dispatch({ type: COMPLETION_ACTIONS.SET_ERROR, payload: error })
                    dispatch({ type: COMPLETION_ACTIONS.SET_LOADING, payload: false })
                    if (onError) {
                        onError(error)
                    }
                } else {
                    // AbortError - loading already set to false by stop()
                    dispatch({ type: COMPLETION_ACTIONS.SET_LOADING, payload: false })
                }
                throw error
            } finally {
                abortControllerRef.current = null
            }
        },
        [stream, customBody, useChatCompletions, state.responseId, api, customHeaders, onResponse, onFinish, onError]
    )

    /**
     * Abort the ongoing AI response generation
     *
     * Cancels the current API request and stops any streaming response.
     * Sets loading state to false immediately.
     */
    const abortGeneration = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
            abortControllerRef.current = null
            dispatch({ type: COMPLETION_ACTIONS.SET_LOADING, payload: false })
        }
    }, [])

    /**
     * Manually set a custom response text without calling the AI service
     *
     * Use this function to programmatically override or update the completion text
     * without making an API call. Useful for setting predefined responses,
     * implementing custom logic, or clearing the response.
     *
     * @param {string} text - The text to set as the response value
     *
     * @example
     * // Set a custom response text
     * setManualResponse("This is a custom response")
     *
     * // Clear the response
     * setManualResponse("")
     */
    const setManualResponse = useCallback((text) => {
        dispatch({ type: COMPLETION_ACTIONS.SET_OUTPUT, payload: text })
    }, [])

    /**
     * Handle input change
     */
    const handleInputChange = useCallback((e) => {
        const value = e.target?.value ?? e
        dispatch({ type: COMPLETION_ACTIONS.SET_USER_QUERY, payload: value })
    }, [])

    /**
     * Handle form submit
     */
    const handleSubmit = useCallback(
        (e) => {
            if (e && e.preventDefault) {
                e.preventDefault()
            }

            if (state.userQuery.trim() && !state.isLoading) {
                generateResponse(state.userQuery)
            }
        },
        [state.userQuery, state.isLoading, generateResponse]
    )

    /**
     * Clear the current completion response
     *
     * Aborts any ongoing generation and resets the completion to empty state.
     */
    const clear = useCallback(() => {
        abortGeneration()
        dispatch({ type: COMPLETION_ACTIONS.RESET, payload: { initialCompletion: "" } })
    }, [abortGeneration])

    /**
     * Regenerate the AI response for the last input
     *
     * Retries the last prompt and generates a new response.
     * Only works if there's a previous input available.
     */
    const regenerateResponse = useCallback(() => {
        if (state.userQuery) {
            generateResponse(state.userQuery)
        }
    }, [state.userQuery, generateResponse])

    return {
        // State
        output: state.output,
        userQuery: state.userQuery,
        isLoading: state.isLoading,
        error: state.error,
        
        // Responses API stateful conversation support
        responseId: state.responseId, // Last response ID for continuations
        conversationId: state.conversationId, // Conversation ID for tracking
        metadata: state.metadata, // Additional response metadata

        // Methods
        generateResponse,
        abortGeneration,
        clear,
        regenerateResponse,
        setManualResponse,

        // Form handlers
        handleInputChange,
        handleSubmit,
    }
}

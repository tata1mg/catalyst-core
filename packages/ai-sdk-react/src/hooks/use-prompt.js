/**
 * usePrompt Hook
 * React hook for text completion with streaming support
 */

import React, { useReducer, useCallback, useRef, useEffect } from "react"
import {
    completionReducer,
    createInitialCompletionState,
    COMPLETION_ACTIONS,
} from "../state-manager.js"
import { makeRequest, createAbortController } from "@catalyst/ai-sdk/core"
import { processTextStream } from "@catalyst/ai-sdk/core"

/**
 * usePrompt hook
 *
 * @param {Object} options - Configuration options
 * @param {string} options.api - API endpoint (default: '/api/dialogue')
 * @param {string} options.initialCompletion - Initial completion text
 * @param {boolean} options.stream - Enable streaming (default: true)
 * @param {Function} options.onFinish - Called when completion finishes
 * @param {Function} options.onError - Called on error
 * @param {Function} options.onResponse - Called when response starts
 * @param {Object} options.headers - Additional headers
 * @param {Object} options.body - Additional body parameters
 *
 * @returns {Object} Completion state and methods
 */
export function usePrompt(options = {}) {
    const {
        api = "/api/prompt",
        initialCompletion = "",
        stream = true,
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
     * Complete the prompt
     */
    const complete = useCallback(
        async (prompt, options = {}) => {
            if (!prompt || !prompt.trim()) {
                return
            }

            try {
                // Reset completion and set loading
                dispatch({ type: COMPLETION_ACTIONS.SET_COMPLETION, payload: "" })
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
                    await processTextStream(response.body, {
                        onChunk: (chunk) => {
                            completionText += chunk
                            dispatch({
                                type: COMPLETION_ACTIONS.SET_COMPLETION,
                                payload: completionText,
                            })
                        },
                        onComplete: (fullText) => {
                            dispatch({ type: COMPLETION_ACTIONS.SET_LOADING, payload: false })
                            if (onFinish) {
                                onFinish(prompt, fullText)
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
                    completionText = data.text || data.content || ""

                    dispatch({
                        type: COMPLETION_ACTIONS.SET_COMPLETION,
                        payload: completionText,
                    })
                    dispatch({ type: COMPLETION_ACTIONS.SET_LOADING, payload: false })

                    if (onFinish) {
                        onFinish(prompt, completionText)
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
        [api, stream, customHeaders, customBody, onFinish, onError, onResponse]
    )

    /**
     * Stop the current generation
     */
    const stop = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
            abortControllerRef.current = null
            dispatch({ type: COMPLETION_ACTIONS.SET_LOADING, payload: false })
        }
    }, [])

    /**
     * Set completion manually
     */
    const setCompletion = useCallback((text) => {
        dispatch({ type: COMPLETION_ACTIONS.SET_COMPLETION, payload: text })
    }, [])

    /**
     * Handle input change
     */
    const handleInputChange = useCallback((e) => {
        const value = e.target?.value ?? e
        dispatch({ type: COMPLETION_ACTIONS.SET_INPUT, payload: value })
    }, [])

    /**
     * Handle form submit
     */
    const handleSubmit = useCallback(
        (e) => {
            if (e && e.preventDefault) {
                e.preventDefault()
            }

            if (state.input.trim() && !state.isLoading) {
                complete(state.input)
            }
        },
        [state.input, state.isLoading, complete]
    )

    /**
     * Clear completion
     */
    const clear = useCallback(() => {
        stop()
        dispatch({ type: COMPLETION_ACTIONS.RESET, payload: { initialCompletion: "" } })
    }, [stop])

    /**
     * Reload/retry last completion
     */
    const reload = useCallback(() => {
        if (state.input) {
            complete(state.input)
        }
    }, [state.input, complete])

    return {
        // State
        completion: state.completion,
        input: state.input,
        isLoading: state.isLoading,
        error: state.error,

        // Methods
        complete,
        stop,
        clear,
        reload,
        setCompletion,

        // Form handlers
        handleInputChange,
        handleSubmit,
    }
}
/**
 * usePrompt Hook
 * React hook for text completion with streaming support
 */

import { useReducer, useCallback, useRef, useEffect } from 'react';
import {
  completionReducer,
  createInitialCompletionState,
  COMPLETION_ACTIONS
} from '../../core/state-manager.js';
import { makeRequest, createAbortController } from '../../core/http-client.js';
import { processTextStream } from '../../core/stream-processor.js';

/**
 * usePrompt hook
 * 
 * @param {Object} options - Configuration options
 * @param {string} options.api - API endpoint (default: '/api/dialogue')
 * @param {string} options.initialCompletion - Initial completion text
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
    api = '/api/dialogue',
    initialCompletion = '',
    onFinish,
    onError,
    onResponse,
    headers: customHeaders = {},
    body: customBody = {}
  } = options;

  // State management
  const [state, dispatch] = useReducer(
    completionReducer,
    { initialCompletion },
    createInitialCompletionState
  );

  // Refs
  const abortControllerRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  /**
   * Complete the prompt
   */
  const complete = useCallback(async (prompt, options = {}) => {
    if (!prompt || !prompt.trim()) {
      return;
    }

    try {
      // Reset completion and set loading
      dispatch({ type: COMPLETION_ACTIONS.SET_COMPLETION, payload: '' });
      dispatch({ type: COMPLETION_ACTIONS.SET_LOADING, payload: true });
      dispatch({ type: COMPLETION_ACTIONS.SET_ERROR, payload: null });

      // Create abort controller
      abortControllerRef.current = createAbortController();

      // Prepare request body
      const requestBody = {
        prompt,
        ...customBody,
        ...options
      };

      // Make streaming request
      const response = await makeRequest(api, {
        method: 'POST',
        headers: customHeaders,
        body: requestBody,
        signal: abortControllerRef.current.signal
      });

      // Call onResponse if provided
      if (onResponse) {
        onResponse(response);
      }

      // Process stream
      let accumulatedText = '';
      
      await processTextStream(response.body, {
        onChunk: (chunk) => {
          accumulatedText += chunk;
          dispatch({
            type: COMPLETION_ACTIONS.SET_COMPLETION,
            payload: accumulatedText
          });
        },
        onComplete: (fullText) => {
          dispatch({ type: COMPLETION_ACTIONS.SET_LOADING, payload: false });
          if (onFinish) {
            onFinish(prompt, fullText);
          }
        },
        onError: (error) => {
          dispatch({ type: COMPLETION_ACTIONS.SET_ERROR, payload: error });
          if (onError) {
            onError(error);
          }
        }
      });

      return accumulatedText;
    } catch (error) {
      if (error.name !== 'AbortError') {
        dispatch({ type: COMPLETION_ACTIONS.SET_ERROR, payload: error });
        if (onError) {
          onError(error);
        }
      }
      throw error;
    } finally {
      abortControllerRef.current = null;
    }
  }, [api, customHeaders, customBody, onFinish, onError, onResponse]);

  /**
   * Stop the current generation
   */
  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      dispatch({ type: COMPLETION_ACTIONS.SET_LOADING, payload: false });
    }
  }, []);

  /**
   * Set completion manually
   */
  const setCompletion = useCallback((text) => {
    dispatch({ type: COMPLETION_ACTIONS.SET_COMPLETION, payload: text });
  }, []);

  /**
   * Handle input change
   */
  const handleInputChange = useCallback((e) => {
    const value = e.target?.value ?? e;
    dispatch({ type: COMPLETION_ACTIONS.SET_INPUT, payload: value });
  }, []);

  /**
   * Handle form submit
   */
  const handleSubmit = useCallback((e) => {
    if (e && e.preventDefault) {
      e.preventDefault();
    }

    if (state.input.trim() && !state.isLoading) {
      complete(state.input);
    }
  }, [state.input, state.isLoading, complete]);

  /**
   * Clear completion
   */
  const clear = useCallback(() => {
    stop();
    dispatch({ type: COMPLETION_ACTIONS.RESET, payload: { initialCompletion: '' } });
  }, [stop]);

  /**
   * Reload/retry last completion
   */
  const reload = useCallback(() => {
    if (state.input) {
      complete(state.input);
    }
  }, [state.input, complete]);

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
    handleSubmit
  };
}
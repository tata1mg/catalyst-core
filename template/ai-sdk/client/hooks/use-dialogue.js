/**
 * useDialogue Hook
 * React hook for managing chat conversations with streaming support
 */

import { useReducer, useCallback, useRef, useEffect } from 'react';
import {
  chatReducer,
  createInitialChatState,
  CHAT_ACTIONS,
  createMessage
} from '../../core/state-manager.js';
import { makeRequest, createAbortController } from '../../core/http-client.js';
import { processTextStream } from '../../core/stream-processor.js';

/**
 * useDialogue hook
 * 
 * @param {Object} options - Configuration options
 * @param {string} options.api - API endpoint (default: '/api/prompt')
 * @param {Array} options.initialMessages - Initial messages
 * @param {Function} options.onFinish - Called when response finishes
 * @param {Function} options.onError - Called on error
 * @param {Object} options.headers - Additional headers
 * @param {Object} options.body - Additional body parameters
 * 
 * @returns {Object} Chat state and methods
 */
export function useDialogue(options = {}) {
  const {
    api = '/api/prompt',
    initialMessages = [],
    onFinish,
    onError,
    headers: customHeaders = {},
    body: customBody = {}
  } = options;

  // State management
  const [state, dispatch] = useReducer(
    chatReducer,
    { initialMessages },
    createInitialChatState
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
   * Send a message
   */
  const sendMessage = useCallback(async (content, options = {}) => {
    if (!content || !content.trim()) {
      return;
    }

    try {
      // Create user message
      const userMessage = createMessage('user', content);
      
      // Add user message to state
      dispatch({ type: CHAT_ACTIONS.ADD_MESSAGE, payload: userMessage });
      dispatch({ type: CHAT_ACTIONS.SET_LOADING, payload: true });
      dispatch({ type: CHAT_ACTIONS.SET_ERROR, payload: null });

      // Create assistant message placeholder
      const assistantMessage = createMessage('assistant', '');
      dispatch({ type: CHAT_ACTIONS.ADD_MESSAGE, payload: assistantMessage });

      // Create abort controller
      abortControllerRef.current = createAbortController();

      // Prepare request body - read from current state instead of ref
      const currentMessages = [...state.messages, userMessage];
      const requestBody = {
        messages: currentMessages,
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

      // Process stream
      let accumulatedContent = '';
      
      await processTextStream(response.body, {
        onChunk: (chunk) => {
          accumulatedContent += chunk;
          dispatch({
            type: CHAT_ACTIONS.UPDATE_LAST_MESSAGE,
            payload: { content: accumulatedContent }
          });
        },
        onComplete: (fullText) => {
          dispatch({ type: CHAT_ACTIONS.SET_LOADING, payload: false });
          if (onFinish) {
            onFinish(createMessage('assistant', fullText));
          }
        },
        onError: (error) => {
          dispatch({ type: CHAT_ACTIONS.SET_ERROR, payload: error });
          if (onError) {
            onError(error);
          }
        }
      });

    } catch (error) {
      if (error.name !== 'AbortError') {
        dispatch({ type: CHAT_ACTIONS.SET_ERROR, payload: error });
        if (onError) {
          onError(error);
        }
      }
    } finally {
      abortControllerRef.current = null;
    }
  }, [api, customHeaders, customBody, onFinish, onError]);

  /**
   * Append a message manually
   */
  const append = useCallback((message) => {
    dispatch({ type: CHAT_ACTIONS.ADD_MESSAGE, payload: message });
  }, []);

  /**
   * Reload the last assistant message
   */
  const reload = useCallback(async () => {
    if (state.messages.length === 0) return;

    // Find last user message
    const lastUserMessageIndex = [...state.messages].reverse().findIndex(
      msg => msg.role === 'user'
    );
    
    if (lastUserMessageIndex === -1) return;

    const actualIndex = state.messages.length - 1 - lastUserMessageIndex;
    const lastUserMessage = state.messages[actualIndex];

    // Remove messages after last user message
    const newMessages = state.messages.slice(0, actualIndex + 1);
    dispatch({ type: CHAT_ACTIONS.SET_MESSAGES, payload: newMessages });

    // Resend the message
    await sendMessage(lastUserMessage.content);
  }, [sendMessage, state.messages]);

  /**
   * Stop the current generation
   */
  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      dispatch({ type: CHAT_ACTIONS.SET_LOADING, payload: false });
    }
  }, []);

  /**
   * Clear all messages
   */
  const clear = useCallback(() => {
    stop();
    dispatch({ type: CHAT_ACTIONS.RESET, payload: { initialMessages: [] } });
  }, [stop]);

  /**
   * Handle input change
   */
  const handleInputChange = useCallback((e) => {
    const value = e.target?.value ?? e;
    dispatch({ type: CHAT_ACTIONS.SET_INPUT, payload: value });
  }, []);

  /**
   * Handle form submit
   */
  const handleSubmit = useCallback((e) => {
    if (e && e.preventDefault) {
      e.preventDefault();
    }

    if (state.input.trim() && !state.isLoading) {
      sendMessage(state.input);
      dispatch({ type: CHAT_ACTIONS.SET_INPUT, payload: '' });
    }
  }, [state.input, state.isLoading, sendMessage]);

  /**
   * Set messages manually
   */
  const setMessages = useCallback((messages) => {
    dispatch({ type: CHAT_ACTIONS.SET_MESSAGES, payload: messages });
  }, []);

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
    handleSubmit
  };
}
/**
 * Stream Text
 * Client-side function to stream text from LLM
 */

import { makeRequest, validatePayload, createAbortController } from '../core/http-client.js';
import { processTextStream } from '../core/stream-processor.js';

/**
 * Stream text using the API
 * 
 * @param {Object} options - Configuration options
 * @param {string} options.prompt - The prompt text
 * @param {string} options.api - API endpoint (default: '/api/generate')
 * @param {string} options.model - Model name
 * @param {number} options.temperature - Temperature (0-2)
 * @param {number} options.maxTokens - Maximum tokens
 * @param {Function} options.onChunk - Callback for each chunk
 * @param {Function} options.onComplete - Callback when complete
 * @param {Function} options.onError - Callback on error
 * @param {Object} options.headers - Additional headers
 * 
 * @returns {Object} Stream controller
 */
export function textStream(options = {}) {
  const {
    prompt,
    api = '/api/generate',
    model = 'gpt-3.5-turbo',
    temperature = 0.7,
    maxTokens = 1000,
    onChunk = () => {},
    onComplete = () => {},
    onError = () => {},
    headers = {},
    ...additionalOptions
  } = options;

  // Create abort controller
  const abortController = createAbortController();
  let isActive = false;
  let accumulatedText = '';

  /**
   * Start streaming
   */
  const start = async () => {
    // Validate payload
    const validation = validatePayload({ prompt });
    if (!validation.valid) {
      const error = new Error(validation.error);
      onError(error);
      throw error;
    }

    // Prepare request body
    const body = {
      prompt,
      model,
      temperature,
      maxTokens,
      stream: true,
      ...additionalOptions
    };

    try {
      isActive = true;
      accumulatedText = '';

      // Make streaming request
      const response = await makeRequest(api, {
        method: 'POST',
        headers,
        body,
        signal: abortController.signal
      });

      // Process the stream
      await processTextStream(response.body, {
        onChunk: (chunk, fullText) => {
          accumulatedText = fullText;
          onChunk(chunk, fullText);
        },
        onComplete: (fullText) => {
          accumulatedText = fullText;
          isActive = false;
          onComplete(fullText);
        },
        onError: (error) => {
          isActive = false;
          onError(error);
        }
      });

      return accumulatedText;
    } catch (error) {
      isActive = false;
      if (error.name !== 'AbortError') {
        onError(error);
      }
      throw error;
    }
  };

  /**
   * Stop streaming
   */
  const stop = () => {
    abortController.abort();
    isActive = false;
  };

  /**
   * Get current state
   */
  const getState = () => ({
    isActive,
    text: accumulatedText
  });

  return {
    start,
    stop,
    getState,
    get isActive() { return isActive; },
    get text() { return accumulatedText; }
  };
}

/**
 * Stream text with messages (for chat format)
 * 
 * @param {Object} options - Configuration options
 * @param {Array} options.messages - Array of message objects
 * @param {Function} options.onChunk - Callback for each chunk
 * @param {Function} options.onComplete - Callback when complete
 * @param {Function} options.onError - Callback on error
 * 
 * @returns {Object} Stream controller
 */
export function textStreamWithMessages(options = {}) {
  const {
    messages,
    api = '/api/generate',
    model = 'gpt-3.5-turbo',
    temperature = 0.7,
    maxTokens = 1000,
    onChunk = () => {},
    onComplete = () => {},
    onError = () => {},
    headers = {},
    ...additionalOptions
  } = options;

  // Create abort controller
  const abortController = createAbortController();
  let isActive = false;
  let accumulatedText = '';

  /**
   * Start streaming
   */
  const start = async () => {
    // Validate payload
    const validation = validatePayload({ messages });
    if (!validation.valid) {
      const error = new Error(validation.error);
      onError(error);
      throw error;
    }

    // Prepare request body
    const body = {
      messages,
      model,
      temperature,
      maxTokens,
      stream: true,
      ...additionalOptions
    };

    try {
      isActive = true;
      accumulatedText = '';

      // Make streaming request
      const response = await makeRequest(api, {
        method: 'POST',
        headers,
        body,
        signal: abortController.signal
      });

      // Process the stream
      await processTextStream(response.body, {
        onChunk: (chunk, fullText) => {
          accumulatedText = fullText;
          onChunk(chunk, fullText);
        },
        onComplete: (fullText) => {
          accumulatedText = fullText;
          isActive = false;
          onComplete(fullText);
        },
        onError: (error) => {
          isActive = false;
          onError(error);
        }
      });

      return accumulatedText;
    } catch (error) {
      isActive = false;
      if (error.name !== 'AbortError') {
        onError(error);
      }
      throw error;
    }
  };

  /**
   * Stop streaming
   */
  const stop = () => {
    abortController.abort();
    isActive = false;
  };

  /**
   * Get current state
   */
  const getState = () => ({
    isActive,
    text: accumulatedText
  });

  return {
    start,
    stop,
    getState,
    get isActive() { return isActive; },
    get text() { return accumulatedText; }
  };
}
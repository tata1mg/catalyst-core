/**
 * Generate Text (Non-streaming)
 * Client-side function to generate text from LLM
 */

import { makeJSONRequest, validatePayload } from '../core/http-client.js';

/**
 * Generate text using the API
 * 
 * @param {Object} options - Configuration options
 * @param {string} options.prompt - The prompt text
 * @param {string} options.api - API endpoint (default: '/api/generate')
 * @param {string} options.model - Model name (e.g., 'gpt-3.5-turbo')
 * @param {number} options.temperature - Temperature (0-2)
 * @param {number} options.maxTokens - Maximum tokens to generate
 * @param {Object} options.headers - Additional headers
 * @param {AbortSignal} options.signal - Abort signal
 * 
 * @returns {Promise<Object>} Result object with text, usage, etc.
 */
export async function textGenerate(options = {}) {
  const {
    prompt,
    api = '/api/generate',
    model = 'gpt-3.5-turbo',
    temperature = 0.7,
    maxTokens = 1000,
    headers = {},
    signal = null,
    ...additionalOptions
  } = options;

  // Validate payload
  const validation = validatePayload({ prompt });
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Prepare request body
  const body = {
    prompt,
    model,
    temperature,
    maxTokens,
    stream: false,
    ...additionalOptions
  };

  try {
    const result = await makeJSONRequest(api, {
      method: 'POST',
      headers,
      body,
      signal
    });

    return {
      text: result.text || '',
      usage: result.usage || {},
      finishReason: result.finishReason || 'complete',
      metadata: result.metadata || {}
    };
  } catch (error) {
    throw new Error(`Generation failed: ${error.message}`);
  }
}

/**
 * Generate text with messages (for chat format)
 * 
 * @param {Object} options - Configuration options
 * @param {Array} options.messages - Array of message objects
 * @param {string} options.api - API endpoint
 * @param {string} options.model - Model name
 * 
 * @returns {Promise<Object>} Result object
 */
export async function textGenerateWithMessages(options = {}) {
  const {
    messages,
    api = '/api/generate',
    model = 'gpt-3.5-turbo',
    temperature = 0.7,
    maxTokens = 1000,
    headers = {},
    signal = null,
    ...additionalOptions
  } = options;

  // Validate payload
  const validation = validatePayload({ messages });
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Prepare request body
  const body = {
    messages,
    model,
    temperature,
    maxTokens,
    stream: false,
    ...additionalOptions
  };

  try {
    const result = await makeJSONRequest(api, {
      method: 'POST',
      headers,
      body,
      signal
    });

    return {
      message: result.message || { role: 'assistant', content: result.text || '' },
      usage: result.usage || {},
      finishReason: result.finishReason || 'complete',
      metadata: result.metadata || {}
    };
  } catch (error) {
    throw new Error(`Generation failed: ${error.message}`);
  }
}
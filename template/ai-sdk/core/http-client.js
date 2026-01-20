/**
 * HTTP Client
 * Handles HTTP requests with proper error handling
 */

/**
 * Make an API request
 * @param {string} url - API endpoint
 * @param {Object} options - Request options
 */
export async function makeRequest(url, options = {}) {
  const {
    method = 'POST',
    headers = {},
    body = null,
    signal = null
  } = options;

  const requestOptions = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    signal
  };

  if (body) {
    requestOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  try {
    const response = await fetch(url, requestOptions);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: `HTTP ${response.status}: ${response.statusText}`
      }));
      throw new Error(errorData.error || `Request failed with status ${response.status}`);
    }

    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request was aborted');
    }
    throw error;
  }
}

/**
 * Make a JSON API request
 */
export async function makeJSONRequest(url, options = {}) {
  const response = await makeRequest(url, options);
  return response.json();
}

/**
 * Make a streaming request
 */
export async function makeStreamRequest(url, options = {}) {
  const response = await makeRequest(url, options);
  return response.body;
}

/**
 * Create abort controller
 */
export function createAbortController() {
  return new AbortController();
}

/**
 * Handle API errors
 */
export function handleAPIError(error) {
  if (error.name === 'AbortError') {
    return {
      type: 'abort',
      message: 'Request was cancelled'
    };
  }

  if (error.message.includes('401')) {
    return {
      type: 'auth',
      message: 'Authentication failed. Check your API key.'
    };
  }

  if (error.message.includes('429')) {
    return {
      type: 'rate_limit',
      message: 'Rate limit exceeded. Please try again later.'
    };
  }

  if (error.message.includes('500')) {
    return {
      type: 'server',
      message: 'Server error. Please try again.'
    };
  }

  return {
    type: 'unknown',
    message: error.message || 'An unexpected error occurred'
  };
}

/**
 * Validate request payload
 */
export function validatePayload(payload) {
  if (!payload) {
    return { valid: false, error: 'Payload is required' };
  }

  if (!payload.prompt && !payload.messages) {
    return { valid: false, error: 'Either prompt or messages is required' };
  }

  return { valid: true };
}
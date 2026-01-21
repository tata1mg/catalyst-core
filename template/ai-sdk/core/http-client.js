/**
 * HTTP Client
 * Handles HTTP requests with proper error handling
 */

/**
 * Sleep utility for retry logic
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Make an API request with retry logic
 * @param {string} url - API endpoint
 * @param {Object} options - Request options
 * @param {number} options.retries - Number of retry attempts (default: 0)
 * @param {number} options.retryDelay - Base delay between retries in ms (default: 1000)
 */
export async function makeRequest(url, options = {}) {
  const {
    method = 'POST',
    headers = {},
    body = null,
    signal = null,
    retries = 0,
    retryDelay = 1000
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

  let lastError;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: `HTTP ${response.status}: ${response.statusText}`
        }));
        
        const error = new Error(errorData.error || `Request failed with status ${response.status}`);
        error.status = response.status;
        
        // Don't retry on client errors (4xx except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw error;
        }
        
        throw error;
      }

      return response;
    } catch (error) {
      lastError = error;
      
      if (error.name === 'AbortError') {
        throw new Error('Request was aborted');
      }
      
      // Don't retry on last attempt or for non-retryable errors
      if (attempt === retries || (error.status >= 400 && error.status < 500 && error.status !== 429)) {
        throw error;
      }
      
      // Exponential backoff: 1s, 2s, 4s, etc.
      const delay = retryDelay * Math.pow(2, attempt);
      console.warn(`Request failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
  
  throw lastError;
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

  // Validate messages array if provided
  if (payload.messages) {
    if (!Array.isArray(payload.messages)) {
      return { valid: false, error: 'Messages must be an array' };
    }
    
    if (payload.messages.length === 0) {
      return { valid: false, error: 'Messages array cannot be empty' };
    }

    // Validate each message structure
    for (const msg of payload.messages) {
      if (!msg.role || !msg.content) {
        return { valid: false, error: 'Each message must have role and content' };
      }
      if (!['system', 'user', 'assistant'].includes(msg.role)) {
        return { valid: false, error: 'Invalid message role. Must be system, user, or assistant' };
      }
    }
  }

  // Validate prompt if provided
  if (payload.prompt && typeof payload.prompt !== 'string') {
    return { valid: false, error: 'Prompt must be a string' };
  }

  return { valid: true };
}
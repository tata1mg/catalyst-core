/**
 * API Handler
 * Server-side handler for processing AI requests
 * Supports both streaming and non-streaming responses
 */

import * as openaiProvider from './providers/openai.js';
import * as anthropicProvider from './providers/anthropic.js';
import { formatSSE } from '../core/stream-processor.js';

/**
 * Available providers
 */
const PROVIDERS = {
  openai: openaiProvider,
  anthropic: anthropicProvider
};

/**
 * Get provider by name
 */
function getProvider(providerName) {
  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new Error(`Unsupported provider: ${providerName}. Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

/**
 * Validate request body
 */
function validateRequest(body) {
  if (!body) {
    return { valid: false, error: 'Request body is required' };
  }

  if (!body.prompt && !body.messages) {
    return { valid: false, error: 'Either prompt or messages is required' };
  }

  if (!body.apiKey) {
    return { valid: false, error: 'API key is required' };
  }

  return { valid: true };
}

/**
 * Handle non-streaming generation
 */
async function handleGeneration(req, res, provider) {
  try {
    const result = await provider.textGenerate(req.body);
    res.json(result);
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Handle streaming generation
 */
async function handleStreaming(req, res, provider) {
  try {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Get stream from provider
    const streamBody = await provider.textStream(req.body);
    const reader = streamBody.getReader();
    
    // Create stream processor
    const processor = provider.createStreamProcessor();
    
    // Process and send chunks
    for await (const chunk of processor.processStream(reader)) {
      if (chunk.type === 'text-delta') {
        res.write(formatSSE({
          type: 'text-delta',
          delta: chunk.delta
        }));
      } else if (chunk.type === 'error') {
        res.write(formatSSE({
          type: 'error',
          error: chunk.error
        }));
        break;
      } else if (chunk.type === 'done') {
        res.write('data: [DONE]\n\n');
        break;
      }
    }

    res.end();
  } catch (error) {
    console.error('Streaming error:', error);
    
    // Try to send error as SSE
    try {
      res.write(formatSSE({
        type: 'error',
        error: error.message
      }));
    } catch {
      // If that fails, send as JSON
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
    
    res.end();
  }
}

/**
 * Create API handler
 * 
 * @param {Object} config - Handler configuration
 * @param {string} config.provider - Default provider name
 * @param {string} config.apiKey - Default API key
 * @param {string} config.model - Default model
 * 
 * @returns {Function} Express/Node.js request handler
 */
export function createAPIHandler(config = {}) {
  return async (req, res) => {
    // Only accept POST requests
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      // Merge config with request body
      const requestData = {
        ...config,
        ...req.body,
        apiKey: req.body.apiKey || config.apiKey
      };

      // Validate request
      const validation = validateRequest(requestData);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      // Get provider
      const providerName = requestData.provider || 'openai';
      const provider = getProvider(providerName);

      // Update request body with merged data
      req.body = requestData;

      // Handle based on stream mode
      if (requestData.stream) {
        await handleStreaming(req, res, provider);
      } else {
        await handleGeneration(req, res, provider);
      }
    } catch (error) {
      console.error('API handler error:', error);
      
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  };
}

/**
 * Create chat-specific handler
 */
export function createChatHandler(config = {}) {
  return createAPIHandler({
    ...config,
    stream: true // Default to streaming for chat
  });
}

/**
 * Create completion-specific handler
 */
export function createCompletionHandler(config = {}) {
  return createAPIHandler({
    ...config,
    stream: true // Default to streaming for completion
  });
}

/**
 * Express middleware for parsing body
 */
export function bodyParserMiddleware(req, res, next) {
  if (req.method === 'POST') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        req.body = JSON.parse(body);
        next();
      } catch (error) {
        res.status(400).json({ error: 'Invalid JSON' });
      }
    });
  } else {
    next();
  }
}
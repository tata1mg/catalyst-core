/**
 * OpenAI Provider
 * Handles communication with OpenAI's API
 */

/**
 * OpenAI Provider Configuration
 */
const OPENAI_CONFIG = {
  baseURL: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o-mini',
  models: {
    // Latest GPT-4 Models (2024-2025)
    'gpt-4o': 'gpt-4o',                           // Most capable, multimodal
    'gpt-4o-mini': 'gpt-4o-mini',                 // Fast, affordable, recommended
    'gpt-4-turbo': 'gpt-4-turbo',                 // Previous generation
    'gpt-4': 'gpt-4',                             // Original GPT-4
    
    // GPT-3.5 Models
    'gpt-3.5-turbo': 'gpt-3.5-turbo',            // Legacy, use gpt-4o-mini instead
    
    // Reasoning Models (o-series)
    'o1': 'o1',                                   // Advanced reasoning
    'o1-mini': 'o1-mini',                         // Fast reasoning
    'o1-preview': 'o1-preview',                   // Preview version
    
    // Specific versions (for production stability)
    'gpt-4o-2024-11-20': 'gpt-4o-2024-11-20',
    'gpt-4o-mini-2024-07-18': 'gpt-4o-mini-2024-07-18',
    'gpt-4-turbo-2024-04-09': 'gpt-4-turbo-2024-04-09'
  },
  
  // Model capabilities
  capabilities: {
    'gpt-4o': { vision: true, functions: true, json: true, maxTokens: 16384 },
    'gpt-4o-mini': { vision: true, functions: true, json: true, maxTokens: 16384 },
    'gpt-4-turbo': { vision: true, functions: true, json: true, maxTokens: 4096 },
    'gpt-4': { vision: false, functions: true, json: true, maxTokens: 8192 },
    'gpt-3.5-turbo': { vision: false, functions: true, json: true, maxTokens: 4096 },
    'o1': { vision: false, functions: false, json: false, maxTokens: 32768 },
    'o1-mini': { vision: false, functions: false, json: false, maxTokens: 65536 },
    'o1-preview': { vision: false, functions: false, json: false, maxTokens: 32768 }
  }
};

/**
 * Format messages for OpenAI API
 * Handles text, images, and system prompts
 */
function formatMessages(prompt, messages, systemPrompt) {
  let formattedMessages = [];

  // Add system prompt if provided
  if (systemPrompt) {
    formattedMessages.push({
      role: 'system',
      content: systemPrompt
    });
  }

  // Handle message array
  if (messages && Array.isArray(messages)) {
    formattedMessages = [
      ...formattedMessages,
      ...messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        ...(msg.name && { name: msg.name }),
        ...(msg.function_call && { function_call: msg.function_call }),
        ...(msg.tool_calls && { tool_calls: msg.tool_calls })
      }))
    ];
  } 
  // Handle simple prompt
  else if (prompt) {
    formattedMessages.push({ 
      role: 'user', 
      content: prompt 
    });
  } 
  else {
    throw new Error('Either prompt or messages must be provided');
  }

  return formattedMessages;
}

/**
 * Validate API key format
 */
function validateApiKey(apiKey) {
  if (!apiKey) {
    throw new Error('OpenAI API key is required');
  }
  if (!apiKey.startsWith('sk-')) {
    throw new Error('Invalid OpenAI API key format. Must start with "sk-"');
  }
  return true;
}

/**
 * Get model capabilities
 */
function getModelCapabilities(model) {
  const capabilities = OPENAI_CONFIG.capabilities[model] || 
                      OPENAI_CONFIG.capabilities['gpt-4o-mini'];
  return capabilities;
}

/**
 * Handle OpenAI API errors with detailed messages
 */
function handleOpenAIError(error, response) {
  const status = response?.status;
  
  // Specific error messages based on status code
  const errorMessages = {
    400: 'Bad request. Check your parameters.',
    401: 'Invalid API key. Please check your OpenAI API key.',
    403: 'Forbidden. Your API key may not have access to this model.',
    404: 'Model not found. The requested model may not exist or is not available.',
    429: 'Rate limit exceeded. Please slow down your requests.',
    500: 'OpenAI server error. Please try again later.',
    503: 'OpenAI service unavailable. Please try again later.'
  };

  const message = errorMessages[status] || error.message || 'OpenAI API error';
  
  const enhancedError = new Error(message);
  enhancedError.status = status;
  enhancedError.originalError = error;
  
  return enhancedError;
}

/**
 * Generate text using OpenAI (non-streaming)
 */
export async function textGenerate(options = {}) {
  const {
    apiKey,
    prompt,
    messages,
    model = OPENAI_CONFIG.defaultModel,
    systemPrompt,
    temperature = 0.7,
    maxTokens = 1000,
    topP,
    frequencyPenalty,
    presencePenalty,
    stop,
    user,
    seed,
    responseFormat,
    tools,
    toolChoice,
    logitBias,
    n = 1
  } = options;

  // Validate API key
  validateApiKey(apiKey);

  const url = `${OPENAI_CONFIG.baseURL}/chat/completions`;
  
  // Build request body
  const requestBody = {
    model,
    messages: formatMessages(prompt, messages, systemPrompt),
    temperature,
    max_tokens: maxTokens,
    stream: false,
    n
  };

  // Add optional parameters
  if (topP !== undefined) requestBody.top_p = topP;
  if (frequencyPenalty !== undefined) requestBody.frequency_penalty = frequencyPenalty;
  if (presencePenalty !== undefined) requestBody.presence_penalty = presencePenalty;
  if (stop) requestBody.stop = stop;
  if (user) requestBody.user = user;
  if (seed !== undefined) requestBody.seed = seed;
  if (logitBias) requestBody.logit_bias = logitBias;
  
  // Advanced features
  if (responseFormat) {
    requestBody.response_format = responseFormat; // e.g., { type: 'json_object' }
  }
  if (tools && Array.isArray(tools) && tools.length > 0) {
    requestBody.tools = tools;
    if (toolChoice) requestBody.tool_choice = toolChoice;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.error?.message || `OpenAI API error: ${response.status}`);
      throw handleOpenAIError(error, response);
    }

    const data = await response.json();
    
    // Handle multiple choices if n > 1
    const choices = data.choices || [];
    
    return {
      text: choices[0]?.message?.content || '',
      message: choices[0]?.message,
      choices: choices.map(choice => ({
        text: choice.message?.content || '',
        message: choice.message,
        finishReason: choice.finish_reason,
        index: choice.index
      })),
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      },
      finishReason: choices[0]?.finish_reason || 'stop',
      metadata: {
        model: data.model,
        id: data.id,
        created: data.created,
        systemFingerprint: data.system_fingerprint
      }
    };
  } catch (error) {
    if (error.status) {
      throw error; // Already handled
    }
    throw new Error(`OpenAI generation failed: ${error.message}`);
  }
}

/**
 * Stream text using OpenAI
 */
export async function textStream(options = {}) {
  const {
    apiKey,
    prompt,
    messages,
    model = OPENAI_CONFIG.defaultModel,
    systemPrompt,
    temperature = 0.7,
    maxTokens = 1000,
    topP,
    frequencyPenalty,
    presencePenalty,
    stop,
    user,
    seed,
    responseFormat,
    tools,
    toolChoice,
    streamOptions
  } = options;

  // Validate API key
  validateApiKey(apiKey);

  const url = `${OPENAI_CONFIG.baseURL}/chat/completions`;
  
  // Build request body
  const requestBody = {
    model,
    messages: formatMessages(prompt, messages, systemPrompt),
    temperature,
    max_tokens: maxTokens,
    stream: true
  };

  // Add optional parameters
  if (topP !== undefined) requestBody.top_p = topP;
  if (frequencyPenalty !== undefined) requestBody.frequency_penalty = frequencyPenalty;
  if (presencePenalty !== undefined) requestBody.presence_penalty = presencePenalty;
  if (stop) requestBody.stop = stop;
  if (user) requestBody.user = user;
  if (seed !== undefined) requestBody.seed = seed;
  
  // Advanced features
  if (responseFormat) {
    requestBody.response_format = responseFormat;
  }
  if (tools && Array.isArray(tools) && tools.length > 0) {
    requestBody.tools = tools;
    if (toolChoice) requestBody.tool_choice = toolChoice;
  }
  if (streamOptions) {
    requestBody.stream_options = streamOptions; // e.g., { include_usage: true }
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.error?.message || `OpenAI API error: ${response.status}`);
      throw handleOpenAIError(error, response);
    }

    return response.body;
  } catch (error) {
    if (error.status) {
      throw error; // Already handled
    }
    throw new Error(`OpenAI streaming failed: ${error.message}`);
  }
}

/**
 * Process OpenAI stream and convert to standard format
 * Handles text deltas, function calls, and tool calls
 */
export function createStreamProcessor() {
  return {
    async *processStream(reader) {
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // Keep incomplete line in buffer
          buffer = buffer.endsWith('\n') ? '' : (lines.pop() || '');

          for (const line of lines) {
            if (!line.trim() || !line.startsWith('data: ')) continue;

            const data = line.slice(6);
            if (data === '[DONE]') {
              yield {
                type: 'done'
              };
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const choice = parsed.choices?.[0];
              
              if (!choice) continue;

              // Handle text content delta
              const content = choice.delta?.content;
              if (content) {
                yield {
                  type: 'text-delta',
                  delta: content
                };
              }

              // Handle function calls (legacy)
              const functionCall = choice.delta?.function_call;
              if (functionCall) {
                yield {
                  type: 'function-call',
                  functionCall
                };
              }

              // Handle tool calls (current)
              const toolCalls = choice.delta?.tool_calls;
              if (toolCalls && toolCalls.length > 0) {
                yield {
                  type: 'tool-call',
                  toolCalls
                };
              }

              // Handle finish reason
              if (choice.finish_reason) {
                yield {
                  type: 'finish',
                  finishReason: choice.finish_reason
                };
              }

              // Handle usage info (if stream_options.include_usage is true)
              if (parsed.usage) {
                yield {
                  type: 'usage',
                  usage: {
                    promptTokens: parsed.usage.prompt_tokens,
                    completionTokens: parsed.usage.completion_tokens,
                    totalTokens: parsed.usage.total_tokens
                  }
                };
              }
            } catch (e) {
              console.warn('Failed to parse OpenAI stream chunk:', e, 'Line:', line);
              yield {
                type: 'error',
                error: `Failed to parse stream chunk: ${e.message}`
              };
              // Continue processing other lines instead of breaking
            }
          }
        }
      } catch (error) {
        console.error('OpenAI stream processing error:', error);
        yield {
          type: 'error',
          error: error.message || 'Stream processing failed'
        };
      } finally {
        // Ensure reader is released
        try {
          reader.releaseLock();
        } catch (e) {
          // Reader might already be released
        }
      }
    }
  };
}

/**
 * List available models
 */
export function listModels() {
  return Object.keys(OPENAI_CONFIG.models);
}

/**
 * Check if model supports a capability
 */
export function supportsCapability(model, capability) {
  const capabilities = getModelCapabilities(model);
  return capabilities[capability] || false;
}

/**
 * Get recommended model for use case
 */
export function getRecommendedModel(useCase = 'general') {
  const recommendations = {
    'general': 'gpt-4o-mini',           // Best balance of speed and quality
    'chat': 'gpt-4o-mini',              // Fast and affordable for chat
    'complex': 'gpt-4o',                // Most capable
    'vision': 'gpt-4o',                 // Supports images
    'reasoning': 'o1-mini',             // Advanced reasoning
    'fast': 'gpt-4o-mini',              // Fastest
    'affordable': 'gpt-4o-mini',        // Most cost-effective
    'legacy': 'gpt-3.5-turbo'           // Backward compatibility
  };
  
  return recommendations[useCase] || recommendations.general;
}

/**
 * Export provider info
 */
export const providerInfo = {
  name: 'openai',
  models: OPENAI_CONFIG.models,
  defaultModel: OPENAI_CONFIG.defaultModel,
  capabilities: OPENAI_CONFIG.capabilities,
  listModels,
  supportsCapability,
  getRecommendedModel
};
/**
 * AI SDK Default Configuration
 * Centralized default values for all SDK components
 * Users can override these by passing options or setting environment variables
 */

/**
 * Provider Configuration Defaults
 */
export const PROVIDER_DEFAULTS = {
    // Default provider (can be 'openai' or 'anthropic')
    provider: 'openai',
    
    // OpenAI defaults
    openai: {
        baseURL: 'https://api.openai.com/v1',
        chatCompletionsURL: 'https://api.openai.com/v1/chat/completions',
        responsesURL: 'https://api.openai.com/v1/responses',
        defaultModel: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 2048,
        topP: undefined,
        frequencyPenalty: undefined,
        presencePenalty: undefined,
        n: 1,
        // API Selection (Responses API vs Chat Completions API)
        useChatCompletions: false, //DEFAULT: false = Use Responses API (50-70% token savings!), true = Use Chat Completions API
        // Responses API specific defaults (only used when useChatCompletions = false)
        store: true, // Enable stateful conversations
        reasoningEffort: 'medium', // low/medium/high for o3-mini, o4-mini
        includeReasoning: false, // Stream reasoning tokens
    },
    
    // Anthropic defaults
    anthropic: {
        baseURL: 'https://api.anthropic.com/v1',
        defaultModel: 'claude-3-5-sonnet-20241022',
        temperature: 0.7,
        maxTokens: 2048,
        topP: undefined,
        topK: undefined,
    }
};

/**
 * HTTP Client Defaults
 */
export const HTTP_CLIENT_DEFAULTS = {
    // Retry configuration
    retries: 2,
    retryDelay: 1000, // milliseconds
    
    // Timeout configuration
    timeout: 60000, // 60 seconds
    
    // Request configuration
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
};

/**
 * Stream Processing Defaults
 */
export const STREAM_DEFAULTS = {
    // Maximum accumulated text length (1MB)
    maxLength: 1024 * 1024,
    
    // Stream options
    stream: true,
    
    // Buffer management
    bufferSize: 8192,
};

/**
 * Rate Limiter Defaults
 */
export const RATE_LIMITER_DEFAULTS = {
    // Development defaults
    development: {
        maxRequests: 10,
        windowMs: 60000, // 1 minute
    },
    
    // Production defaults
    production: {
        maxRequests: 60,
        windowMs: 60000, // 1 minute
    },
    
    // Default tier
    default: {
        maxRequests: 30,
        windowMs: 60000, // 1 minute
    },
};

/**
 * API Handler Defaults
 */
export const API_HANDLER_DEFAULTS = {
    // Default stream mode
    stream: true,
    
    // Validation defaults
    validation: {
        enabled: true,
        strictMode: false,
    },
    
    // Response headers
    headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    },
};

/**
 * Validation Defaults
 */
export const VALIDATION_DEFAULTS = {
    // Temperature range
    temperature: {
        min: 0,
        max: 2,
    },
    
    // Token limits
    tokens: {
        min: 1,
        max: 16384,
        default: 2048,
    },
    
    // Prompt limits
    prompt: {
        minLength: 1,
        maxLength: 100000, // ~100KB
    },
    
    // Message limits
    messages: {
        minCount: 1,
        maxCount: 100,
    },
};

/**
 * Error Messages
 */
export const ERROR_MESSAGES = {
    // API errors
    MISSING_API_KEY: 'API key is required',
    INVALID_API_KEY_FORMAT: 'Invalid API key format',
    MISSING_PROMPT_OR_MESSAGES: 'Either prompt or messages is required',
    INVALID_PROVIDER: 'Unsupported provider',
    
    // Validation errors
    EMPTY_PROMPT: 'Prompt cannot be empty',
    EMPTY_MESSAGES: 'Messages array cannot be empty',
    INVALID_MESSAGES_FORMAT: 'Messages must be an array',
    INVALID_MESSAGE_STRUCTURE: 'Each message must have role and content',
    INVALID_TEMPERATURE: 'Temperature must be between 0 and 2',
    INVALID_MAX_TOKENS: 'maxTokens must be a positive number',
    MAX_LENGTH_EXCEEDED: 'Response exceeded maximum length',
    
    // HTTP errors
    REQUEST_ABORTED: 'Request was aborted',
    REQUEST_TIMEOUT: 'Request timeout',
    NETWORK_ERROR: 'Network error occurred',
    
    // Stream errors
    STREAM_PROCESSING_ERROR: 'Stream processing failed',
    STREAM_PARSING_ERROR: 'Failed to parse stream data',
    NO_READABLE_BODY: 'Response does not contain a readable body',
};

/**
 * Environment Variable Keys
 */
export const ENV_KEYS = {
    // Provider keys
    OPENAI_API_KEY: 'OPENAI_API_KEY',
    ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
    AI_PROVIDER: 'AI_PROVIDER',
    
    // Model keys
    OPENAI_MODEL: 'OPENAI_MODEL',
    ANTHROPIC_MODEL: 'ANTHROPIC_MODEL',
    
    // Configuration keys
    NODE_ENV: 'NODE_ENV',
    AI_SDK_DEBUG: 'AI_SDK_DEBUG',
};

/**
 * Get environment-aware defaults
 */
export function getEnvironmentDefaults() {
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    return {
        ...PROVIDER_DEFAULTS,
        rateLimiter: isDevelopment 
            ? RATE_LIMITER_DEFAULTS.development 
            : RATE_LIMITER_DEFAULTS.production,
        debug: process.env.AI_SDK_DEBUG === 'true',
    };
}

/**
 * Merge user options with defaults
 */
export function mergeWithDefaults(userOptions = {}, defaults = {}) {
    return {
        ...defaults,
        ...userOptions,
        // Deep merge for nested objects
        ...(userOptions.headers && defaults.headers && {
            headers: {
                ...defaults.headers,
                ...userOptions.headers,
            }
        }),
    };
}

/**
 * Get provider-specific defaults
 */
export function getProviderDefaults(provider = 'openai') {
    return PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.openai;
}

/**
 * Validate and apply defaults
 */
export function applyDefaults(options = {}, context = 'client') {
    const providerName = options.provider || PROVIDER_DEFAULTS.provider;
    const providerDefaults = getProviderDefaults(providerName);
    
    return {
        provider: providerName,
        model: options.model || providerDefaults.defaultModel,
        temperature: options.temperature ?? providerDefaults.temperature,
        maxTokens: options.maxTokens || providerDefaults.maxTokens,
        stream: options.stream ?? (context === 'server' ? API_HANDLER_DEFAULTS.stream : STREAM_DEFAULTS.stream),
        ...options,
    };
}

// Export all defaults as a single object for convenience
export default {
    PROVIDER_DEFAULTS,
    HTTP_CLIENT_DEFAULTS,
    STREAM_DEFAULTS,
    RATE_LIMITER_DEFAULTS,
    API_HANDLER_DEFAULTS,
    VALIDATION_DEFAULTS,
    ERROR_MESSAGES,
    ENV_KEYS,
    getEnvironmentDefaults,
    mergeWithDefaults,
    getProviderDefaults,
    applyDefaults,
};
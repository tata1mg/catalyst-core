import { createAPIHandler } from '../../ai-sdk/server/api-handler.js';

/**
 * Prompt API Handler
 * Handles POST /api/prompt requests
 */
export const handlePromptRequest = createAPIHandler({
    provider: process.env.AI_PROVIDER || 'openai',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY
});
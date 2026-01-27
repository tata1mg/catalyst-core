import { createAPIHandler } from '../../ai-sdk/server/api-handler.js';

/**
 * Dialogue API Handler
 * Handles POST /api/dialogue requests
 */
export const handleDialogueRequest = createAPIHandler({
    provider: process.env.AI_PROVIDER || 'openai',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
    stream: true // Enable streaming by default for dialogue
});

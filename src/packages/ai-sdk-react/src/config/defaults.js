/**
 * React Hooks Default Configuration
 * Default values for React hooks in @catalyst/ai-sdk-react
 */

/**
 * React Hooks Defaults
 */
export const REACT_HOOKS_DEFAULTS = {
    // API endpoints
    api: {
        prompt: '/api/prompt',
        dialogue: '/api/dialogue',
    },
    
    // Hook options
    stream: true,
    initialCompletion: '',
    initialInput: '',
    
    // Behavior
    autoSubmit: false,
    clearOnSubmit: false,
};

// Export as default for convenience
export default {
    REACT_HOOKS_DEFAULTS,
};
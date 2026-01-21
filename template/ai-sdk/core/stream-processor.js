/**
 * Stream Processor
 * Handles SSE (Server-Sent Events) stream processing
 */

/**
 * Process a text stream from the server
 * @param {ReadableStream} stream - The response stream
 * @param {Object} callbacks - Callback functions
 * @param {(chunk: string, fullText: string) => void} [callbacks.onChunk] - Called for each chunk
 * @param {(fullText: string) => void} [callbacks.onComplete] - Called when stream completes
 * @param {(error: Error) => void} [callbacks.onError] - Called on error
 * @param {number} [callbacks.maxLength=1048576] - Max accumulated text length (default: 1MB)
 * @returns {Promise<string>} - The accumulated text
 */
export async function processTextStream(stream, callbacks = {}) {
  const {
    onChunk = () => {},
    onComplete = () => {},
    onError = () => {},
    maxLength = 1024 * 1024 // 1MB default limit
  } = callbacks;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulatedText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        onComplete(accumulatedText);
        break;
      }

      // Decode the chunk
      buffer += decoder.decode(value, { stream: true });
      
      // Split by newlines to process each line
      const lines = buffer.split('\n');
      
      // Keep the last incomplete line in the buffer (unless buffer ends with \n)
      buffer = buffer.endsWith('\n') ? '' : (lines.pop() || '');

      // Process each complete line
      for (const line of lines) {
        if (!line.trim()) continue;

        // Handle SSE format: "data: {...}"
        if (line.startsWith('data: ')) {
          try {
            const dataStr = line.slice(6);
            
            // Check for completion signal
            if (dataStr === '[DONE]') {
              onComplete(accumulatedText);
              return accumulatedText;
            }

            const data = JSON.parse(dataStr);

            // Handle different chunk types
            if (data.type === 'text-delta' && data.delta) {
              // Check accumulated text length to prevent memory issues
              if (accumulatedText.length + data.delta.length > maxLength) {
                const error = new Error(`Response exceeded maximum length of ${maxLength} characters`);
                onError(error);
                return accumulatedText;
              }
              accumulatedText += data.delta;
              onChunk(data.delta, accumulatedText);
            } else if (data.type === 'error') {
              onError(new Error(data.error || 'Stream error'));
              return accumulatedText;
            } else if (data.content) {
              // Direct content format
              if (accumulatedText.length + data.content.length > maxLength) {
                const error = new Error(`Response exceeded maximum length of ${maxLength} characters`);
                onError(error);
                return accumulatedText;
              }
              accumulatedText += data.content;
              onChunk(data.content, accumulatedText);
            }
          } catch (parseError) {
            console.warn('Failed to parse stream data:', parseError, 'Line:', line);
            // Optionally notify about parsing errors
            onError(new Error(`Stream parsing error: ${parseError.message}`));
          }
        }
      }
    }
  } catch (error) {
    onError(error);
  }

  return accumulatedText;
}

/**
 * Create a readable stream wrapper
 * @param {Response} response - Fetch API response object
 * @returns {Object} Stream wrapper with process and getReader methods
 */
export function createStreamWrapper(response) {
  if (!response.body) {
    throw new Error('Response does not contain a readable body');
  }

  return {
    stream: response.body,
    
    async process(callbacks) {
      return processTextStream(this.stream, callbacks);
    },
    
    getReader() {
      return this.stream.getReader();
    }
  };
}

/**
 * Parse SSE line
 * @param {string} line - SSE formatted line
 * @returns {Object|null} Parsed data object or null if invalid
 */
export function parseSSELine(line) {
  if (!line.startsWith('data: ')) {
    return null;
  }

  const dataStr = line.slice(6);
  
  if (dataStr === '[DONE]') {
    return { type: 'done' };
  }

  try {
    return JSON.parse(dataStr);
  } catch {
    return null;
  }
}

/**
 * Create SSE formatter for server-side
 * @param {Object} data - Data object to format
 * @returns {string} SSE formatted string
 */
export function formatSSE(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}
/**
 * Create completion signal
 * @returns {string} SSE formatted completion signal
 */
export function createCompletionSignal() {
  return 'data: [DONE]\n\n';
}
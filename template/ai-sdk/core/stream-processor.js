/**
 * Stream Processor
 * Handles SSE (Server-Sent Events) stream processing
 */

/**
 * Process a text stream from the server
 * @param {ReadableStream} stream - The response stream
 * @param {Object} callbacks - Callback functions
 */
export async function processTextStream(stream, callbacks = {}) {
  const {
    onChunk = () => {},
    onComplete = () => {},
    onError = () => {}
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
      
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

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
              accumulatedText += data.delta;
              onChunk(data.delta, accumulatedText);
            } else if (data.type === 'error') {
              onError(new Error(data.error || 'Stream error'));
              return accumulatedText;
            } else if (data.content) {
              // Direct content format
              accumulatedText += data.content;
              onChunk(data.content, accumulatedText);
            }
          } catch (parseError) {
            console.warn('Failed to parse stream data:', parseError);
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
 */
export function formatSSE(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}
/**
 * Create completion signal
 */
export function createCompletionSignal() {
  return 'data: [DONE]\n\n';
}
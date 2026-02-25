/**
 * Stream Processor
 * Handles SSE (Server-Sent Events) stream processing
 */

import { STREAM_DEFAULTS, ERROR_MESSAGES } from "../config/defaults.js"

/**
 * Process a text stream from the server
 * @param {ReadableStream} stream - The response stream
 * @param {Object} callbacks - Callback functions
 * @param {(chunk: string, fullText: string) => void} [callbacks.onChunk] - Called for each chunk
 * @param {(fullText: string) => void} [callbacks.onComplete] - Called when stream completes
 * @param {(error: Error) => void} [callbacks.onError] - Called on error
 * @param {(metadata: Object) => void} [callbacks.onMetadata] - Called when metadata is received (responseId, conversationId, etc.)
 * @param {number} [callbacks.maxLength] - Max accumulated text length (default from config)
 * @returns {Promise<string>} - The accumulated text
 */
export async function processTextStream(stream, callbacks = {}) {
    const {
        onChunk = () => {},
        onComplete = () => {},
        onError = () => {},
        onMetadata = () => {},
        maxLength = STREAM_DEFAULTS.maxLength,
    } = callbacks

    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let accumulatedText = ""

    try {
        let streaming = true
        while (streaming) {
            const { done, value } = await reader.read()

            if (done) {
                // Process any remaining buffer content before completing
                if (buffer.trim()) {
                    // Try to parse as JSON (non-SSE format)
                    try {
                        const data = JSON.parse(buffer)
                        if (data.text) {
                            accumulatedText += data.text
                            onChunk(data.text, accumulatedText)
                        } else if (data.content) {
                            accumulatedText += data.content
                            onChunk(data.content, accumulatedText)
                        }
                    } catch (parseError) {
                        // If not JSON, check if it's SSE format
                        if (buffer.startsWith("data: ")) {
                            try {
                                const dataStr = buffer.slice(6)
                                if (dataStr !== "[DONE]") {
                                    const data = JSON.parse(dataStr)
                                    if (data.type === "text-delta" && data.delta) {
                                        accumulatedText += data.delta
                                        onChunk(data.delta, accumulatedText)
                                    } else if (data.content) {
                                        accumulatedText += data.content
                                        onChunk(data.content, accumulatedText)
                                    }
                                }
                                } catch (sseError) {
                                    // Failed to parse remaining SSE buffer
                                }
                            } else {
                                // Remaining buffer is not valid JSON or SSE
                        }
                    }
                }

                onComplete(accumulatedText)
                break
            }

            // Decode the chunk
            buffer += decoder.decode(value, { stream: true })

            // Split by newlines to process each line
            const lines = buffer.split("\n")

            // Keep the last incomplete line in the buffer (unless buffer ends with \n)
            buffer = buffer.endsWith("\n") ? "" : lines.pop() || ""
            // Process each complete line
            for (const line of lines) {
                if (!line.trim()) continue

                // Skip SSE comments (connection keep-alive)
                if (line.startsWith(":")) continue

                // Handle SSE format: "data: {...}"
                if (line.startsWith("data: ")) {
                    try {
                        const dataStr = line.slice(6)

                        // Check for completion signal
                        if (dataStr === "[DONE]") {
                            onComplete(accumulatedText)
                            return accumulatedText
                        }

                        const data = JSON.parse(dataStr)

                        // Handle different chunk types
                        if (data.type === "text-delta" && data.delta) {
                            // Check accumulated text length to prevent memory issues
                            if (accumulatedText.length + data.delta.length > maxLength) {
                                const error = new Error(ERROR_MESSAGES.MAX_LENGTH_EXCEEDED)
                                onError(error)
                                return accumulatedText
                            }
                            accumulatedText += data.delta
                            onChunk(data.delta, accumulatedText)
                        } else if (data.type === "response-created") {
                            // Pass metadata to callback
                            onMetadata({
                                responseId: data.responseId,
                                conversationId: data.conversationId,
                                metadata: data.metadata,
                            })
                        } else if (data.type === "reasoning-delta") {
                            // Responses API: reasoning tokens
                        } else if (data.type === "done") {
                            // Stream completion
                        } else if (data.type === "error") {
                            onError(new Error(data.error || ERROR_MESSAGES.STREAM_PROCESSING_ERROR))
                            return accumulatedText
                        } else if (data.content) {
                            // Direct content format (legacy)
                            if (accumulatedText.length + data.content.length > maxLength) {
                                const error = new Error(ERROR_MESSAGES.MAX_LENGTH_EXCEEDED)
                                onError(error)
                                return accumulatedText
                            }
                            accumulatedText += data.content
                            onChunk(data.content, accumulatedText)
                        }
                    } catch (parseError) {
                        // Optionally notify about parsing errors
                        onError(new Error(`${ERROR_MESSAGES.STREAM_PARSING_ERROR}: ${parseError.message}`))
                    }
                } else {
                    // Handle non-SSE format (raw JSON response)
                    try {
                        const data = JSON.parse(line)

                        // Check if this is a complete response (non-streaming format)
                        if (data.text) {
                            const content = data.text
                            if (accumulatedText.length + content.length > maxLength) {
                                const error = new Error(ERROR_MESSAGES.MAX_LENGTH_EXCEEDED)
                                onError(error)
                                return accumulatedText
                            }
                            accumulatedText += content
                            onChunk(content, accumulatedText)
                        } else if (data.content) {
                            const content = data.content
                            if (accumulatedText.length + content.length > maxLength) {
                                const error = new Error(ERROR_MESSAGES.MAX_LENGTH_EXCEEDED)
                                onError(error)
                                return accumulatedText
                            }
                            accumulatedText += content
                            onChunk(content, accumulatedText)
                        } else if (data.type === "text-delta" && data.delta) {
                            // Handle delta format without SSE prefix
                            if (accumulatedText.length + data.delta.length > maxLength) {
                                const error = new Error(ERROR_MESSAGES.MAX_LENGTH_EXCEEDED)
                                onError(error)
                                return accumulatedText
                            }
                            accumulatedText += data.delta
                            onChunk(data.delta, accumulatedText)
                        }
                        } catch (parseError) {
                            // Line is not valid JSON and not SSE format
                    }
                }
            }
        }
    } catch (error) {
        onError(error)
    }

    return accumulatedText
}

/**
 * Create a readable stream wrapper
 * @param {Response} response - Fetch API response object
 * @returns {Object} Stream wrapper with process and getReader methods
 */
export function createStreamWrapper(response) {
    if (!response.body) {
        throw new Error(ERROR_MESSAGES.NO_READABLE_BODY)
    }

    return {
        stream: response.body,

        async process(callbacks) {
            return processTextStream(this.stream, callbacks)
        },

        getReader() {
            return this.stream.getReader()
        },
    }
}

/**
 * Parse SSE line
 * @param {string} line - SSE formatted line
 * @returns {Object|null} Parsed data object or null if invalid
 */
export function parseSSELine(line) {
    if (!line.startsWith("data: ")) {
        return null
    }

    const dataStr = line.slice(6)

    if (dataStr === "[DONE]") {
        return { type: "done" }
    }

    try {
        return JSON.parse(dataStr)
    } catch {
        return null
    }
}

/**
 * Create SSE formatter for server-side
 * @param {Object} data - Data object to format
 * @returns {string} SSE formatted string
 */
export function formatSSE(data) {
    return `data: ${JSON.stringify(data)}\n\n`
}
/**
 * Create completion signal
 * @returns {string} SSE formatted completion signal
 */
export function createCompletionSignal() {
    return "data: [DONE]\n\n"
}

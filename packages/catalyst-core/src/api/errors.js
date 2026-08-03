/**
 * Thrown by an API handler (or by the dispatch layer on its behalf) to produce a
 * non-200 response. `status` maps directly to the HTTP status code for browser
 * requests, and to the rejection callers see on a loopback dispatch.
 */
export class ApiError extends Error {
    /**
     * @param {number} status
     * @param {any} body - sent as the JSON response body for HTTP requests
     * @param {{ cause?: unknown }} [options]
     */
    constructor(status, body, options = {}) {
        const message = typeof body === "string" ? body : body?.message || `API Error (${status})`
        super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
        this.name = "ApiError"
        this.status = status
        this.body = body
    }
}

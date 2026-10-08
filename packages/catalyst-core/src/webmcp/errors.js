/**
 * WebMcpError — the error type for catalyst-core's WebMCP integration.
 *
 * Shaped deliberately like catalyst-core's `CatalystError` (same `.code`,
 * `.details`, `.suggestedAction`, `.cause` fields) so a later integration can
 * swap these ad-hoc codes for registry codes from `catalyst-core/errors`
 * without changing any call sites. The framework's own error registry
 * (PREFLIGHT_* / RUNTIME_WEB_* / AI_* …) has no code that means "a page
 * tool's execute() threw" or "the agent called a tool that isn't registered
 * on this route", so this module defines its own small set. That mapping
 * (folding these into the shared registry) is a follow-up, not part of this
 * migration — src/errors/registry.js has its own contract tests (#411) that
 * this module deliberately does not touch.
 */

export const WEBMCP_ERROR_CODES = Object.freeze({
    /** Agent invoked a tool name that is not currently registered. */
    TOOL_NOT_FOUND: "WEBMCP_TOOL_NOT_FOUND",
    /** Agent-supplied arguments failed a (shallow) inputSchema check. */
    INVALID_ARGS: "WEBMCP_INVALID_ARGS",
    /** The tool's own execute() threw or rejected. Original error is `.cause`. */
    EXECUTE_FAILED: "WEBMCP_EXECUTE_FAILED",
    /** The tool's route was left (or component unmounted) before execute() finished. */
    ABORTED: "WEBMCP_ABORTED",
    /** registerTool was called with a name that is already live. */
    DUPLICATE_TOOL: "WEBMCP_DUPLICATE_TOOL",
})

export class WebMcpError extends Error {
    constructor(code, { message, details, suggestedAction, cause } = {}) {
        super(message || code)
        this.name = "WebMcpError"
        this.code = code
        this.details = details
        this.suggestedAction = suggestedAction
        if (cause !== undefined) this.cause = cause
    }

    /** Plain object suitable for returning to an agent / rendering in a dev panel. */
    toResult() {
        return {
            ok: false,
            code: this.code,
            message: this.message,
            details: this.details,
            suggestedAction: this.suggestedAction,
        }
    }
}

/**
 * Wrap whatever a tool's execute() threw. If it already is a WebMcpError we
 * keep it; otherwise it becomes EXECUTE_FAILED with the original as `cause`.
 */
export function toWebMcpError(err, fallbackCode = WEBMCP_ERROR_CODES.EXECUTE_FAILED) {
    if (err instanceof WebMcpError) return err
    const message = err && err.message ? err.message : String(err)
    return new WebMcpError(fallbackCode, { message, cause: err })
}

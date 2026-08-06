import { ERROR_CODES, getDefinition, getDocUrl } from "./registry.js"

export { ERROR_CODES, getDocUrl }

export class CatalystError extends Error {
    constructor(code, { message, details, recoverable, suggestedAction, category, docUrl, cause } = {}) {
        super(message)
        this.name = "CatalystError"
        this.code = code
        this.category = category
        this.details = details
        this.recoverable = recoverable
        this.suggestedAction = suggestedAction
        this.docUrl = docUrl
        if (cause !== undefined) this.cause = cause
    }
}

/**
 * Create a CatalystError for a code we own, using registry.js defaults
 * unless overridden.
 */
export function createError(code, overrides = {}) {
    const def = getDefinition(code)
    return new CatalystError(code, {
        category: def.category,
        message: overrides.message || def.defaultMessage,
        details: overrides.details || def.defaultDetails,
        recoverable: overrides.recoverable ?? def.recoverable,
        suggestedAction: overrides.suggestedAction || def.suggestedAction,
        docUrl: getDocUrl(code),
        cause: overrides.cause,
    })
}

const STAGE_WRAPPER_CODE = {
    BUNDLE: ERROR_CODES.BUNDLE_UPSTREAM_ERROR,
    IOS: ERROR_CODES.IOS_UPSTREAM_ERROR,
    ANDROID: ERROR_CODES.ANDROID_UPSTREAM_ERROR,
}

const STAGE_UPSTREAM_NAME = {
    BUNDLE: "Vite/Rollup",
    IOS: "Xcode/CocoaPods",
    ANDROID: "Gradle",
}

/**
 * Wrap a foreign error (Vite/Rollup/native toolchain) that already carries
 * its own code/message. We do not replace or reinterpret it — we attach a
 * generic per-stage wrapper code and preserve the original as `cause`, so
 * the upstream code/message is always what gets shown to the user.
 */
export function wrapForeignError(stage, err) {
    const code = STAGE_WRAPPER_CODE[stage]
    if (!code) {
        throw new Error(`wrapForeignError: unknown stage "${stage}"`)
    }
    const upstreamName = STAGE_UPSTREAM_NAME[stage]
    // Only show err.code when it's a real upstream identifier (e.g. Rollup's
    // "PLUGIN_LOAD_ERROR"), not a bare numeric process exit status — a spawned
    // child's exit code is not an "upstream error code" and would be misleading.
    const hasNamedCode = err && typeof err.code === "string"
    const upstreamCode = hasNamedCode ? ` ${upstreamName} ${err.code}` : ` ${upstreamName}`
    const wrapped = createError(code, {
        message: `Build failed (upstream:${upstreamCode})`,
        cause: err,
    })
    return wrapped
}

const SSR_STAGE_CODE = {
    RENDER: ERROR_CODES.RUNTIME_WEB_RENDER_FAILED,
    FETCHER: ERROR_CODES.RUNTIME_WEB_FETCHER_FAILED,
    SERVER_SIDE_FUNCTION: ERROR_CODES.RUNTIME_WEB_SERVER_SIDE_FUNCTION_FAILED,
    REQUEST_HANDLING: ERROR_CODES.RUNTIME_WEB_REQUEST_HANDLING_FAILED,
}

/**
 * Wrap an error caught during SSR (handler.jsx). Unlike wrapForeignError's
 * build-stage wrapping, the caught error here could originate from the
 * user's app code, a third-party dependency, or catalyst-core's own
 * pipeline — there is no way to tell from the caught error object which.
 * So, like the BUNDLE/IOS/ANDROID wrappers, we never reinterpret it: we
 * attach a stage-specific code that identifies *where* in the SSR pipeline
 * the failure happened, and preserve the original error as `cause`.
 */
export function wrapSSRError(stage, err) {
    const code = SSR_STAGE_CODE[stage]
    if (!code) {
        throw new Error(`wrapSSRError: unknown stage "${stage}"`)
    }
    return createError(code, { cause: err })
}

/**
 * Wrap a failed AI provider HTTP response (OpenAI/Gemini). Unlike
 * wrapForeignError (build toolchains, which carry a named err.code), provider
 * failures are an HTTP status + response body — we preserve both verbatim
 * as `cause` rather than reinterpreting them.
 */
export function wrapProviderError(provider, status, bodyText) {
    const cause = new Error(`${provider} API error (${status}): ${bodyText}`)
    cause.provider = provider
    cause.status = status
    return createError(ERROR_CODES.AI_UPSTREAM_ERROR, {
        message: `AI provider request failed (upstream: ${provider} ${status})`,
        cause,
    })
}

/**
 * Format a CatalystError for terminal output. Foreign-wrapped errors always
 * show the original upstream message/code, never a paraphrase of it.
 *
 * Note: this prints the cause's *message* only, not its stack. Callers
 * logging a wrapped error to the console (see wrapSSRError call sites in
 * handler.jsx) should also log `err.cause` itself alongside this output so
 * the stack trace isn't lost — formatError is for the human-readable
 * summary, not a replacement for full error inspection.
 */
export function formatError(err) {
    const lines = [`[${err.code}] ${err.message}`]
    if (err.cause) {
        const causeMessage = err.cause.message || String(err.cause)
        lines.push(`→ ${causeMessage}`)
    } else if (err.details) {
        lines.push(err.details)
    }
    if (err.suggestedAction) {
        lines.push(`Suggested action: ${err.suggestedAction}`)
    }
    if (err.docUrl) {
        lines.push(`Docs: ${err.docUrl}`)
    }
    return lines.join("\n")
}

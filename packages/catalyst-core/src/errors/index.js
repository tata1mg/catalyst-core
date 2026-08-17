import { ERROR_CODES, getDefinition, getDocUrl } from "./registry.js"

export { ERROR_CODES }

export class CatalystError extends Error {
    constructor(code, { message, details, suggestedAction, category, docUrl, cause } = {}) {
        super(message)
        this.name = "CatalystError"
        this.code = code
        this.category = category
        this.details = details
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

/**
 * Format a CatalystError for terminal output. Foreign-wrapped errors always
 * show the original upstream message/code, never a paraphrase of it.
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

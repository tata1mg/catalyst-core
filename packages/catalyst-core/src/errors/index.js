import pc from "ansis"
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

function formatDefault(err) {
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

const BOX_WIDTH = 70

function box(bodyLines) {
    const top = pc.red(`┌${"─".repeat(BOX_WIDTH)}`)
    const bottom = pc.red(`└${"─".repeat(BOX_WIDTH)}`)
    const body = bodyLines.map((line) => (line === "" ? pc.red("│") : `${pc.red("│")} ${line}`))
    return [top, ...body, bottom].join("\n")
}

function formatCauseChain(cause) {
    const lines = []
    let current = cause
    let depth = 0
    while (current) {
        const prefix = depth === 0 ? "Caused by:" : `  ${"  ".repeat(depth - 1)}Caused by:`
        lines.push(`${prefix} ${current.message || String(current)}`)
        current = current.cause
        depth += 1
    }
    return lines
}

/**
 * Verbose output: boxed per RFC #155 §3.2 — code, timestamp, problem,
 * suggested action, docs link. Owns its own coloring (the box border and
 * text are colored as a unit here) rather than leaving callers to wrap the
 * whole multi-line block in a color function themselves.
 */
function formatVerbose(err) {
    const lines = [
        pc.bold(`❌ ${err.message}`),
        `Code: ${err.code}`,
        `Category: ${err.category || "UNKNOWN"}`,
        `Time: ${new Date().toISOString()}`,
        "",
    ]
    if (err.cause) {
        lines.push(`Problem: ${err.cause.message || String(err.cause)}`)
        lines.push("")
    } else if (err.details) {
        lines.push(`Problem: ${err.details}`)
        lines.push("")
    }
    if (err.suggestedAction) {
        lines.push("Solution:", `  ${err.suggestedAction}`, "")
    }
    if (err.docUrl) {
        lines.push(`Docs: ${err.docUrl}`)
    }
    return box(lines)
}

/**
 * Debug output: verbose + full cause chain + stack trace + environment
 * info. Environment gathering happens here (Node-side), not as module-level
 * state, so errors/index.js stays free of os/process imports and safe to
 * bundle into the browser (see formatError's mode parameter below).
 */
function formatDebug(err, env) {
    const lines = [
        pc.bold(`❌ ${err.message}`),
        `Code: ${err.code}`,
        `Category: ${err.category || "UNKNOWN"}`,
        `Time: ${new Date().toISOString()}`,
        "",
    ]
    if (err.cause) {
        lines.push(...formatCauseChain(err.cause), "")
    } else if (err.details) {
        lines.push(`Problem: ${err.details}`, "")
    }
    if (err.suggestedAction) {
        lines.push("Solution:", `  ${err.suggestedAction}`, "")
    }
    if (err.docUrl) {
        lines.push(`Docs: ${err.docUrl}`, "")
    }
    if (env) {
        lines.push("Environment:")
        for (const [key, value] of Object.entries(env)) {
            lines.push(`  ${key}: ${value}`)
        }
        lines.push("")
    }
    lines.push("Stack trace:")
    const stack = err.cause?.stack || err.stack || "(no stack available)"
    lines.push(...stack.split("\n").map((l) => `  ${l}`))
    return box(lines)
}

/**
 * Format a CatalystError for terminal output. Foreign-wrapped errors always
 * show the original upstream message/code, never a paraphrase of it.
 *
 * `mode` is a parameter, not module-level state — WebBridge.js (browser) has
 * no process.argv/TTY and keeps calling formatError(err) unchanged, getting
 * "default". Node call sites resolve their own mode (see
 * scripts/scriptUtils.js#resolveOutputMode) and pass it through explicitly.
 *
 * `env` (debug mode only) is gathered by the caller, not here — keeps this
 * module free of os/process imports so it stays safe to bundle into the
 * browser regardless of which mode a Node caller happens to request.
 */
export function formatError(err, mode = "default", env) {
    if (mode === "debug") return formatDebug(err, env)
    if (mode === "verbose") return formatVerbose(err)
    return formatDefault(err)
}

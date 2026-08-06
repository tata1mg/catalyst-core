const pc = require("ansis")

const REPO_BLOB_BASE = "https://github.com/tata1mg/catalyst-core/blob/main/errors"

function docUrl(category, code) {
    return `${REPO_BLOB_BASE}/${category}/${code}.md`
}

const ERROR_CODES = {
    CCA_UPSTREAM_ERROR: "CCA-000",
    CCA_INVALID_NAME: "CCA-001",
    CCA_DIRECTORY_EXISTS: "CCA-002",
    CCA_INVALID_LANGUAGE_OPTION: "CCA-003",
    CCA_INVALID_STATE_MANAGEMENT_OPTION: "CCA-004",
    CCA_INVALID_YES_OPTION: "CCA-005",
    CCA_PACK_FAILED: "CCA-006",
    CCA_EXTRACTION_FAILED: "CCA-007",
    CCA_MCP_SETUP_FAILED: "CCA-008",
    CCA_GITIGNORE_EXISTS: "CCA-009",
}

// One entry per CCA-owned code, including the CCA-000 wrapper used by
// wrapForeignError. Foreign errors themselves are never reinterpreted —
// their original message/code always surfaces via `cause`.
const ERROR_DEFINITIONS = {
    [ERROR_CODES.CCA_UPSTREAM_ERROR]: {
        category: "CCA",
        defaultMessage: "An upstream command failed",
        defaultDetails:
            "This wraps an error from npm, tar, or another upstream tool invoked by create-catalyst-app. See the printed upstream message for the actual cause.",
        recoverable: true,
        suggestedAction: "Read the upstream error message printed above and fix the underlying issue.",
    },
    [ERROR_CODES.CCA_INVALID_NAME]: {
        category: "CCA",
        defaultMessage: "Invalid project name",
        defaultDetails: "The project name is not a valid npm package name.",
        recoverable: true,
        suggestedAction: "Choose a project name that is a valid npm package name and try again.",
    },
    [ERROR_CODES.CCA_DIRECTORY_EXISTS]: {
        category: "CCA",
        defaultMessage: "Target directory already exists",
        defaultDetails: "A file or directory with the project name already exists in the current directory.",
        recoverable: true,
        suggestedAction: "Choose a different project name, or remove/rename the existing directory.",
    },
    [ERROR_CODES.CCA_INVALID_LANGUAGE_OPTION]: {
        category: "CCA",
        defaultMessage: "Invalid language option",
        defaultDetails: 'The --lang option must be "js" or "ts".',
        recoverable: true,
        suggestedAction: 'Pass --lang js or --lang ts.',
    },
    [ERROR_CODES.CCA_INVALID_STATE_MANAGEMENT_OPTION]: {
        category: "CCA",
        defaultMessage: "Invalid state management option",
        defaultDetails: 'The --state-management option must be "rtk", "redux", or "none".',
        recoverable: true,
        suggestedAction: "Pass a supported --state-management value.",
    },
    [ERROR_CODES.CCA_INVALID_YES_OPTION]: {
        category: "CCA",
        defaultMessage: "Invalid --yes option",
        defaultDetails: "The -y/--yes flag does not accept a non-boolean value.",
        recoverable: true,
        suggestedAction: "Use -y or --yes with no value to accept defaults.",
    },
    [ERROR_CODES.CCA_PACK_FAILED]: {
        category: "CCA",
        defaultMessage: "Failed to pack create-catalyst-app",
        defaultDetails: "npm pack could not produce the tarball used to scaffold the new project.",
        recoverable: true,
        suggestedAction: "Check your npm registry access/network connection and try again.",
    },
    [ERROR_CODES.CCA_EXTRACTION_FAILED]: {
        category: "CCA",
        defaultMessage: "Failed to extract template files",
        defaultDetails: "The packed tarball could not be extracted into the new project directory.",
        recoverable: true,
        suggestedAction: "Ensure the target directory is writable and try again.",
    },
    [ERROR_CODES.CCA_MCP_SETUP_FAILED]: {
        category: "CCA",
        defaultMessage: "MCP server setup failed",
        defaultDetails: "Downloading, installing, or configuring the MCP server failed.",
        recoverable: true,
        suggestedAction: "Check your network connection and re-run `catalyst-mcp` inside the project.",
    },
    [ERROR_CODES.CCA_GITIGNORE_EXISTS]: {
        category: "CCA",
        defaultMessage: ".gitignore already exists",
        defaultDetails: "The scaffolded project already contains a .gitignore file.",
        recoverable: true,
        suggestedAction: "Remove or rename the existing .gitignore before running again, or ignore this warning.",
    },
}

function getDefinition(code) {
    return ERROR_DEFINITIONS[code] || ERROR_DEFINITIONS[ERROR_CODES.CCA_UPSTREAM_ERROR]
}

function getDocUrl(code) {
    const def = ERROR_DEFINITIONS[code]
    if (!def) return docUrl(getDefinition(code).category, ERROR_CODES.CCA_UPSTREAM_ERROR)
    return docUrl(def.category, code)
}

class CCAError extends Error {
    constructor(code, { message, details, recoverable, suggestedAction, category, docUrl, cause } = {}) {
        super(message)
        this.name = "CCAError"
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
 * Create a CCAError for a code we own, using the registry defaults
 * unless overridden.
 */
function createError(code, overrides = {}) {
    const def = getDefinition(code)
    return new CCAError(code, {
        category: def.category,
        message: overrides.message || def.defaultMessage,
        details: overrides.details || def.defaultDetails,
        recoverable: overrides.recoverable ?? def.recoverable,
        suggestedAction: overrides.suggestedAction || def.suggestedAction,
        docUrl: getDocUrl(code),
        cause: overrides.cause,
    })
}

/**
 * Wrap a foreign error (npm/tar/git/network) that already carries its own
 * message. We do not replace or reinterpret it — we attach the generic
 * CCA-000 wrapper code and preserve the original as `cause`, so the
 * upstream message is always what gets shown to the user.
 */
function wrapForeignError(err) {
    const hasNamedCode = err && typeof err.code === "string"
    const upstreamCode = hasNamedCode ? ` ${err.code}` : ""
    return createError(ERROR_CODES.CCA_UPSTREAM_ERROR, {
        message: `An upstream command failed (upstream:${upstreamCode})`,
        cause: err,
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
 * Verbose output: boxed per RFC #155 §3.2 — code, category, timestamp,
 * problem, suggested action, docs link. Mirrors catalyst-core's
 * errors/index.js#formatVerbose (kept as a separate CJS implementation
 * since this package can't depend on catalyst-core's ESM module).
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
 * info. Mirrors catalyst-core's errors/index.js#formatDebug.
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
    const stack = (err.cause && err.cause.stack) || err.stack || "(no stack available)"
    lines.push(...stack.split("\n").map((l) => `  ${l}`))
    return box(lines)
}

/**
 * Format a CCAError for terminal output. Foreign-wrapped errors always show
 * the original upstream message/code, never a paraphrase of it.
 *
 * `mode` mirrors catalyst-core's formatError(err, mode, env) signature —
 * defaults to "default" so existing single-arg call sites are unaffected.
 */
function formatError(err, mode = "default", env) {
    if (mode === "debug") return formatDebug(err, env)
    if (mode === "verbose") return formatVerbose(err)
    return formatDefault(err)
}

/**
 * Resolve output mode from CLI args, mirroring catalyst-core's
 * scripts/scriptUtils.js#resolveOutputMode (bare --verbose/--debug flags,
 * not key=value pairs).
 */
function resolveOutputMode(argv) {
    const args = argv || process.argv
    if (args.includes("--debug")) return "debug"
    if (args.includes("--verbose")) return "verbose"
    return "default"
}

/**
 * Environment info for debug-mode output: CCA's own installed version, Node
 * version, and platform. Mirrors catalyst-core's scriptUtils.js#getDebugEnvInfo.
 */
function getDebugEnvInfo() {
    let ccaVersion = "unknown"
    try {
        ccaVersion = require("../package.json").version
    } catch {
        // package.json not resolvable — leave as "unknown"
    }
    return {
        node: process.version,
        platform: process.platform,
        createCatalystApp: ccaVersion,
    }
}

module.exports = {
    ERROR_CODES,
    ERROR_DEFINITIONS,
    CCAError,
    createError,
    wrapForeignError,
    formatError,
    resolveOutputMode,
    getDebugEnvInfo,
    getDocUrl,
}

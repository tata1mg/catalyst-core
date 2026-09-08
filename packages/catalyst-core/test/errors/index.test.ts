import { describe, it, expect } from "vitest"
import {
    ERROR_CODES,
    CatalystError,
    createError,
    wrapForeignError,
    wrapSSRError,
    wrapProviderError,
    formatError,
} from "../../src/errors/index.js"

// Framework-level (Tier 1) behavioral contract tests for errors/index.js —
// the "external contributor can't quietly change core behavior" lock. These
// fail the moment formatting/wrapping semantics drift from what's documented
// here, independent of the registry's actual content (see registry.test.js
// for that).

describe("createError()", () => {
    it("uses registry defaults when no overrides are given", () => {
        const err = createError(ERROR_CODES.PREFLIGHT_CONFIG_MISSING)
        expect(err).toBeInstanceOf(CatalystError)
        expect(err.code).toBe(ERROR_CODES.PREFLIGHT_CONFIG_MISSING)
        expect(err.category).toBe("PREFLIGHT")
        expect(err.message).toBe("config not found in config folder")
        expect(err.details).toBe("A config object must be exported from the config folder in your project root.")
        expect(err.suggestedAction).toContain("config/config.json")
        expect(err.docUrl).toBe("https://github.com/tata1mg/catalyst-core/blob/main/errors/PREFLIGHT/PREFLIGHT-001.md")
        expect(err.cause).toBeUndefined()
    })

    it("overrides message/details/suggestedAction when provided", () => {
        const err = createError(ERROR_CODES.PREFLIGHT_CONFIG_KEY_MISSING, {
            details: "NODE_SERVER_PORT key not found inside config.json",
        })
        expect(err.details).toBe("NODE_SERVER_PORT key not found inside config.json")
        // message/suggestedAction fall back to the registry default when not overridden
        expect(err.message).toBe("required key missing inside config.json")
    })

    it("attaches cause only when explicitly provided (not even as undefined-valued own property)", () => {
        const withoutCause = createError(ERROR_CODES.PREFLIGHT_CONFIG_MISSING)
        expect("cause" in withoutCause).toBe(false)

        const original = new Error("boom")
        const withCause = createError(ERROR_CODES.PREFLIGHT_CONFIG_MISSING, { cause: original })
        expect(withCause.cause).toBe(original)
    })

    it("falls back to the UNKNOWN-category generic definition for an unrecognized code", () => {
        const err = createError("NOT-A-REAL-CODE")
        expect(err.category).toBe("UNKNOWN")
        expect(err.code).toBe("NOT-A-REAL-CODE")
    })

    it("sets name to CatalystError and is a real Error instance", () => {
        const err = createError(ERROR_CODES.PREFLIGHT_CONFIG_MISSING)
        expect(err.name).toBe("CatalystError")
        expect(err).toBeInstanceOf(Error)
    })
})

describe("wrapForeignError()", () => {
    it("maps BUNDLE/IOS/ANDROID stages to their per-stage wrapper code", () => {
        expect(wrapForeignError("BUNDLE", new Error()).code).toBe(ERROR_CODES.BUNDLE_UPSTREAM_ERROR)
        expect(wrapForeignError("IOS", new Error()).code).toBe(ERROR_CODES.IOS_UPSTREAM_ERROR)
        expect(wrapForeignError("ANDROID", new Error()).code).toBe(ERROR_CODES.ANDROID_UPSTREAM_ERROR)
    })

    it("throws on an unknown stage rather than silently producing a bad code", () => {
        expect(() => wrapForeignError("NOT_A_STAGE", new Error())).toThrow(/unknown stage/)
    })

    it("preserves the original error as cause, never reinterpreting its message", () => {
        const original = new Error("EACCES: permission denied")
        const wrapped = wrapForeignError("BUNDLE", original)
        expect(wrapped.cause).toBe(original)
        expect(wrapped.message).not.toBe(original.message)
    })

    it("shows the upstream named error code when present (e.g. Rollup's PLUGIN_LOAD_ERROR)", () => {
        // .code isn't part of the standard Error interface — it's a Node
        // convention (see NodeJS.ErrnoException) that upstream build tools
        // like Rollup also follow for their own error codes.
        const original: NodeJS.ErrnoException = new Error("failed to load")
        original.code = "PLUGIN_LOAD_ERROR"
        const wrapped = wrapForeignError("BUNDLE", original)
        expect(wrapped.message).toContain("PLUGIN_LOAD_ERROR")
    })

    it("does NOT show a bare numeric process exit code as if it were a named upstream code", () => {
        const original = new Error("process exited") as Error & { code: number }
        original.code = 1 // numeric, e.g. a spawned child's exit status — not a named identifier
        const wrapped = wrapForeignError("BUNDLE", original)
        expect(wrapped.message).not.toContain("1")
        expect(wrapped.message).toBe("Build failed (upstream: Vite/Rollup)")
    })

    it("handles an error with no .code at all", () => {
        const wrapped = wrapForeignError("IOS", new Error("generic failure"))
        expect(wrapped.message).toBe("Build failed (upstream: Xcode/CocoaPods)")
    })
})

describe("wrapSSRError()", () => {
    it("maps each SSR stage to its RUNTIME-WEB code", () => {
        expect(wrapSSRError("RENDER", new Error()).code).toBe(ERROR_CODES.RUNTIME_WEB_RENDER_FAILED)
        expect(wrapSSRError("FETCHER", new Error()).code).toBe(ERROR_CODES.RUNTIME_WEB_FETCHER_FAILED)
        expect(wrapSSRError("SERVER_SIDE_FUNCTION", new Error()).code).toBe(ERROR_CODES.RUNTIME_WEB_SERVER_SIDE_FUNCTION_FAILED)
        expect(wrapSSRError("REQUEST_HANDLING", new Error()).code).toBe(ERROR_CODES.RUNTIME_WEB_REQUEST_HANDLING_FAILED)
    })

    it("throws on an unknown stage rather than silently producing a bad code", () => {
        expect(() => wrapSSRError("NOT_A_STAGE", new Error())).toThrow(/unknown stage/)
    })

    it("preserves the original error verbatim as cause — never reinterprets it (could be app code, a dep, or catalyst-core itself)", () => {
        const original = new TypeError("Cannot read properties of undefined")
        const wrapped = wrapSSRError("FETCHER", original)
        expect(wrapped.cause).toBe(original)
    })
})

describe("wrapProviderError()", () => {
    it("constructs a cause carrying provider/status, and includes both in the message", () => {
        const wrapped = wrapProviderError("openai", 429, '{"error":"rate limited"}')
        expect(wrapped.code).toBe(ERROR_CODES.AI_UPSTREAM_ERROR)
        expect(wrapped.cause.provider).toBe("openai")
        expect(wrapped.cause.status).toBe(429)
        expect(wrapped.cause.message).toContain("rate limited")
        expect(wrapped.message).toContain("openai")
        expect(wrapped.message).toContain("429")
    })
})

describe("formatError()", () => {
    const err = createError(ERROR_CODES.PREFLIGHT_CONFIG_MISSING)
    const errWithCause = createError(ERROR_CODES.PREFLIGHT_CONFIG_MISSING, { cause: new Error("ENOENT: no such file") })

    it("defaults to \"default\" mode when no mode is passed (WebBridge.js's browser call sites rely on this)", () => {
        expect(formatError(err)).toBe(formatError(err, "default"))
    })

    it("default mode: single-line-per-field, shows cause message when present", () => {
        const output = formatError(errWithCause, "default")
        expect(output).toContain(`[${ERROR_CODES.PREFLIGHT_CONFIG_MISSING}]`)
        expect(output).toContain("ENOENT: no such file")
        expect(output).toContain("Suggested action:")
        expect(output).toContain("Docs:")
    })

    it("default mode: falls back to details when there is no cause", () => {
        const output = formatError(err, "default")
        expect(output).toContain(err.details)
    })

    it("verbose mode: includes code/category/problem/solution/docs, boxed", () => {
        const output = formatError(errWithCause, "verbose")
        expect(output).toContain(`Code: ${ERROR_CODES.PREFLIGHT_CONFIG_MISSING}`)
        expect(output).toContain("Category: PREFLIGHT")
        expect(output).toContain("Problem: ENOENT: no such file")
        expect(output).toContain("Solution:")
        expect(output).toContain("Docs:")
        expect(output).toContain("┌")
        expect(output).toContain("└")
    })

    it("verbose mode: category falls back to UNKNOWN when the error has none", () => {
        const bareErr = new CatalystError("SOME-CODE", { message: "x" })
        const output = formatError(bareErr, "verbose")
        expect(output).toContain("Category: UNKNOWN")
    })

    it("debug mode: includes the full cause chain and a stack trace", () => {
        const inner = new Error("root cause")
        const middle = new Error("middle layer")
        middle.cause = inner
        const wrapped = createError(ERROR_CODES.PREFLIGHT_CONFIG_MISSING, { cause: middle })

        const output = formatError(wrapped, "debug", { node: "v20.4.0", platform: "darwin" })
        expect(output).toContain("Caused by: middle layer")
        expect(output).toContain("  Caused by: root cause")
        expect(output).toContain("Environment:")
        expect(output).toContain("node: v20.4.0")
        expect(output).toContain("Stack trace:")
    })

    it("debug mode: omits the Environment section when no env is passed", () => {
        const output = formatError(err, "debug")
        expect(output).not.toContain("Environment:")
    })

    it("debug mode: uses the cause's stack when a cause is present, not the wrapper's own stack", () => {
        const original = new Error("original failure")
        const wrapped = createError(ERROR_CODES.PREFLIGHT_CONFIG_MISSING, { cause: original })
        const output = formatError(wrapped, "debug")
        // The wrapper error's own stack frame (this test file) would appear either way,
        // but the cause's message must be the one whose stack header shows up.
        expect(output).toContain("original failure")
    })
})

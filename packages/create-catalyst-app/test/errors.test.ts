// describe/it/expect come from vitest's `globals: true` config (see
// vitest.config.mjs) — vitest's own exports can't be require()'d, only
// import'd, so globals injects them instead.
//
// errors.cjs itself is loaded via require() rather than import — it's a
// CommonJS module and this keeps the runtime behavior identical to how
// every other require("./errors.cjs") call site in this package loads it.
// require(...) is untyped by default, and errors.cjs stays plain JS until a
// future source conversion (see issue #420), so we annotate it against the
// hand-written declaration in ../scripts/errors.d.cts rather than let every
// usage below infer as `unknown`.
const cca: typeof import("../scripts/errors.cjs") = require("../scripts/errors.cjs")

// Framework-level (Tier 1) contract + parity tests for the CCA error mirror
// (packages/create-catalyst-app/scripts/errors.cjs). This is a standalone
// CJS module — CCA packs/extracts itself before catalyst-core is ever
// installed, so it can't import catalyst-core/errors and instead re-implements
// the same shape/conventions by hand (see decision #6 in the story-6
// checkpoint). These tests assert it stays structurally in sync with those
// conventions, not that it shares code with catalyst-core (see issue #340/#411).

const CODE_FORMAT_RE = /^[A-Z][A-Z-]*-\d{3}$/

describe("CCA ERROR_CODES / ERROR_DEFINITIONS shape invariants (mirrors registry.test.js's rules)", () => {
    const { ERROR_CODES, ERROR_DEFINITIONS } = cca
    const codeEntries = Object.entries(ERROR_CODES)
    const codeValues = Object.values(ERROR_CODES)

    it("has at least one code defined", () => {
        expect(codeEntries.length).toBeGreaterThan(0)
    })

    it("every ERROR_CODES value has a matching ERROR_DEFINITIONS entry", () => {
        const missing = codeValues.filter((code) => !(code in ERROR_DEFINITIONS))
        expect(missing).toEqual([])
    })

    it("code values are unique", () => {
        const seen = new Set()
        const duplicates = []
        for (const code of codeValues) {
            if (seen.has(code)) duplicates.push(code)
            seen.add(code)
        }
        expect(duplicates).toEqual([])
    })

    it("every code matches the CATEGORY-NNN format", () => {
        const malformed = codeValues.filter((code) => !CODE_FORMAT_RE.test(code))
        expect(malformed).toEqual([])
    })

    it("every code's category prefix matches its definition's category field", () => {
        const mismatches = []
        for (const [key, code] of codeEntries) {
            const def = ERROR_DEFINITIONS[code]
            if (!def) continue
            const prefix = code.slice(0, code.lastIndexOf("-"))
            if (prefix !== def.category) mismatches.push(`${key} (${code}): prefix "${prefix}" !== category "${def.category}"`)
        }
        expect(mismatches).toEqual([])
    })

    it("every definition has all required fields, non-empty — same required-field set as the core registry", () => {
        const REQUIRED_FIELDS = ["category", "defaultMessage", "defaultDetails", "suggestedAction"] as const
        const problems: string[] = []
        for (const [code, def] of Object.entries(ERROR_DEFINITIONS)) {
            for (const field of REQUIRED_FIELDS) {
                const value = def[field]
                if (typeof value !== "string" || value.trim().length === 0) {
                    problems.push(`${code}: missing or empty "${field}"`)
                }
            }
        }
        expect(problems).toEqual([])
    })

    it("no definition carries a `recoverable` field (dropped repo-wide, including this mirror)", () => {
        const withRecoverable = Object.entries(ERROR_DEFINITIONS)
            .filter(([, def]) => "recoverable" in def)
            .map(([code]) => code)
        expect(withRecoverable).toEqual([])
    })

    it("owns exactly one category (CCA) — doesn't collide with any core-owned category", () => {
        const CORE_CATEGORIES = new Set(["PREFLIGHT", "PROCESS", "BUNDLE", "IOS", "ANDROID", "RUNTIME-NATIVE", "AI", "RUNTIME-WEB"])
        const ccaCategories = new Set(Object.values(ERROR_DEFINITIONS).map((d) => d.category))
        const collisions = [...ccaCategories].filter((c) => CORE_CATEGORIES.has(c))
        expect(collisions).toEqual([])
        expect(ccaCategories).toEqual(new Set(["CCA"]))
    })
})

describe("createError() / getDefinition() — same override + fallback contract as catalyst-core's version", () => {
    it("uses registry defaults when no overrides are given", () => {
        const err = cca.createError(cca.ERROR_CODES.CCA_DIRECTORY_EXISTS)
        expect(err).toBeInstanceOf(cca.CCAError)
        expect(err.code).toBe("CCA-002")
        expect(err.category).toBe("CCA")
        expect(err.message).toBe("Target directory already exists")
    })

    it("overrides details while falling back to the default message", () => {
        const err = cca.createError(cca.ERROR_CODES.CCA_UPSTREAM_ERROR, { details: "npm pack exited 1" })
        expect(err.details).toBe("npm pack exited 1")
        expect(err.message).toBe("An upstream command failed")
    })

    it("falls back to the CCA_UPSTREAM_ERROR definition for an unrecognized code (same shape as core's UNKNOWN fallback, different concrete fallback)", () => {
        const err = cca.createError("NOT-A-REAL-CODE")
        expect(err.category).toBe("CCA")
        expect(err.message).toBe("An upstream command failed")
    })

    it("attaches cause only when explicitly provided", () => {
        const withoutCause = cca.createError(cca.ERROR_CODES.CCA_DIRECTORY_EXISTS)
        expect("cause" in withoutCause).toBe(false)
        const original = new Error("EEXIST")
        const withCause = cca.createError(cca.ERROR_CODES.CCA_DIRECTORY_EXISTS, { cause: original })
        expect(withCause.cause).toBe(original)
    })
})

describe("wrapForeignError() — same never-reinterpret contract as catalyst-core's wrapForeignError", () => {
    it("always uses the CCA-000 wrapper code and preserves the original as cause", () => {
        const original = new Error("ENOENT: no such file or directory")
        const wrapped = cca.wrapForeignError(original)
        expect(wrapped.code).toBe(cca.ERROR_CODES.CCA_UPSTREAM_ERROR)
        expect(wrapped.cause).toBe(original)
    })

    it("shows the upstream named code when present", () => {
        // .code isn't part of the standard Error interface — it's a Node
        // convention (see NodeJS.ErrnoException).
        const original: NodeJS.ErrnoException = new Error("failed")
        original.code = "ENOENT"
        const wrapped = cca.wrapForeignError(original)
        expect(wrapped.message).toContain("ENOENT")
    })

    it("omits the \"(upstream: ...)\" suffix entirely when there is no named code, rather than leaving it dangling", () => {
        const wrapped = cca.wrapForeignError(new Error("generic failure"))
        expect(wrapped.message).toBe("An upstream command failed")
    })

    it("omits the suffix for an empty or whitespace-only .code too — still typeof \"string\", but not a real name", () => {
        const emptyCode: NodeJS.ErrnoException = new Error("failed")
        emptyCode.code = ""
        expect(cca.wrapForeignError(emptyCode).message).toBe("An upstream command failed")

        const blankCode: NodeJS.ErrnoException = new Error("failed")
        blankCode.code = "   "
        expect(cca.wrapForeignError(blankCode).message).toBe("An upstream command failed")
    })

    it("trims surrounding whitespace off a real named code", () => {
        const padded: NodeJS.ErrnoException = new Error("failed")
        padded.code = "  ENOENT  "
        expect(cca.wrapForeignError(padded).message).toBe("An upstream command failed (upstream: ENOENT)")
    })
})

describe("getDocUrl() — same repo-blob URL convention as catalyst-core's getDocUrl", () => {
    it("builds a URL under errors/<category>/<code>.md for a known code", () => {
        expect(cca.getDocUrl(cca.ERROR_CODES.CCA_INVALID_NAME)).toBe(
            "https://github.com/tata1mg/catalyst-core/blob/main/errors/CCA/CCA-001.md"
        )
    })

    it("falls back to the CCA-000 doc URL for an unrecognized code, rather than a broken link", () => {
        expect(cca.getDocUrl("NOT-A-REAL-CODE")).toBe(
            "https://github.com/tata1mg/catalyst-core/blob/main/errors/CCA/CCA-000.md"
        )
    })
})

describe("formatError() — same 3-mode contract (default/verbose/debug) as catalyst-core's formatError", () => {
    it("defaults to \"default\" mode", () => {
        const err = cca.createError(cca.ERROR_CODES.CCA_DIRECTORY_EXISTS)
        expect(cca.formatError(err)).toBe(cca.formatError(err, "default"))
    })

    it("default mode includes code, message, and suggested action", () => {
        const err = cca.createError(cca.ERROR_CODES.CCA_DIRECTORY_EXISTS)
        const output = cca.formatError(err, "default")
        expect(output).toContain("[CCA-002]")
        expect(output).toContain("Suggested action:")
    })

    it("verbose mode is boxed and includes Code/Category/Solution/Docs", () => {
        const err = cca.createError(cca.ERROR_CODES.CCA_DIRECTORY_EXISTS)
        const output = cca.formatError(err, "verbose")
        expect(output).toContain("Code: CCA-002")
        expect(output).toContain("Category: CCA")
        expect(output).toContain("Solution:")
        expect(output).toContain("┌")
    })

    it("debug mode includes the cause chain and a Stack trace section", () => {
        const original = new Error("root cause")
        const err = cca.createError(cca.ERROR_CODES.CCA_UPSTREAM_ERROR, { cause: original })
        const output = cca.formatError(err, "debug", { node: "v20.4.0" })
        expect(output).toContain("Caused by: root cause")
        expect(output).toContain("Environment:")
        expect(output).toContain("Stack trace:")
    })
})

describe("resolveOutputMode() — same bare-flag contract as scriptUtils.js#resolveOutputMode", () => {
    it("detects --debug and --verbose from an argv array", () => {
        expect(cca.resolveOutputMode(["node", "cli.js", "--debug"])).toBe("debug")
        expect(cca.resolveOutputMode(["node", "cli.js", "--verbose"])).toBe("verbose")
        expect(cca.resolveOutputMode(["node", "cli.js"])).toBe("default")
    })

    it("--debug takes priority when both flags are present", () => {
        expect(cca.resolveOutputMode(["--verbose", "--debug"])).toBe("debug")
    })
})

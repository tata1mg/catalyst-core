import { describe, it, expect } from "vitest"
import { ERROR_CODES, ERROR_DEFINITIONS, getDefinition, getDocUrl } from "../../src/errors/registry.js"

// Framework-level (Tier 1) contract tests for the error registry itself —
// not testing any consumer of it. These exist so a malformed new error code
// fails CI with no human review needed (see issue #340/#411).

const CODE_FORMAT_RE = /^[A-Z][A-Z-]*-\d{3}$/

describe("ERROR_CODES / ERROR_DEFINITIONS shape invariants", () => {
    const codeEntries = Object.entries(ERROR_CODES)
    const codeValues = Object.values(ERROR_CODES)

    it("has at least one code defined", () => {
        expect(codeEntries.length).toBeGreaterThan(0)
    })

    it("every ERROR_CODES value has a matching ERROR_DEFINITIONS entry", () => {
        const missing = codeValues.filter((code) => !(code in ERROR_DEFINITIONS))
        expect(missing).toEqual([])
    })

    it("every ERROR_DEFINITIONS key corresponds to a declared ERROR_CODES value", () => {
        const definedCodes = Object.keys(ERROR_DEFINITIONS)
        const orphaned = definedCodes.filter((code) => !codeValues.includes(code))
        expect(orphaned).toEqual([])
    })

    it("code values are unique — no two ERROR_CODES keys share a code string", () => {
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
            if (!def) continue // covered by the "matching entry" test above
            const prefix = code.slice(0, code.lastIndexOf("-"))
            if (prefix !== def.category) {
                mismatches.push(`${key} (${code}): prefix "${prefix}" !== category "${def.category}"`)
            }
        }
        expect(mismatches).toEqual([])
    })

    it("every definition has all required fields, non-empty", () => {
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

    it("no definition carries a `recoverable` field (dropped per 18530a89 — never reinstate)", () => {
        const withRecoverable = Object.entries(ERROR_DEFINITIONS)
            .filter(([, def]) => "recoverable" in def)
            .map(([code]) => code)
        expect(withRecoverable).toEqual([])
    })
})

describe("getDefinition()", () => {
    it("returns the real definition for a known code", () => {
        const def = getDefinition(ERROR_CODES.PREFLIGHT_CONFIG_MISSING)
        expect(def.category).toBe("PREFLIGHT")
        expect(def.defaultMessage).toBe("config not found in config folder")
    })

    it("falls back to a generic definition for an unrecognized code", () => {
        const def = getDefinition("NOT-A-REAL-CODE")
        expect(def).toBeDefined()
        expect(def.defaultMessage).toBeTruthy()
        expect(def.suggestedAction).toBeTruthy()
    })

    it("never mislabels the fallback as RUNTIME-NATIVE — category is always UNKNOWN", () => {
        const def = getDefinition("NOT-A-REAL-CODE")
        expect(def.category).toBe("UNKNOWN")
    })
})

describe("getDocUrl()", () => {
    it("builds a repo-blob URL under the code's own category for a known code", () => {
        const url = getDocUrl(ERROR_CODES.AI_DISABLED)
        expect(url).toBe("https://github.com/tata1mg/catalyst-core/blob/main/errors/AI/AI-001.md")
    })

    it("returns null for an unrecognized code rather than a broken URL", () => {
        expect(getDocUrl("NOT-A-REAL-CODE")).toBeNull()
    })
})

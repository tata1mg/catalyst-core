// describe/it/expect come from vitest's `globals: true` config (see
// vitest.config.mjs) — vitest's own exports can't be require()'d from a
// .cjs file, only import'd, so globals keeps this file plain CommonJS
// throughout, matching errors.js's own module system.
const fs = require("fs")
const path = require("path")
const { init, handle_explain_error } = require("../tools/errors.js")

// Framework-level (Tier 1) contract tests for the explain_error MCP tool —
// see issue #340/#411. Covers both real load paths (packaged dist/ copy and
// the monorepo-root fallback) rather than mocking fs, since the whole point
// of this module is "does the real file get found on disk."
//
// CAUTION: these tests move/restore errors/index.json and
// dist/errors-index.json on real disk (with try/finally restoration). This
// is safe run standalone or sequentially after other suites (see the root
// test:unit script's `&&` chaining) but would race against any other suite
// reading those same files concurrently in the same checkout — don't
// parallelize this file's run against docsDrift.test.js or generateDocs.js.

const PACKAGED_INDEX_PATH = path.join(__dirname, "..", "..", "dist", "errors-index.json")
const MONOREPO_INDEX_PATH = path.join(__dirname, "..", "..", "..", "..", "errors", "index.json")

function packagedIndexExists() {
    return fs.existsSync(PACKAGED_INDEX_PATH)
}

describe("init() + handle_explain_error() — packaged path (dist/errors-index.json)", () => {
    beforeAll(() => {
        // This test only means something when the packaged copy actually
        // exists — it's a build artifact (see mcp_v2/scripts/copyErrorsIndex.cjs
        // + the "prepare" script), not guaranteed present in every checkout.
        // Skip rather than false-fail if `npm run prepare` hasn't run yet.
        if (!packagedIndexExists()) return
        init()
    })

    it.runIf(packagedIndexExists())("finds a known code via the packaged path and reports it as catalyst-owned", () => {
        const result = handle_explain_error({ code: "PREFLIGHT-001" })
        expect(result.is_catalyst_owned).toBe(true)
        expect(result.category).toBe("PREFLIGHT")
        expect(result.message).toBeTruthy()
        expect(result.docUrl).toContain("PREFLIGHT-001.md")
    })
})

describe("init() + handle_explain_error() — monorepo-root fallback (errors/index.json)", () => {
    let packagedBackup

    beforeAll(() => {
        // Force the fallback path: temporarily move the packaged copy aside
        // (if present) so init() must fall through to MONOREPO_INDEX_PATH.
        if (fs.existsSync(PACKAGED_INDEX_PATH)) {
            packagedBackup = fs.readFileSync(PACKAGED_INDEX_PATH)
            fs.unlinkSync(PACKAGED_INDEX_PATH)
        }
        init()
    })

    afterAll(() => {
        if (packagedBackup) fs.writeFileSync(PACKAGED_INDEX_PATH, packagedBackup)
    })

    it("finds a known code via the monorepo-root fallback", () => {
        const result = handle_explain_error({ code: "PREFLIGHT-001" })
        expect(result.is_catalyst_owned).toBe(true)
        expect(result.category).toBe("PREFLIGHT")
    })

    it("reports a non-catalyst code as not owned, with a helpful note", () => {
        const result = handle_explain_error({ code: "SOME-UPSTREAM-CODE" })
        expect(result.is_catalyst_owned).toBe(false)
        expect(result.note).toContain("not a catalyst-owned error code")
    })

    it("requires code and returns a clear error when it's missing", () => {
        const result = handle_explain_error({})
        expect(result.error).toMatch(/code is required/)
    })

    it("uses an own-property lookup — a code matching an inherited Object.prototype member is never misreported as catalyst-owned", () => {
        expect(handle_explain_error({ code: "toString" }).is_catalyst_owned).toBe(false)
        expect(handle_explain_error({ code: "constructor" }).is_catalyst_owned).toBe(false)
        expect(handle_explain_error({ code: "hasOwnProperty" }).is_catalyst_owned).toBe(false)
    })
})

describe("init() — neither path resolvable", () => {
    let packagedBackup

    beforeAll(() => {
        if (fs.existsSync(PACKAGED_INDEX_PATH)) {
            packagedBackup = fs.readFileSync(PACKAGED_INDEX_PATH)
            fs.unlinkSync(PACKAGED_INDEX_PATH)
        }
    })

    afterAll(() => {
        if (packagedBackup) fs.writeFileSync(PACKAGED_INDEX_PATH, packagedBackup)
        // Restore real state for any test file that runs after this one in
        // the same process (vitest may share workers across files).
        init()
    })

    it("degrades gracefully — reports a load error instead of throwing, when errors/index.json genuinely can't be read", () => {
        // Simulate by pointing init() at a broken state: rename the real
        // monorepo index aside temporarily.
        const monorepoBackup = fs.readFileSync(MONOREPO_INDEX_PATH)
        fs.unlinkSync(MONOREPO_INDEX_PATH)
        try {
            init()
            const result = handle_explain_error({ code: "PREFLIGHT-001" })
            expect(result.error).toMatch(/Could not load errors\/index\.json/)
        } finally {
            fs.writeFileSync(MONOREPO_INDEX_PATH, monorepoBackup)
        }
    })
})

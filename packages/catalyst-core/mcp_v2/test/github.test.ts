// describe/it/expect come from vitest's `globals: true` config (see
// vitest.config.mjs). tools/github.js is CommonJS, loaded via require() and
// typed against the hand-written declaration in ../tools/github.d.ts (that
// file stays plain JS for now — same rationale as errors.js / issue #420).
const fs = require("fs")
const path = require("path")
const YAML = require("yaml")
const github: typeof import("../tools/github.js") = require("../tools/github.js")

// Drift guard: the MCP carries a code-embedded copy of the repo's issue and
// PR templates (ISSUE_TEMPLATES / PR_TEMPLATES in tools/github.js) so an
// agent raising an issue or PR through the MCP produces the same structure
// as one raised through the GitHub UI. This suite asserts the two copies
// can't diverge — the same stance as test/errors.test.ts: check the real
// files on disk, don't mock fs.
//
// mcp_v2 lives four levels under the repo root
// (packages/catalyst-core/mcp_v2/test → repo root), matching
// MONOREPO_INDEX_PATH's resolution in errors.test.ts.
const ISSUE_TEMPLATE_DIR = path.join(__dirname, "..", "..", "..", "..", ".github", "ISSUE_TEMPLATE")
const PR_TEMPLATE_DIR = path.join(__dirname, "..", "..", "..", "..", ".github", "PULL_REQUEST_TEMPLATE")

function templatesOnDisk() {
    return fs.existsSync(ISSUE_TEMPLATE_DIR) && fs.existsSync(PR_TEMPLATE_DIR)
}

// The ordered `##` headings of a Markdown PR template, minus the shared
// footer checklist (which lives in PR_FOOTER_CHECKLIST, asserted separately).
function prTemplateSections(md: string): string[] {
    return [...md.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1])
}

// The ordered field labels of a GitHub issue form, minus `markdown` blocks
// (intro prose) and the `checkboxes` Preflight Checklist (form-only UX, not
// a content section the MCP renders).
function issueFormSections(form: { body?: Array<Record<string, any>> }): string[] {
    return (form.body || [])
        .filter((b) => b.type !== "markdown")
        .filter((b) => !(b.type === "checkboxes" && b.attributes?.label === "Preflight Checklist"))
        .map((b) => b.attributes.label)
}

describe.skipIf(!templatesOnDisk())("issue forms ↔ ISSUE_TEMPLATES", () => {
    for (const key of Object.keys(github.ISSUE_TEMPLATES)) {
        const tmpl = github.ISSUE_TEMPLATES[key]

        it(`${key}.yml exists and its label matches`, () => {
            const file = path.join(ISSUE_TEMPLATE_DIR, `${key}.yml`)
            expect(fs.existsSync(file)).toBe(true)
            const form = YAML.parse(fs.readFileSync(file, "utf8"))
            expect(form.labels).toContain(tmpl.label)
        })

        it(`${key}.yml body fields match ISSUE_TEMPLATES.${key}.sections in order`, () => {
            const form = YAML.parse(fs.readFileSync(path.join(ISSUE_TEMPLATE_DIR, `${key}.yml`), "utf8"))
            // "Preflight Checklist" may appear in tmpl.sections (bug) — the MCP
            // renders it there — but it's a checkboxes block in the form, so
            // compare against the form's non-preflight sections either way.
            const want = tmpl.sections.filter((s) => s !== "Preflight Checklist")
            expect(issueFormSections(form)).toEqual(want)
        })
    }

    it("config.yml disables blank issues", () => {
        const cfg = YAML.parse(fs.readFileSync(path.join(ISSUE_TEMPLATE_DIR, "config.yml"), "utf8"))
        expect(cfg.blank_issues_enabled).toBe(false)
    })

    it("every ISSUE_TEMPLATE/*.yml (except config) has a matching ISSUE_TEMPLATES key", () => {
        const files = fs
            .readdirSync(ISSUE_TEMPLATE_DIR)
            .filter((f: string) => f.endsWith(".yml") && f !== "config.yml")
            .map((f: string) => f.replace(/\.yml$/, ""))
        expect(files.sort()).toEqual(Object.keys(github.ISSUE_TEMPLATES).sort())
    })
})

describe.skipIf(!templatesOnDisk())("PR templates ↔ PR_TEMPLATES", () => {
    for (const key of Object.keys(github.PR_TEMPLATES) as Array<"fix" | "feature" | "chore">) {
        const tmpl = github.PR_TEMPLATES[key]

        it(`${key}.md exists and its ## headings match PR_TEMPLATES.${key}.sections in order`, () => {
            const file = path.join(PR_TEMPLATE_DIR, `${key}.md`)
            expect(fs.existsSync(file)).toBe(true)
            const md = fs.readFileSync(file, "utf8")
            expect(prTemplateSections(md)).toEqual(tmpl.sections)
        })

        it(`${key}.md ends with the shared footer checklist`, () => {
            const md = fs.readFileSync(path.join(PR_TEMPLATE_DIR, `${key}.md`), "utf8")
            for (const line of github.PR_FOOTER_CHECKLIST.split("\n")) {
                expect(md).toContain(line)
            }
        })
    }

    it("the default PULL_REQUEST_TEMPLATE.md carries the shared footer checklist", () => {
        const md = fs.readFileSync(path.join(PR_TEMPLATE_DIR, "..", "PULL_REQUEST_TEMPLATE.md"), "utf8")
        for (const line of github.PR_FOOTER_CHECKLIST.split("\n")) {
            expect(md).toContain(line)
        }
    })

    it("every PULL_REQUEST_TEMPLATE/*.md has a matching PR_TEMPLATES key", () => {
        const files = fs
            .readdirSync(PR_TEMPLATE_DIR)
            .filter((f: string) => f.endsWith(".md"))
            .map((f: string) => f.replace(/\.md$/, ""))
        expect(files.sort()).toEqual(Object.keys(github.PR_TEMPLATES).sort())
    })
})

describe("handle_create_github_pr() — dry run rendering", () => {
    beforeAll(() => github.init({ dir: process.cwd() }))

    it("renders a fix PR body in template section order with the footer", async () => {
        const res: any = await github.handle_create_github_pr({
            change_type: "fix",
            title: "fix: thing",
            root_cause: "the widget cache key collided",
            repro: "1. open two tabs",
            fix: "namespace the key",
            regression_test: "added cache-key.test.ts",
            head: "feature/x",
            base: "epic/329",
            dry_run: true,
        })
        expect(res.ok).toBe(true)
        expect(res.dry_run).toBe(true)
        expect(res.preview.change_type).toBe("fix")
        const headings = prTemplateSections(res.preview.body)
        expect(headings).toEqual(["Root cause", "Repro", "Fix", "Regression test", "Affected error codes"])
        expect(res.preview.body).toContain(github.PR_FOOTER_CHECKLIST.split("\n")[0])
    })

    it("infers change_type from the title when not given", async () => {
        const res: any = await github.handle_create_github_pr({
            title: "feat: add useTool hook",
            summary: "new imperative WebMCP hook",
            head: "feature/x",
            base: "main",
            dry_run: true,
        })
        expect(res.preview.change_type).toBe("feature")
    })

    it("prepends Closes #<n> when closes_issue is set", async () => {
        const res: any = await github.handle_create_github_pr({
            change_type: "chore",
            title: "chore: bump x",
            summary: "routine bump",
            closes_issue: 441,
            head: "feature/x",
            base: "main",
            dry_run: true,
        })
        expect(res.preview.body.startsWith("Closes #441")).toBe(true)
    })

    it("requires a title", async () => {
        const res: any = await github.handle_create_github_pr({ summary: "x" })
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/title is required/)
    })

    it("rejects head === base", async () => {
        const res: any = await github.handle_create_github_pr({
            title: "chore: x",
            summary: "x",
            head: "main",
            base: "main",
            dry_run: true,
        })
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/same branch/)
    })
})

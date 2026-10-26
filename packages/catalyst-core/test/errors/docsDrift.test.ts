import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { fileURLToPath } from "url"
import { generateDocs } from "../../src/errors/generateDocs.js"
import { ERROR_DEFINITIONS } from "../../src/errors/registry.js"

// Framework-level (Tier 1) contract test: catches the "edited registry.js
// without regenerating docs" or "hand-edited a generated .md directly"
// mistake. Regenerates into a scratch dir (never touches the committed
// errors/ tree) and diffs the core-owned slice against what's checked in.

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// test/errors -> repo root /errors (the committed output)
const COMMITTED_ERRORS_DIR = path.resolve(__dirname, "../../../../errors")

// Shape of one errors/index.json entry, as written by generateDocs.js.
// registry.js/generateDocs.js stay plain JS until #420's source conversion —
// this type exists only to give the test file real safety in the meantime.
interface IndexEntry {
    category: string
    message: string
    details: string
    suggestedAction: string
    docUrl: string
}

let scratchDir: string | undefined

afterEach(() => {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true })
    scratchDir = undefined
})

describe("generated error docs match committed output (docs-drift check)", () => {
    it("regenerating into a scratch dir produces byte-identical .md files for every core-owned code", () => {
        scratchDir = mkdtempSync(path.join(tmpdir(), "catalyst-core-docs-drift-"))
        generateDocs(scratchDir)

        const mismatches: string[] = []
        for (const [code, def] of Object.entries(ERROR_DEFINITIONS)) {
            const relPath = path.join(def.category, `${code}.md`)
            const committedPath = path.join(COMMITTED_ERRORS_DIR, relPath)
            const scratchPath = path.join(scratchDir, relPath)

            if (!existsSync(committedPath)) {
                mismatches.push(`${relPath}: missing from committed errors/ — run generateDocs.js and commit the output`)
                continue
            }
            const committed = readFileSync(committedPath, "utf8")
            const fresh = readFileSync(scratchPath, "utf8")
            if (committed !== fresh) {
                mismatches.push(`${relPath}: committed content differs from what generateDocs() produces today`)
            }
        }
        expect(mismatches).toEqual([])
    })

    it("committed index.json has an up-to-date entry for every core-owned code", () => {
        const indexPath = path.join(COMMITTED_ERRORS_DIR, "index.json")
        const committedIndex: Record<string, IndexEntry> = JSON.parse(readFileSync(indexPath, "utf8"))

        const mismatches: string[] = []
        for (const [code, def] of Object.entries(ERROR_DEFINITIONS)) {
            const entry = committedIndex[code]
            if (!entry) {
                mismatches.push(`${code}: missing from committed errors/index.json`)
                continue
            }
            if (entry.category !== def.category) mismatches.push(`${code}: index.json category "${entry.category}" !== registry "${def.category}"`)
            if (entry.message !== def.defaultMessage) mismatches.push(`${code}: index.json message drifted from registry defaultMessage`)
            if (entry.details !== def.defaultDetails) mismatches.push(`${code}: index.json details drifted from registry defaultDetails`)
            if (entry.suggestedAction !== def.suggestedAction) mismatches.push(`${code}: index.json suggestedAction drifted from registry`)
        }
        expect(mismatches).toEqual([])
    })

    it("committed index.json has no stale core-category entry for a code removed from the registry", () => {
        const indexPath = path.join(COMMITTED_ERRORS_DIR, "index.json")
        const committedIndex: Record<string, IndexEntry> = JSON.parse(readFileSync(indexPath, "utf8"))
        const ownedCategories = new Set(Object.values(ERROR_DEFINITIONS).map((d) => d.category))

        const stale: string[] = []
        for (const [code, entry] of Object.entries(committedIndex)) {
            if (ownedCategories.has(entry.category) && !(code in ERROR_DEFINITIONS)) {
                stale.push(`${code}: stale entry in errors/index.json — its category ("${entry.category}") is core-owned but this code no longer exists in the registry`)
            }
        }
        expect(stale).toEqual([])
    })

    it("committed errors/ tree has no stray core-category .md files not backed by a current registry entry", () => {
        const ownedCategories = new Set(Object.values(ERROR_DEFINITIONS).map((d) => d.category))
        const knownFiles = new Set(
            Object.entries(ERROR_DEFINITIONS).map(([code, def]) => path.join(def.category, `${code}.md`))
        )

        const stray: string[] = []
        for (const category of ownedCategories) {
            const dir = path.join(COMMITTED_ERRORS_DIR, category)
            if (!existsSync(dir)) continue
            for (const file of readdirSync(dir)) {
                if (!file.endsWith(".md")) continue
                const rel = path.join(category, file)
                if (!knownFiles.has(rel)) stray.push(rel)
            }
        }
        expect(stray).toEqual([])
    })
})

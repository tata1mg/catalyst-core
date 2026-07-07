#!/usr/bin/env node
/**
 * Catalyst MCP v2 — setup.js
 * Run once: npx catalyst-mcp-setup (or node setup.js from mcp_v2/)
 *
 * Steps:
 * 1. Verify this is a valid catalyst-core project
 * 2. Create context.db, run schema.sql
 * 3. Seed framework_knowledge from knowledge-base.json (static rows)
 * 4. Seed known_errors from knowledge-base.json known_errors section
 * 5. Build FTS index over static rows
 * 6. Run sync_catalyst_docs once for live sitemap rows (best-effort; warns but does not fail)
 */

const fs = require("fs")
const path = require("path")
const Database = require("better-sqlite3")
const sync = require("./tools/sync")
const knowledge = require("./tools/knowledge")
const { seedKnowledgeBase } = require("./lib/seed")

const MCP_DIR = __dirname
const DB_PATH = path.join(MCP_DIR, "context.db")
const SCHEMA_PATH = path.join(MCP_DIR, "schema.sql")
const KB_PATH = path.join(MCP_DIR, "knowledge-base.json")

// ── 1. Find & validate catalyst project ──────────────────────────────────────

function findCatalystRoot() {
    let dir = process.cwd()
    while (dir !== path.parse(dir).root) {
        const pkgPath = path.join(dir, "package.json")
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
            const deps = { ...pkg.dependencies, ...pkg.devDependencies }
            if (deps["catalyst-core"]) {
                return { dir, pkg, catalystPackageName: "catalyst-core", version: deps["catalyst-core"] }
            }
        }
        dir = path.dirname(dir)
    }
    return null
}

// ── 2. DB init ────────────────────────────────────────────────────────────────

function initDb() {
    const schema = fs.readFileSync(SCHEMA_PATH, "utf8")
    const db = new Database(DB_PATH)
    db.exec(schema)
    return db
}

// ── 3 & 4. Seed from knowledge-base.json ─────────────────────────────────────

function seedFromLocalKb(db, projectInfo) {
    const { knowledgeCount, errorCount } = seedKnowledgeBase(db, KB_PATH, projectInfo)
    console.log(`  ✓ Seeded ${knowledgeCount} knowledge entries`)
    console.log(`  ✓ Seeded ${errorCount} known_errors entries`)
    console.log(
        `  ✓ Project context stored (${projectInfo.pkg.name}, ${projectInfo.catalystPackageName}@${projectInfo.version})`
    )
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log("Catalyst MCP v2 — Setup\n")

    // 1. Validate catalyst project
    const projectInfo = findCatalystRoot()
    if (!projectInfo) {
        console.error("✗ No catalyst-core dependency found in any package.json above this directory.")
        console.error("  Run setup from inside your catalyst project.")
        process.exit(1)
    }
    console.log(`✓ Catalyst project: ${projectInfo.pkg.name || projectInfo.dir}`)
    console.log(`  ${projectInfo.catalystPackageName}@${projectInfo.version}`)

    // 2. Init DB
    console.log("\nInitializing context.db...")
    const db = initDb()
    console.log(`  ✓ DB created at ${DB_PATH}`)

    // 3 & 4. Seed static knowledge
    console.log("\nSeeding knowledge-base.json...")
    seedFromLocalKb(db, projectInfo)

    // 5. Build FTS index from the just-seeded static rows.
    //    DROP first so re-runs of setup don't leave orphan rowids pointing at deleted rows.
    db.exec(`DROP TABLE IF EXISTS fk_fts`)
    knowledge.init(db)

    // 6. Initial sync — pulls knowledge-base.json from tata1mg/catalyst-core@main, then
    //    fetches the catalyst.1mg.com sitemap. Failures are warnings, not setup-blockers
    //    (network may be unavailable at install time).
    console.log("\nSyncing knowledge-base.json from tata1mg/catalyst-core@main and live docs...")
    sync.init(db)
    try {
        const result = await sync.handle_sync_catalyst_docs({})
        const kb = result.knowledge_base
        if (kb) {
            if (kb.error) {
                console.warn(`  ⚠ knowledge-base.json: ${kb.error}`)
            } else if (kb.kb_changed) {
                console.log(`  ✓ knowledge-base.json: ${kb.message}`)
            } else {
                console.log(`  ✓ knowledge-base.json: ${kb.message}`)
            }
        }
        if (result.error) {
            console.warn(`  ⚠ ${result.message}`)
            console.warn("    Run sync_catalyst_docs later via your MCP client to retry.")
        } else {
            console.log(`  ✓ ${result.message}`)
            if (result.failed > 0 && result.errors.length) {
                const sample = result.errors.slice(0, 3).map((e) => `${e.url} (${e.error})`)
                console.warn(`    ${result.failed} URL(s) failed. First: ${sample.join("; ")}`)
            }
        }
    } catch (e) {
        console.warn(`  ⚠ Sync threw: ${e.message}`)
        console.warn("    Run sync_catalyst_docs later via your MCP client to retry.")
    }

    db.close()
    console.log("\n✓ Setup complete. MCP is ready.\n")
    const mcpConfig = JSON.stringify(
        {
            "catalyst-mcp": {
                command: "node",
                args: [path.join(MCP_DIR, "mcp.js")],
                disabledTools: [],
                disabled: false,
            },
        },
        null,
        2
    )
    console.log("Add to your MCP config (Claude, Cursor, Windsurf, or any MCP-compatible client):")
    console.log(mcpConfig)
}

main().catch((e) => {
    console.error("Setup failed:", e.message)
    process.exit(1)
})

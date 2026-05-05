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
 * 5. Run sync_catalyst_docs once (dynamic sitemap rows)
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MCP_DIR = __dirname;
const DB_PATH = path.join(MCP_DIR, 'context.db');
const SCHEMA_PATH = path.join(MCP_DIR, 'schema.sql');
const KB_PATH = path.join(MCP_DIR, 'knowledge-base.json');
// ── 1. Find & validate catalyst project ──────────────────────────────────────

function findCatalystRoot() {
  let dir = process.cwd();
  while (dir !== path.parse(dir).root) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['catalyst-core']) {
        return { dir, pkg, version: deps['catalyst-core'] };
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

// ── 2. DB init ────────────────────────────────────────────────────────────────

function initDb() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const db = new Database(DB_PATH);
  db.exec(schema);
  return db;
}

// ── 3 & 4. Seed from knowledge-base.json ─────────────────────────────────────

function seedKnowledgeBase(db, projectInfo) {
  const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'));

  // DELETE existing static rows so re-runs reflect updated knowledge-base.json
  db.prepare(`DELETE FROM framework_knowledge WHERE source = 'static'`).run();
  db.prepare(`DELETE FROM known_errors`).run();

  const insertKnowledge = db.prepare(`
    INSERT INTO framework_knowledge (section, title, content, layer, source, tags, github_files)
    VALUES (@section, @title, @content, @layer, @source, @tags, @github_files)
  `);

  const insertError = db.prepare(`
    INSERT INTO known_errors (symptom, cause, fix, layer, tags)
    VALUES (@symptom, @cause, @fix, @layer, @tags)
  `);

  let knowledgeCount = 0;
  let errorCount = 0;

  const seedAll = db.transaction(() => {
    for (const entry of kb) {
      if (entry.section === 'known_errors') {
        // known_errors entries encode symptom/cause/fix in content as:
        // "Symptom: ... Cause: ... Fix: ..."
        const content = entry.content || '';
        const symptomMatch = content.match(/Symptom:\s*([^.]+\.?)/i);
        const causeMatch = content.match(/Cause:\s*([^.]+\.?)/i);
        const fixMatch = content.match(/Fix:\s*([\s\S]+)/i);
        insertError.run({
          symptom: symptomMatch ? symptomMatch[1].trim() : entry.title,
          cause: causeMatch ? causeMatch[1].trim() : '',
          fix: fixMatch ? fixMatch[1].trim() : '',
          layer: entry.layer,
          tags: JSON.stringify(entry.tags || []),
        });
        errorCount++;
      } else {
        insertKnowledge.run({
          section: entry.section,
          title: entry.title,
          content: entry.content,
          layer: entry.layer,
          source: 'static',
          tags: JSON.stringify(entry.tags || []),
          github_files: entry.github_files ? JSON.stringify(entry.github_files) : null,
        });
        knowledgeCount++;
      }
    }
  });

  seedAll();
  console.log(`  ✓ Seeded ${knowledgeCount} knowledge entries`);
  console.log(`  ✓ Seeded ${errorCount} known_errors entries`);

  // Store project context
  db.prepare(`
    INSERT OR REPLACE INTO project_context (id, repo_path, package_name, catalyst_version, detected_at)
    VALUES (1, @repo_path, @package_name, @catalyst_version, datetime('now'))
  `).run({
    repo_path: projectInfo.dir,
    package_name: projectInfo.pkg.name || 'unknown',
    catalyst_version: projectInfo.version,
  });
  console.log(`  ✓ Project context stored (${projectInfo.pkg.name}, catalyst-core@${projectInfo.version})`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Catalyst MCP v2 — Setup\n');

  // 1. Validate catalyst project
  const projectInfo = findCatalystRoot();
  if (!projectInfo) {
    console.error('✗ No catalyst-core dependency found in any package.json above this directory.');
    console.error('  Run setup from inside your catalyst project.');
    process.exit(1);
  }
  console.log(`✓ Catalyst project: ${projectInfo.pkg.name || projectInfo.dir}`);
  console.log(`  catalyst-core@${projectInfo.version}`);

  // 2. Init DB
  console.log('\nInitializing context.db...');
  const db = initDb();
  console.log(`  ✓ DB created at ${DB_PATH}`);

  // 3 & 4. Seed static knowledge
  console.log('\nSeeding knowledge-base.json...');
  seedKnowledgeBase(db, projectInfo);

  // 5. Initial sitemap sync — disabled (slow, use sync_catalyst_docs MCP tool manually)

  db.close();
  console.log('\n✓ Setup complete. MCP is ready.\n');
  const mcpConfig = JSON.stringify({
    "catalyst-mcp": {
      "command": "node",
      "args": [path.join(MCP_DIR, 'mcp.js')],
      "disabledTools": [],
      "disabled": false
    }
  }, null, 2);
  console.log('Add to your MCP config (Claude, Cursor, Windsurf, or any MCP-compatible client):');
  console.log(mcpConfig);
}

main().catch((e) => {
  console.error('Setup failed:', e.message);
  process.exit(1);
});

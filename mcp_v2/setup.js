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
const https = require('https');
const crypto = require('crypto');

const MCP_DIR = __dirname;
const DB_PATH = path.join(MCP_DIR, 'context.db');
const SCHEMA_PATH = path.join(MCP_DIR, 'schema.sql');
const KB_PATH = path.join(MCP_DIR, 'knowledge-base.json');
const SITEMAP_URL = 'https://catalyst.1mg.com/public_docs/sitemap.xml';

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
    INSERT INTO framework_knowledge (section, title, content, layer, source, tags)
    VALUES (@section, @title, @content, @layer, @source, @tags)
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

// ── 5. sync_catalyst_docs (initial run) ───────────────────────────────────────

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseSitemapUrls(xml) {
  const matches = xml.match(/<loc>(.*?)<\/loc>/g) || [];
  return matches.map((m) => m.replace(/<\/?loc>/g, '').trim());
}

function stripHtml(html) {
  // Very simple strip — good enough for catalyst docs
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

async function syncCatalystDocs(db) {
  console.log('\n  Fetching sitemap...');
  let xml;
  try {
    xml = await fetchUrl(SITEMAP_URL);
  } catch (e) {
    console.warn(`  ⚠ Could not fetch sitemap (${e.message}). Skipping live docs sync.`);
    console.warn('    You can run sync later via the sync_catalyst_docs MCP tool.');
    return;
  }

  const urls = parseSitemapUrls(xml);
  console.log(`  Found ${urls.length} URLs in sitemap`);

  const insertKnowledge = db.prepare(`
    INSERT INTO framework_knowledge (section, title, content, layer, source, tags, url)
    VALUES (@section, @title, @content, @layer, 'sitemap', '[]', @url)
  `);

  const insertSnapshot = db.prepare(`
    INSERT INTO doc_snapshots (url, content_hash, slot) VALUES (@url, @hash, 'curr')
  `);

  const insertLink = db.prepare(`
    INSERT INTO linkage_map (url, knowledge_id) VALUES (@url, @knowledge_id)
  `);

  let synced = 0;
  let failed = 0;

  for (const url of urls) {
    try {
      const html = await fetchUrl(url);
      const text = stripHtml(html);
      const hash = contentHash(text);

      // Extract a title from <title> tag if present
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : url.split('/').pop() || url;

      // Truncate content to 2000 chars to keep DB lean
      const content = text.slice(0, 2000);

      const result = db.transaction(() => {
        const row = insertKnowledge.run({ section: 'sitemap', title, content, layer: 'Component', url });
        insertSnapshot.run({ url, hash });
        insertLink.run({ url, knowledge_id: row.lastInsertRowid });
      })();

      synced++;
      process.stdout.write(`\r  Synced ${synced}/${urls.length} pages...`);
    } catch (e) {
      failed++;
    }
  }

  console.log(`\n  ✓ Synced ${synced} pages (${failed} failed)`);
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
  // console.log('\nRunning initial sync_catalyst_docs...');
  // await syncCatalystDocs(db);

  db.close();
  console.log('\n✓ Setup complete. MCP is ready.\n');
  console.log('Add to your Claude config:');
  console.log(`  { "command": "node", "args": ["${path.join(MCP_DIR, 'mcp.js')}"] }`);
}

main().catch((e) => {
  console.error('Setup failed:', e.message);
  process.exit(1);
});

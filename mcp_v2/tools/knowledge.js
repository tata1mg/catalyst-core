'use strict';

const https = require('https');
const { findCatalystRoot } = require('../lib/helpers');

let _db;

// Keywords that signal the LLM wants a complete/live list rather than a concept explanation.
// When a matched KB entry has github_files + query matches these, we auto-fetch from GitHub.
const LIST_INTENT_PATTERNS = /\b(all|list|available|new|latest|complete|full|enumerate|what hooks|any hooks|what.*available|show.*all)\b/i;

function init(db) {
  _db = db;

  // Migrate: add github_files column if missing (existing DBs)
  const cols = _db.prepare(`PRAGMA table_info(framework_knowledge)`).all().map(c => c.name);
  if (!cols.includes('github_files')) {
    _db.exec(`ALTER TABLE framework_knowledge ADD COLUMN github_files TEXT`);
  }
  // Drop always_fetch_github if it exists (replaced by intent detection)
  // SQLite can't DROP COLUMN before 3.35 — just leave it, it's ignored

  // Create FTS5 virtual table if not exists (standalone, not external-content)
  _db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fk_fts USING fts5(
      title, content, tags, section,
      tokenize='unicode61 remove_diacritics 1'
    );
  `);

  // Populate FTS index if empty
  const count = _db.prepare(`SELECT count(*) as c FROM fk_fts`).get().c;
  if (count === 0) {
    _db.exec(`INSERT INTO fk_fts(rowid, title, content, tags, section) SELECT id, title, content, COALESCE(tags,''), section FROM framework_knowledge`);
  }
}

function fetchRaw(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'catalyst-mcp/1.0' } }, res => {
      if (res.statusCode === 404) return resolve(null);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

// Fetch first available file — used for KB-miss GitHub fallback
async function fetchFromGithub(files, installedVersion) {
  if (!files || files.length === 0) return null;

  const tag = installedVersion || 'main';
  const base = `https://raw.githubusercontent.com/tata1mg/catalyst-core/${tag}`;

  for (const file of files) {
    try {
      const content = await fetchRaw(`${base}/${file}`);
      if (content) return { file, tag, content: content.slice(0, 8000) };
    } catch (_) {}
  }

  // Retry with main if versioned tag failed
  if (tag !== 'main') {
    for (const file of files) {
      try {
        const content = await fetchRaw(`https://raw.githubusercontent.com/tata1mg/catalyst-core/main/${file}`);
        if (content) return { file, tag: 'main', content: content.slice(0, 8000) };
      } catch (_) {}
    }
  }

  return null;
}

// Fetch a specific single file — used for intent-based narrowed fetch
async function fetchOneFromGithub(file, installedVersion) {
  const tag = installedVersion || 'main';
  try {
    const content = await fetchRaw(`https://raw.githubusercontent.com/tata1mg/catalyst-core/${tag}/${file}`);
    if (content) return { file, tag, content: content.slice(0, 8000) };
  } catch (_) {}
  // Retry with main
  if (tag !== 'main') {
    try {
      const content = await fetchRaw(`https://raw.githubusercontent.com/tata1mg/catalyst-core/main/${file}`);
      if (content) return { file, tag: 'main', content: content.slice(0, 8000) };
    } catch (_) {}
  }
  return null;
}

// Build FTS5 query string from keywords array — each term ORed, quoted for safety
function buildFtsQuery(keywords) {
  return keywords
    .map(k => `"${k.replace(/"/g, '')}"`)
    .join(' OR ');
}

// Narrow down which github_file to fetch based on query keywords.
// Avoids fetching all files when query is clearly about one specific hook/file.
function narrowGithubFile(files, query) {
  if (!files || files.length <= 1) return files;
  const q = query.toLowerCase();
  // If query mentions a specific file hint, prefer that file
  for (const file of files) {
    const basename = file.split('/').pop().replace(/\.js$/, '').toLowerCase();
    if (q.includes(basename)) return [file];
  }
  // Default: return all (caller fetches first available)
  return files;
}

async function handle_query_knowledge({ query, keywords, section, github_files } = {}) {
  if (!query) return { error: 'query is required.' };

  // ── FTS5 search ────────────────────────────────────────────────────────────
  const searchTerms = (keywords && keywords.length > 0) ? keywords : [query];
  const ftsQuery = buildFtsQuery(searchTerms);

  let rows = [];
  try {
    // Join back to framework_knowledge to get github_files
    const sql = section
      ? `SELECT fk.title, fk.content, fk.tags, fk.section, fk.github_files
         FROM fk_fts
         JOIN framework_knowledge fk ON fk_fts.rowid = fk.id
         WHERE fk_fts MATCH ? AND fk_fts.section = ? ORDER BY rank LIMIT 6`
      : `SELECT fk.title, fk.content, fk.tags, fk.section, fk.github_files
         FROM fk_fts
         JOIN framework_knowledge fk ON fk_fts.rowid = fk.id
         WHERE fk_fts MATCH ? ORDER BY rank LIMIT 6`;
    rows = section
      ? _db.prepare(sql).all(ftsQuery, section)
      : _db.prepare(sql).all(ftsQuery);
  } catch (_) {
    // FTS syntax error — fall through to github
  }

  if (rows.length > 0) {
    // Find first matched entry that has github_files attached
    const entryWithFiles = rows.find(r => r.github_files);
    const parsedFiles = entryWithFiles ? JSON.parse(entryWithFiles.github_files) : null;

    // ── Intent detection: does the query want a live/complete list? ──────────
    const isListIntent = LIST_INTENT_PATTERNS.test(query);

    if (isListIntent && parsedFiles) {
      let installedVersion = null;
      try {
        const root = findCatalystRoot();
        installedVersion = root ? root.installedVersion : null;
      } catch (_) {}

      // Narrow to the most relevant file based on query keywords
      const targetFiles = narrowGithubFile(parsedFiles, query);
      const github = await fetchFromGithub(targetFiles, installedVersion);

      return {
        query,
        source: 'knowledge_base+github',
        results: rows.map(({ github_files, ...r }) => r),
        github_file: github ? github.file : null,
        github_tag: github ? github.tag : null,
        github_content: github ? github.content : null,
        installed_version: installedVersion,
        note: `${rows.length} KB entries matched. List intent detected — fetched latest source${github ? ` (${github.file}@${github.tag})` : ' (GitHub fetch failed)'}.`,
      };
    }

    // ── Standard KB hit: return results + hint about live source files ───────
    return {
      query,
      source: 'knowledge_base',
      results: rows.map(({ github_files, ...r }) => r),
      live_source_files: parsedFiles || null, // LLM can re-query with these if it needs fresher data
      note: `${rows.length} entries matched from local knowledge base.${parsedFiles ? ' Pass live_source_files as github_files in a follow-up query_knowledge call if you need the latest source.' : ''}`,
    };
  }

  // ── GitHub fallback (KB miss) ──────────────────────────────────────────────
  let installedVersion = null;
  try {
    const root = findCatalystRoot();
    installedVersion = root ? root.installedVersion : null;
  } catch (_) {}

  const github = await fetchFromGithub(github_files || [], installedVersion);

  if (github) {
    return {
      query,
      source: 'github',
      github_file: github.file,
      github_tag: github.tag,
      installed_version: installedVersion,
      content: github.content,
      note: `No KB match. Fetched source file '${github.file}' from catalyst-core@${github.tag} on GitHub.`,
    };
  }

  // ── Hard miss ──────────────────────────────────────────────────────────────
  return {
    query,
    source: 'none',
    results: [],
    llm_instruction: 'No match found in the knowledge base and no source file was provided for GitHub fallback. DO NOT search node_modules, dist, or the filesystem. Tell the user this topic is not fully covered in the knowledge base yet, and suggest they check the catalyst-core source directly at node_modules/catalyst-core/src/.',
    note: `No KB match for "${query}". If you know the relevant source file path, retry with github_files: ["src/path/to/file.js"].`,
  };
}

module.exports = { init, handle_query_knowledge };

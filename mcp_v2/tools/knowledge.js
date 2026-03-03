'use strict';

const https = require('https');
const { findCatalystRoot } = require('../lib/helpers');

let _db;

function init(db) {
  _db = db;

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

// Build FTS5 query string from keywords array — each term ORed, quoted for safety
function buildFtsQuery(keywords) {
  return keywords
    .map(k => `"${k.replace(/"/g, '')}"`)
    .join(' OR ');
}

async function handle_query_knowledge({ query, keywords, section, github_files } = {}) {
  if (!query) return { error: 'query is required.' };

  // ── FTS5 search ────────────────────────────────────────────────────────────
  // If LLM supplied keywords, use them for FTS. Otherwise fall back to raw query as single term.
  const searchTerms = (keywords && keywords.length > 0) ? keywords : [query];
  const ftsQuery = buildFtsQuery(searchTerms);

  let rows = [];
  try {
    const sql = section
      ? `SELECT title, content, tags, section FROM fk_fts WHERE fk_fts MATCH ? AND section = ? ORDER BY rank LIMIT 6`
      : `SELECT title, content, tags, section FROM fk_fts WHERE fk_fts MATCH ? ORDER BY rank LIMIT 6`;
    rows = section
      ? _db.prepare(sql).all(ftsQuery, section)
      : _db.prepare(sql).all(ftsQuery);
  } catch (_) {
    // FTS syntax error (e.g. special chars) — fall through to github
  }

  if (rows.length > 0) {
    return {
      query,
      source: 'knowledge_base',
      results: rows.map(({ id, last_updated, url, rank, ...r }) => r),
      note: `${rows.length} entries matched from local knowledge base.`,
    };
  }

  // ── GitHub fallback ────────────────────────────────────────────────────────
  // LLM can pass github_files directly (e.g. ['src/native/bridge/WebBridge.js'])
  // if it knows the relevant source file. Otherwise we skip GitHub fetch.
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

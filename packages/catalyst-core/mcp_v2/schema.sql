-- Catalyst MCP v2 — context.db schema
-- Run once during setup.js. Never run from mcp.js at runtime.

CREATE TABLE IF NOT EXISTS project_context (
  id INTEGER PRIMARY KEY,
  repo_path TEXT NOT NULL,
  package_name TEXT NOT NULL,
  catalyst_version TEXT NOT NULL,
  detected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Static knowledge (source='static') + sitemap docs (source='sitemap')
-- sync_catalyst_docs only touches rows where source='sitemap'
CREATE TABLE IF NOT EXISTS framework_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  layer TEXT NOT NULL,           -- Config | Build | Bridge | Runtime | Component
  source TEXT NOT NULL,          -- 'static' | 'sitemap'
  tags TEXT NOT NULL DEFAULT '[]', -- JSON array
  url TEXT,                      -- only for source='sitemap'
  github_files TEXT,             -- JSON array of repo-relative paths; fetched when list-intent detected or on KB miss
  last_updated TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS known_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symptom TEXT NOT NULL,
  cause TEXT NOT NULL,
  fix TEXT NOT NULL,
  layer TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]' -- JSON array
);

-- 18 conversion tasks seeded from conversion-tasks.json (Phase 2)
CREATE TABLE IF NOT EXISTS conversion_tasks (
  id TEXT PRIMARY KEY,           -- e.g. "config-ios-webview"
  title TEXT NOT NULL,
  category TEXT NOT NULL,        -- config | native_apis | build_setup | security | ux
  description TEXT NOT NULL,
  how_to_check TEXT NOT NULL,
  fix_guide TEXT NOT NULL,
  depends_on TEXT NOT NULL DEFAULT '[]', -- JSON array of task ids
  status TEXT NOT NULL DEFAULT 'pending' -- pending | done | blocked
);

-- Two snapshots max: prev + curr per URL
-- Used by sync_catalyst_docs for diff-based fetching
CREATE TABLE IF NOT EXISTS doc_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  slot TEXT NOT NULL DEFAULT 'curr' -- 'prev' | 'curr'
);

-- Maps sitemap URL → framework_knowledge row(s) it updated
CREATE TABLE IF NOT EXISTS linkage_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  knowledge_id INTEGER NOT NULL REFERENCES framework_knowledge(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fk_section ON framework_knowledge(section);
CREATE INDEX IF NOT EXISTS idx_fk_source ON framework_knowledge(source);
CREATE INDEX IF NOT EXISTS idx_fk_layer ON framework_knowledge(layer);
CREATE INDEX IF NOT EXISTS idx_ke_layer ON known_errors(layer);
CREATE INDEX IF NOT EXISTS idx_ct_category ON conversion_tasks(category);
CREATE INDEX IF NOT EXISTS idx_ct_status ON conversion_tasks(status);
CREATE INDEX IF NOT EXISTS idx_ds_url ON doc_snapshots(url);

-- Task plans — persisted across sessions (Phase 5)
-- One active plan per project_root at a time.
CREATE TABLE IF NOT EXISTS task_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,        -- kebab-case goal slug, e.g. "convert-1mg-web-to-universal"
  goal TEXT NOT NULL,               -- original goal string
  project_root TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active | completed | abandoned
  steps TEXT NOT NULL DEFAULT '[]', -- JSON array of step objects
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tp_status ON task_plans(status);
CREATE INDEX IF NOT EXISTS idx_tp_project ON task_plans(project_root);

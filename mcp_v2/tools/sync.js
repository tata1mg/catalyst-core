"use strict"

let _db

function init(db) {
    _db = db
}

function handle_sync_catalyst_docs({ force = false } = {}) {
    const snapshot_count = _db.prepare(`SELECT COUNT(*) as c FROM doc_snapshots`).get()
    const knowledge_count = _db
        .prepare(`SELECT COUNT(*) as c FROM framework_knowledge WHERE source = 'sitemap'`)
        .get()
    return {
        _phase: 6,
        force,
        existing_snapshots: snapshot_count.c,
        sitemap_knowledge_rows: knowledge_count.c,
        message: "Live sync not yet implemented (Phase 6). Run setup.js for initial sync.",
    }
}

module.exports = { init, handle_sync_catalyst_docs }

'use strict';

let _db;

function init(db) {
  _db = db;
}

function handle_debug_issue({ symptom, layer } = {}) {
  const NOISE = new Set(['the','a','an','is','are','was','not','does','do','on','in','at','to','for','of','and','or','with','my','i','its','it','this','that','when','why','how','what','where','after','before','but','can','cant','cannot','will','wont','still','always','never','app','apps']);
  const tokens = symptom.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !NOISE.has(t));

  function scoreRow(text) {
    const lower = text.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (lower.includes(token)) score++;
    }
    return score;
  }

  const allErrors = layer
    ? _db.prepare(`SELECT * FROM known_errors WHERE layer = ?`).all(layer)
    : _db.prepare(`SELECT * FROM known_errors`).all();

  const scored = allErrors
    .map(r => ({ ...r, _score: scoreRow(r.symptom + ' ' + r.cause + ' ' + r.tags) }))
    .sort((a, b) => b._score - a._score);

  const matched  = scored.filter(r => r._score > 0).slice(0, 5);
  const fallback = matched.length === 0 ? scored.slice(0, 3) : [];

  const matchedLayers    = [...new Set(matched.map(r => r.layer))];
  const knowledgeLayers  = layer ? [layer] : matchedLayers.length ? matchedLayers : null;

  let knowledge = [];
  if (knowledgeLayers && knowledgeLayers.length) {
    const placeholders = knowledgeLayers.map(() => '?').join(',');
    knowledge = _db.prepare(`
      SELECT title, content, layer FROM framework_knowledge
      WHERE source = 'static' AND layer IN (${placeholders})
      ORDER BY layer, id
      LIMIT 8
    `).all(...knowledgeLayers);
  }

  const result = { symptom, tokens_used: tokens, layer: layer || 'auto' };

  if (matched.length > 0) {
    result.matched_errors     = matched.map(({ _score, ...r }) => ({ ...r, match_score: _score }));
    result.relevant_knowledge = knowledge;
  } else {
    result.matched_errors     = [];
    result.fallback_errors    = fallback.map(({ _score, ...r }) => r);
    result.relevant_knowledge = knowledge;
    result.note = `No strong keyword matches for "${symptom}". Showing top known_errors entries as fallback. Try rephrasing with more specific terms (e.g. "android build sdkPath", "localhost blocked", "clearWebData cache").`;
  }

  return result;
}

module.exports = { init, handle_debug_issue };

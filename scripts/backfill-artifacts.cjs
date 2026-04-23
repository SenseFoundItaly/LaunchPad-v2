/**
 * One-shot: re-parse chat_messages for every project, extract
 * :::artifact{} blocks from assistant messages, and dispatch each to
 * the same persistence logic the chat route uses on new turns.
 *
 * Populates graph_nodes / scores / research with data from chats that
 * happened before artifact persistence was wired.
 *
 * Usage:
 *   node scripts/backfill-artifacts.cjs              # all projects
 *   node scripts/backfill-artifacts.cjs <projectId>  # one project
 */

const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const DB_PATH = process.env.LAUNCHPAD_DB_PATH || path.join(process.cwd(), 'data', 'launchpad.db');
const ONLY_PROJECT = process.argv[2] || null;
const db = new Database(DB_PATH);

function extractArtifacts(content) {
  const out = [];
  const re = /:::artifact\s*(\{[^\n]*?\})\s*\n([\s\S]*?)\n:::/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    try {
      const header = JSON.parse(m[1]);
      const body = JSON.parse(m[2].trim());
      out.push({ ...header, ...body });
    } catch {}
  }
  return out;
}

function relationFor(t) {
  const map = { competitor: 'competes_with', customer: 'serves', market: 'operates_in', investor: 'funded_by', technology: 'uses', partner: 'partners_with' };
  return map[t] || 'related_to';
}

function safeJson(s) { if (!s) return null; try { return JSON.parse(s); } catch { return null; } }

function upsertScores(pid, patch) {
  const existing = db.prepare('SELECT project_id, overall_score, benchmark, dimensions FROM scores WHERE project_id = ?').get(pid);
  if (existing) {
    const dims = { ...(safeJson(existing.dimensions) || {}), ...(patch.dimensions || {}) };
    db.prepare('UPDATE scores SET overall_score = COALESCE(?, overall_score), benchmark = COALESCE(?, benchmark), dimensions = ?, scored_at = CURRENT_TIMESTAMP WHERE project_id = ?').run(patch.overall_score ?? null, patch.benchmark ?? null, JSON.stringify(dims), pid);
  } else {
    db.prepare('INSERT INTO scores (project_id, overall_score, benchmark, dimensions) VALUES (?, ?, ?, ?)').run(pid, patch.overall_score ?? 0, patch.benchmark ?? null, JSON.stringify(patch.dimensions ?? {}));
  }
}

function persist(pid, uid, a) {
  try {
    if (a.type === 'entity-card') {
      if (!a.name) return null;
      const hit = db.prepare('SELECT id FROM graph_nodes WHERE project_id = ? AND LOWER(name) = LOWER(?) LIMIT 1').get(pid, a.name);
      if (hit) {
        db.prepare('UPDATE graph_nodes SET summary = ?, attributes = ? WHERE id = ?').run(a.summary ?? '', JSON.stringify(a.attributes ?? {}), hit.id);
        return { action: 'update', id: hit.id, name: a.name };
      }
      const id = `node_${crypto.randomUUID().slice(0, 12)}`;
      db.prepare(`INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes) VALUES (?, ?, ?, ?, ?, ?)`).run(id, pid, a.name, a.entity_type ?? 'entity', a.summary ?? '', JSON.stringify(a.attributes ?? {}));
      const root = db.prepare("SELECT id FROM graph_nodes WHERE project_id = ? AND node_type = 'your_startup' LIMIT 1").get(pid);
      if (root) {
        db.prepare(`INSERT INTO graph_edges (id, project_id, source_node_id, target_node_id, relation) VALUES (?, ?, ?, ?, ?)`).run(`edge_${crypto.randomUUID().slice(0, 12)}`, pid, root.id, id, relationFor(a.entity_type));
      }
      return { action: 'insert', id, name: a.name };
    }
    if (a.type === 'insight-card') {
      const fact = ((a.title ?? '').trim() + (a.body ? ': ' + a.body : '')).slice(0, 600).trim();
      if (!fact) return null;
      const conf = a.confidence === 'high' ? 0.9 : a.confidence === 'medium' ? 0.7 : a.confidence === 'low' ? 0.5 : 0.75;
      const hit = db.prepare(`SELECT id FROM memory_facts WHERE user_id = ? AND project_id = ? AND kind = 'observation' AND LOWER(fact) = LOWER(?) AND dismissed = 0`).get(uid, pid, fact);
      if (hit) {
        db.prepare('UPDATE memory_facts SET updated_at = CURRENT_TIMESTAMP, confidence = MAX(confidence, ?) WHERE id = ?').run(conf, hit.id);
        return { action: 'bump', preview: fact.slice(0, 60) };
      }
      db.prepare(`INSERT INTO memory_facts (id, user_id, project_id, fact, kind, source_type, confidence) VALUES (?, ?, ?, ?, 'observation', 'chat', ?)`).run(crypto.randomUUID(), uid, pid, fact, conf);
      return { action: 'insert', preview: fact.slice(0, 60) };
    }
    if (a.type === 'gauge-chart' && typeof a.score === 'number') {
      const n = a.maxScore && a.maxScore > 0 ? (a.score * 10) / a.maxScore : a.score;
      upsertScores(pid, { overall_score: n, benchmark: a.verdict });
      return { action: 'upsert scores', score: n, verdict: a.verdict };
    }
    if (a.type === 'radar-chart' && Array.isArray(a.data)) {
      const dims = {};
      for (const p of a.data) if (p && typeof p.subject === 'string' && typeof p.value === 'number') dims[p.subject] = p.value;
      if (Object.keys(dims).length === 0) return null;
      upsertScores(pid, { dimensions: dims });
      return { action: 'upsert dimensions', keys: Object.keys(dims) };
    }
    if (a.type === 'score-card' && typeof a.score === 'number' && a.title) {
      upsertScores(pid, { dimensions: { [a.title]: a.score } });
      return { action: 'upsert dimension', key: a.title, value: a.score };
    }
    if (a.type === 'metric-grid' && Array.isArray(a.metrics)) {
      const isMkt = /market|tam|sam|som|demand|size|fractional|executive/i.test(`${a.title ?? ''}`);
      if (!isMkt) return null;
      const data = a.metrics.reduce((acc, m) => (m && m.label ? { ...acc, [m.label]: { value: m.value, change: m.change } } : acc), {});
      const hit = db.prepare('SELECT project_id FROM research WHERE project_id = ?').get(pid);
      const payload = JSON.stringify({ ...data, _title: a.title });
      if (hit) db.prepare('UPDATE research SET market_size = ?, researched_at = CURRENT_TIMESTAMP WHERE project_id = ?').run(payload, pid);
      else db.prepare('INSERT INTO research (project_id, market_size) VALUES (?, ?)').run(pid, payload);
      return { action: 'upsert market', keys: Object.keys(data).length };
    }
    if (a.type === 'comparison-table' && Array.isArray(a.rows) && Array.isArray(a.columns)) {
      const isComp = /competitor|vs\.?|compare|platform|alternatives/i.test(`${a.title ?? ''}`);
      if (!isComp) return null;
      const comps = a.rows.map(r => ({ name: r.label, attributes: a.columns.reduce((acc, col, i) => ({ ...acc, [col]: r.values?.[i] }), {}) }));
      const hit = db.prepare('SELECT project_id FROM research WHERE project_id = ?').get(pid);
      const payload = JSON.stringify(comps);
      if (hit) db.prepare('UPDATE research SET competitors = ?, researched_at = CURRENT_TIMESTAMP WHERE project_id = ?').run(payload, pid);
      else db.prepare('INSERT INTO research (project_id, competitors) VALUES (?, ?)').run(pid, payload);
      return { action: 'upsert competitors', count: comps.length };
    }
    return null;
  } catch (err) {
    return { error: err.message };
  }
}

const projects = ONLY_PROJECT
  ? db.prepare('SELECT id, owner_user_id FROM projects WHERE id = ?').all(ONLY_PROJECT)
  : db.prepare('SELECT id, owner_user_id FROM projects WHERE owner_user_id IS NOT NULL').all();

console.log(`[backfill] scanning ${projects.length} project(s)...`);
let totals = { msgs: 0, arts: 0, done: 0, skip: 0 };

for (const p of projects) {
  const rows = db.prepare(`SELECT content FROM chat_messages WHERE project_id = ? AND role = 'assistant' AND step = 'chat' ORDER BY timestamp`).all(p.id);
  for (const row of rows) {
    totals.msgs++;
    for (const art of extractArtifacts(row.content)) {
      totals.arts++;
      const r = persist(p.id, p.owner_user_id, art);
      if (r && !r.error) { totals.done++; console.log(`  ${p.id.slice(0, 18).padEnd(20)} ${art.type.padEnd(18)} ${JSON.stringify(r)}`); }
      else { totals.skip++; }
    }
  }
}

console.log('');
console.log(`[backfill] done. msgs=${totals.msgs} artifacts=${totals.arts} persisted=${totals.done} skipped=${totals.skip}`);
console.log(`[backfill] state: graph_nodes=${db.prepare('SELECT COUNT(*) AS n FROM graph_nodes').get().n}, scores=${db.prepare('SELECT COUNT(*) AS n FROM scores').get().n}, research=${db.prepare('SELECT COUNT(*) AS n FROM research').get().n}, memory_facts=${db.prepare('SELECT COUNT(*) AS n FROM memory_facts').get().n}`);

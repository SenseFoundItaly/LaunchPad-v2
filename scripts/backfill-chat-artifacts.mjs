#!/usr/bin/env node
/**
 * Gap C backfill — retroactively populate chat_artifacts from historical
 * assistant chat_messages. The persist hook only captures NEW emissions; this
 * makes every EXISTING project's inline analysis cards retrievable too.
 *
 * IDEMPOTENT: each row id is a deterministic hash of (chat_message_id, artifact
 * type, index), so re-running INSERTs nothing new (ON CONFLICT DO NOTHING).
 * Uses each message's created_at as the artifact timestamp so grouping/version
 * ordering matches when it was actually said.
 *
 * Usage:  node scripts/backfill-chat-artifacts.mjs [--dry] [--project <id>]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';

const DRY = process.argv.includes('--dry');
const projIdx = process.argv.indexOf('--project');
const ONLY_PROJECT = projIdx >= 0 ? process.argv[projIdx + 1] : null;

for (const raw of fs.readFileSync(path.join('/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2', '.env.local'), 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const e = l.indexOf('='); if (e < 0) continue;
  const k = l.slice(0, e).trim(), v = l.slice(e + 1).trim().replace(/^['"]|['"]$/g, '');
  if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

// Mirror src/lib/chat-artifact-meta.ts (kept in sync).
const NON_RETRIEVABLE = new Set(['option-set', 'skill-suggestion', 'knowledge-suggestion', 'monitor-proposal', 'budget-proposal', 'validation-proposal', 'action-suggestion', 'solve-progress', 'score-badge', 'sensitivity-slider', 'document', 'html-preview', 'fact', 'workflow-card', 'task']);
const TYPE_LABELS = { 'comparison-table': 'Comparison', 'metric-grid': 'Metrics', 'risk-matrix': 'Risk matrix', 'persona-card': 'Persona', 'tam-sam-som': 'Market sizing (TAM/SAM/SOM)', 'entity-card': 'Entity', 'insight-card': 'Insight', 'bar-chart': 'Chart', 'pie-chart': 'Chart', 'gauge-chart': 'Gauge', 'radar-chart': 'Radar', 'score-card': 'Score', 'weekly-update': 'Weekly update', 'investor-pipeline': 'Investor pipeline', 'idea-canvas': 'Idea Canvas' };

function parseArtifacts(text) {
  const out = [];
  for (const [, h, b] of text.matchAll(/:::artifact\s*(\{[^\n]*?\})\s*\n([\s\S]*?)\n:::/g)) {
    try { out.push({ ...JSON.parse(h), ...JSON.parse(b.trim()) }); } catch {}
  }
  return out;
}
function deriveTitle(a) {
  if (typeof a.title === 'string' && a.title.trim()) return a.title.trim().slice(0, 200);
  return TYPE_LABELS[a.type] ?? a.type;
}
function detId(msgId, type, i) {
  return 'cart_' + crypto.createHash('sha1').update(`${msgId}:${type}:${i}`).digest('hex').slice(0, 20);
}

async function main() {
  const where = ONLY_PROJECT ? sql`AND project_id = ${ONLY_PROJECT}` : sql``;
  const msgs = await sql`
    SELECT id, project_id, content, "timestamp"
      FROM chat_messages
     WHERE role = 'assistant' AND content LIKE '%:::artifact%' ${where}
     ORDER BY "timestamp"`;
  console.log(`${msgs.length} assistant messages with artifacts${ONLY_PROJECT ? ` (project ${ONLY_PROJECT})` : ''}`);

  let scanned = 0, inserted = 0, skipped = 0;
  for (const m of msgs) {
    const arts = parseArtifacts(m.content);
    arts.forEach((a, i) => {
      if (!a.type || NON_RETRIEVABLE.has(a.type)) return;
      scanned++;
    });
    let i = -1;
    for (const a of arts) {
      i++;
      if (!a.type || NON_RETRIEVABLE.has(a.type)) continue;
      const id = detId(m.id, a.type, i);
      const title = deriveTitle(a);
      const sources = Array.isArray(a.sources) ? a.sources : [];
      if (DRY) { inserted++; continue; }
      const res = await sql`
        INSERT INTO chat_artifacts (id, project_id, chat_message_id, artifact_type, title, payload, sources, turn_preview, created_at)
        VALUES (${id}, ${m.project_id}, ${m.id}, ${a.type}, ${title}, ${a}, ${sources}, ${'(backfilled)'}, ${m.timestamp})
        ON CONFLICT (id) DO NOTHING`;
      if (res.count > 0) inserted++; else skipped++;
    }
  }
  console.log(`retrievable artifacts scanned: ${scanned}`);
  console.log(DRY ? `[DRY] would insert: ${inserted}` : `inserted: ${inserted} | already present (skipped): ${skipped}`);
  await sql.end();
}
main().catch(async (e) => { console.error('FATAL', e.message); try { await sql.end(); } catch {} process.exit(1); });

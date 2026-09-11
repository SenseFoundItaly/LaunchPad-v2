#!/usr/bin/env node
/**
 * Wave-1 live verification.
 *  Gap 1: explicit "save this fact" → agent emits knowledge-suggestion →
 *         knowledge_proposed event → apply → knowledge_applied w/ same
 *         fact_hash → openKnowledgeProposals empties.
 *  Gap 8: a turn with an uncited external claim → chat_messages.meta carries
 *         uncited_prose_claims (best-effort; model-dependent).
 */
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import postgres from 'postgres';

const BASE = 'http://localhost:3001';
const UID = 'cb05a0ea-720c-4795-b582-5b013e8f7572';
const PID = process.env.VERIFY_PROJECT_ID || 'proj_85c9be57-921';
for (const raw of fs.readFileSync(path.join('/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2', '.env.local'), 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue; const e = l.indexOf('='); if (e < 0) continue;
  const k = l.slice(0, e).trim(), v = l.slice(e + 1).trim().replace(/^['"]|['"]$/g, ''); if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

// Mirror factHash() from src/lib/memory/events.ts exactly.
function factHash(text) {
  const norm = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,;:!?]+$/, '');
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
}
function parseArtifacts(text) {
  const out = [];
  for (const [, h, b] of text.matchAll(/:::artifact\s*(\{[^\n]*?\})\s*\n([\s\S]*?)\n:::/g)) {
    try { out.push({ ...JSON.parse(h), ...JSON.parse(b.trim()) }); } catch {}
  }
  return out;
}
async function chat(prompt) {
  const res = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-e2e-user': UID }, body: JSON.stringify({ project_id: PID, step: 'chat', messages: [{ role: 'user', content: prompt }] }) });
  const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '', full = '';
  while (true) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); const ls = buf.split('\n'); buf = ls.pop() ?? ''; for (const l of ls) { if (!l.startsWith('data: ')) continue; try { const p = JSON.parse(l.slice(6)); if (typeof p.content === 'string') full += p.content; if (p.done) { rd.cancel(); return full; } } catch {} } }
  return full;
}

async function main() {
  console.log('=== GAP 1: knowledge-proposal correlation ===');
  const full = await chat('Note this insight and save it so we do not lose it: Italian consumers increasingly prefer local artisan food over supermarket meal kits.');
  const ks = parseArtifacts(full).find(a => a.type === 'knowledge-suggestion');
  console.log('knowledge-suggestion emitted:', !!ks, ks ? `fact="${(ks.fact||'').slice(0,60)}"` : '');
  if (!ks) { console.log('  (agent did not emit affordance — gap-1 fire still weak; correlation untestable this run)'); }
  else {
    const h = factHash(ks.fact);
    await new Promise(r => setTimeout(r, 1200));
    const prop = await sql`SELECT payload->>'fact_hash' fh FROM memory_events WHERE project_id=${PID} AND event_type='knowledge_proposed' AND payload->>'fact_hash'=${h}`;
    console.log(`  knowledge_proposed event w/ fact_hash=${h}:`, prop.length ? 'RECORDED ✓' : 'MISSING ✗');
    // Apply the fact (mirror the inline card POST).
    const applyRes = await fetch(`${BASE}/api/projects/${PID}/knowledge`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-e2e-user': UID }, body: JSON.stringify({ title: ks.fact, kind: ks.kind || 'observation', apply: true, sources: ks.sources || [] }) });
    console.log('  apply POST →', applyRes.status);
    await new Promise(r => setTimeout(r, 800));
    const appl = await sql`SELECT COUNT(*)::int n FROM memory_events WHERE project_id=${PID} AND event_type='knowledge_applied' AND payload->>'fact_hash'=${h}`;
    console.log(`  knowledge_applied event w/ same fact_hash:`, appl[0].n > 0 ? 'LINKED ✓' : 'MISSING ✗');
    const open = await sql`SELECT COUNT(*)::int n FROM memory_events pi WHERE pi.project_id=${PID} AND pi.event_type='knowledge_proposed' AND pi.payload->>'fact_hash'=${h} AND NOT EXISTS (SELECT 1 FROM memory_events c WHERE c.project_id=pi.project_id AND c.event_type='knowledge_applied' AND c.payload->>'fact_hash'=pi.payload->>'fact_hash' AND c.created_at>=pi.created_at)`;
    console.log(`  open knowledge proposals for this fact AFTER apply: ${open[0].n} (expect 0)`);
  }

  console.log('\n=== GAP 8: uncited-prose meta flag (best-effort) ===');
  await chat('Give me one hard number: what share of food-delivery startups fail within 3 years? Just the percentage.');
  await new Promise(r => setTimeout(r, 1000));
  const meta = await sql`SELECT meta::text FROM chat_messages WHERE project_id=${PID} AND role='assistant' ORDER BY created_at DESC LIMIT 1`;
  const m = meta[0]?.meta || '';
  console.log('  latest assistant meta:', m || '(none)');
  console.log('  uncited_prose_claims flagged:', /uncited_prose_claims":true/.test(m) ? 'YES ✓ (wiring live)' : 'no (agent likely cited or hedged — flag is model-dependent)');
  await sql.end();
}
main().catch(async e => { console.error('FATAL', e.message); try { await sql.end(); } catch {} process.exit(1); });

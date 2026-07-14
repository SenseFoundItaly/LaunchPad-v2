#!/usr/bin/env node
/**
 * PR-A live verification: propose → click(run) → complete → correlate.
 * Cheap (one chat turn + one skill run). Targets an existing Stage-1 project
 * whose canvas prereqs are met and startup-scoring is un-run.
 */
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const BASE_URL = 'http://localhost:3001';
const USER_ID = 'cb05a0ea-720c-4795-b582-5b013e8f7572';
const PROJECT_ID = process.env.VERIFY_PROJECT_ID || 'proj_85c9be57-921';

for (const raw of fs.readFileSync(path.join('/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2', '.env.local'), 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const e = l.indexOf('='); if (e < 0) continue;
  const k = l.slice(0, e).trim(), v = l.slice(e + 1).trim().replace(/^['"]|['"]$/g, '');
  if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

function parseArtifacts(text) {
  const out = [];
  for (const [, h, b] of text.matchAll(/:::artifact\s*(\{[^\n]*?\})\s*\n([\s\S]*?)\n:::/g)) {
    try { out.push({ ...JSON.parse(h), ...JSON.parse(b.trim()) }); } catch {}
  }
  return out;
}

async function chatTurn(prompt) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER_ID },
    body: JSON.stringify({ project_id: PROJECT_ID, step: 'chat', messages: [{ role: 'user', content: prompt }] }),
  });
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = '', full = '';
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try { const p = JSON.parse(line.slice(6)); if (typeof p.content === 'string') full += p.content; if (p.done) return full; } catch {}
    }
  }
  return full;
}

async function main() {
  console.log(`project=${PROJECT_ID}`);
  const full = await chatTurn('I want to run the Startup Scoring skill now to get my baseline score.');
  const skillOpts = parseArtifacts(full).filter(a => a.type === 'option-set').flatMap(a => a.options || []).filter(o => o?.skill_id);
  console.log(`skill options surfaced: ${skillOpts.length}`);
  for (const o of skillOpts) console.log(`  - ${o.skill_id} proposal_id=${o.proposal_id ?? '(none)'}`);
  const opt = skillOpts.find(o => o.proposal_id) || skillOpts[0];
  if (!opt) { console.log('FAIL: no skill option surfaced'); await sql.end(); process.exit(1); }
  if (!opt.proposal_id) { console.log('WARN: option has no proposal_id — check skill-tools embedding'); }

  // Confirm the skill_invoked proposal row exists with this id.
  if (opt.proposal_id) {
    const inv = await sql`SELECT event_type, payload->>'skill_id' skill FROM memory_events WHERE id=${opt.proposal_id}`;
    console.log(`skill_invoked row: ${inv.length ? `${inv[0].event_type} skill=${inv[0].skill}` : 'NOT FOUND'}`);
  }

  // Click Run (thread proposal_id).
  const runBody = { skill_id: opt.skill_id, run: true };
  if (opt.proposal_id) runBody.proposal_id = opt.proposal_id;
  const runRes = await fetch(`${BASE_URL}/api/projects/${PROJECT_ID}/skills`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER_ID }, body: JSON.stringify(runBody),
  });
  const txt = await runRes.text();
  const finalLine = txt.split('\n').filter(l => l.startsWith('data: ')).pop();
  let done = null; try { done = finalLine ? JSON.parse(finalLine.slice(6)) : null; } catch {}
  console.log(`run → http=${runRes.status} status=${done?.status ?? '?'}`);

  // Correlation check.
  if (opt.proposal_id) {
    const linked = await sql`SELECT COUNT(*)::int n FROM memory_events WHERE project_id=${PROJECT_ID} AND event_type='skill_completed' AND payload->>'proposal_id'=${opt.proposal_id}`;
    console.log(`CORRELATION: skill_completed.proposal_id=${opt.proposal_id} → ${linked[0].n > 0 ? 'LINKED ✓' : 'MISSING ✗'}`);
  }
  // openProposals delta.
  const open = await sql`
    SELECT COUNT(*)::int n FROM memory_events pi WHERE pi.project_id=${PROJECT_ID} AND pi.event_type='skill_invoked'
      AND pi.payload->>'skill_id'=${opt.skill_id}
      AND NOT EXISTS (SELECT 1 FROM memory_events c WHERE c.project_id=pi.project_id AND c.event_type='skill_completed'
        AND c.payload->>'skill_id'=pi.payload->>'skill_id' AND c.created_at >= pi.created_at)`;
  console.log(`open proposals for ${opt.skill_id} AFTER run: ${open[0].n} (expect 0)`);
  const cost = await sql`SELECT ROUND(SUM(total_cost_usd)::numeric,4) usd, COUNT(*) n FROM llm_usage_logs WHERE project_id=${PROJECT_ID} AND skill_id=${opt.skill_id}`;
  console.log(`scoring run cost ≈ $${cost[0].usd} across ${cost[0].n} calls`);
  await sql.end();
}
main().catch(async (e) => { console.error('FATAL', e.message); try { await sql.end(); } catch {} process.exit(1); });

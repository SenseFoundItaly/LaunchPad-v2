/**
 * Live full-loop proof for Phase B (watcher → financial assumption revision):
 *   competitor signal accepted → propose_assumption_revision auto-created →
 *   apply → workflow.financial_model recomputed with the new ARPU.
 *
 * Run: dev server on :3005 with E2E_AUTH_ENABLED=1 and the Phase B code.
 *   npx tsx scripts/e2e-phaseb-check.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3005';
const userId = crypto.randomUUID();
const sql = postgres(process.env.DATABASE_URL as string, { prepare: false, max: 1 });

async function api(method: string, p: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${p}`, {
    method, headers: { 'Content-Type': 'application/json', 'x-e2e-user': userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch {}
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${(j?.error || t || '').slice(0, 160)}`);
  return j && j.success === true && 'data' in j ? j.data : j;
}
const list = (d: any) => (Array.isArray(d) ? d : d?.actions || d || []);

(async () => {
  console.log(`phaseb-check  base=${BASE}  user=${userId.slice(0, 8)}\n`);
  const pr = await api('POST', '/api/projects', { name: `E2E phaseb ${new Date().toISOString().slice(0, 16)}`, description: 'watcher→financial loop test', locale: 'en' });
  const pid = pr?.project_id || pr?.id;
  await api('POST', `/api/projects/${pid}/idea-canvas`, {
    problem: 'X', solution: 'A SaaS for clinics', target_market: 'SMB clinics',
    value_proposition: 'Save time', business_model: 'Per-seat SaaS at €49 per practitioner per month.',
  });
  console.log('project + canvas (ARPU €49) created');

  // synthetic competitor-pricing alert (the watcher signal)
  const monId = (await api('POST', `/api/projects/${pid}/monitors`, { name: 'Competitor pricing', objective: 'Track competitor pricing', schedule: 'weekly', type: 'general', kind: 'competitor' }))?.id;
  const aid = 'ea_' + crypto.randomUUID().slice(0, 12);
  await sql`INSERT INTO ecosystem_alerts (id, project_id, monitor_id, alert_type, source, source_url, headline, body, relevance_score, confidence, reviewed_state, created_at)
    VALUES (${aid}, ${pid}, ${monId ?? null}, 'competitor_activity', 'CompWatch', 'https://x.example', 'Rival raised pricing', 'Competitor now charges €69 per seat per month — up from €45.', 0.9, 0.85, 'pending', NOW())`;
  console.log('synthetic competitor alert inserted (€69/seat/mo)');

  // accept the signal → should auto-create a propose_assumption_revision
  let pending = list(await api('GET', `/api/projects/${pid}/actions?status=pending&action_type=signal_alert`));
  if (!pending.length) throw new Error('signal_alert did not materialize');
  await api('POST', `/api/projects/${pid}/actions/${pending[0].id}`, { transition: 'apply' });
  console.log('signal accepted');

  // the producer should have created the revision proposal
  const proposals = list(await api('GET', `/api/projects/${pid}/actions?status=pending&action_type=propose_assumption_revision`));
  const proposal = proposals[0];
  console.log(`\nproposal created? ${proposals.length ? 'YES' : 'NO'}${proposal ? ` — "${proposal.title}"` : ''}`);
  if (!proposal) throw new Error('FAIL: no propose_assumption_revision created from the competitor signal');
  const payload = proposal.payload || {};
  console.log(`  payload: field=${payload.field} value=${payload.value}`);

  // apply the proposal → model should recompute with arpu=69
  await api('POST', `/api/projects/${pid}/actions/${proposal.id}`, { transition: 'apply' });
  const wf: any = (await sql`SELECT (financial_model->'assumptions'->>'arpu_monthly') AS arpu, jsonb_array_length(financial_model->'scenarios') AS scen FROM workflow WHERE project_id=${pid}`)[0];
  console.log(`\nafter apply → financial_model.assumptions.arpu_monthly = ${wf?.arpu}, scenarios = ${wf?.scen}`);
  const ok = Number(wf?.arpu) === 69 && Number(wf?.scen) === 3;
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'} — watcher→financial loop ${ok ? 'recomputed the model at the new ARPU' : 'did not produce the expected model'}`);

  await sql`DELETE FROM projects WHERE id = ${pid}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
  await sql.end();
  process.exit(ok ? 0 : 1);
})().catch(async (e) => { console.error('ERROR:', e.message); try { await sql.end(); } catch {} process.exit(1); });

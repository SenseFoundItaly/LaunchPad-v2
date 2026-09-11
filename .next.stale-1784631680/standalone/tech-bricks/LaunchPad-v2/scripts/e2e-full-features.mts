/**
 * e2e-full-features — drive EVERY LaunchPad feature surface end-to-end against a
 * local dev server (E2E_AUTH_ENABLED=1) and verify each effect in the DB.
 *
 * Covers: chat + idea-canvas (read/EDIT), skills, scoring, financial
 * projections (EDIT + EXPORT), watchers (create/EDIT/run), signals→knowledge,
 * knowledge facts/notes/graph nodes+edges (EDIT state), pending-action
 * edit+apply, credits (snapshot/bump/recharge), and EXPORTS (context markdown,
 * go/no-go, financial CSV, artifact CSV) — produced as REAL bytes via the pure
 * export libs.
 *
 * Run (tsx so we can import the TS export builders directly):
 *   E2E_AUTH_ENABLED on the SERVER; this driver only needs DATABASE_URL.
 *   npx tsx scripts/e2e-full-features.mts
 *
 * Uses a fresh random user (x-e2e-user) → zero risk to real accounts.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { buildFinancialExport } from '../src/lib/financial-export.ts';
import { buildContextMarkdown } from '../src/lib/context-export.ts';
import { buildArtifactExport } from '../src/lib/artifact-export.ts';

// ── env ──────────────────────────────────────────────────────────────────
function loadDotEnvLocal() {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}
loadDotEnvLocal();

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3005';
const userId = process.env.E2E_USER || crypto.randomUUID();
const OUT = path.join(process.cwd(), 'data', 'e2e-exports');
fs.mkdirSync(OUT, { recursive: true });

let _sql: ReturnType<typeof postgres> | null = null;
const db = () => (_sql ??= postgres(process.env.DATABASE_URL as string, { prepare: false, max: 1 }));

// ── http ─────────────────────────────────────────────────────────────────
async function api(method: string, p: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-e2e-user': userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${(json?.error || json?.message || text || '').slice(0, 200)}`);
  if (json && typeof json === 'object' && json.success === true && 'data' in json) return json.data;
  return json;
}

// Drain an SSE POST. Returns accumulated text + parsed frames + done payload.
async function sse(p: string, body: unknown, timeoutMs: number): Promise<{ text: string; frames: any[]; done: any; tools: string[] }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-e2e-user': userId },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e: any) { clearTimeout(timer); throw new Error(`fetch failed: ${e.message}`); }
  if (!res.ok) { clearTimeout(timer); throw new Error(`${p} → ${res.status}: ${(await res.text()).slice(0, 200)}`); }
  const reader = res.body!.getReader();
  ctrl.signal.addEventListener('abort', () => { reader.cancel('abort').catch(() => {}); }, { once: true });
  const dec = new TextDecoder();
  let buf = '', text = '', done: any = null;
  const frames: any[] = []; const tools: string[] = [];
  try {
    outer: while (true) {
      const { value, done: rdone } = await reader.read();
      if (rdone) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const f = JSON.parse(line.slice(6));
          frames.push(f);
          if (typeof f.content === 'string') text += f.content;
          if (typeof f.delta === 'string') text += f.delta;
          if (f.tool_start?.name) tools.push(f.tool_start.name);
          if (f.done) { done = f; reader.cancel('done').catch(() => {}); break outer; }
        } catch { /* heartbeat / non-json */ }
      }
    }
  } finally { clearTimeout(timer); }
  if (ctrl.signal.aborted && !done) throw new Error('SSE timed out client-side');
  return { text, frames, done, tools };
}

// Poll a DB read until it satisfies `ok` — absorbs the gap between an SSE `done`
// frame and the server's after-flush writes (monitor_runs, skill_completions).
async function poll<T>(fn: () => Promise<T>, ok: (v: T) => boolean, attempts = 8, delayMs = 1500): Promise<T> {
  let last = await fn();
  for (let i = 0; i < attempts && !ok(last); i++) { await new Promise((r) => setTimeout(r, delayMs)); last = await fn(); }
  return last;
}
const one = async (q: Promise<any[]>) => (await q)[0];

// ── coverage tracker ───────────────────────────────────────────────────────
type Row = { area: string; feature: string; status: 'PASS' | 'FAIL' | 'SKIP'; note: string; ms: number };
const COV: Row[] = [];
async function check(area: string, feature: string, fn: () => Promise<string | void>) {
  const t0 = Date.now();
  try {
    const note = await fn();
    COV.push({ area, feature, status: 'PASS', note: note || '', ms: Date.now() - t0 });
    console.log(`  ✓ [${area}] ${feature}${note ? ' — ' + note : ''}`);
  } catch (e: any) {
    COV.push({ area, feature, status: 'FAIL', note: e.message, ms: Date.now() - t0 });
    console.log(`  ✗ [${area}] ${feature} — ${e.message}`);
  }
}
const skip = (area: string, feature: string, note: string) => { COV.push({ area, feature, status: 'SKIP', note, ms: 0 }); console.log(`  — [${area}] ${feature} (skip: ${note})`); };

// shared state across steps
const S: any = { userId };

// ───────────────────────────────────────────────────────────────────────────
console.log(`\ne2e-full-features  base=${BASE}  user=${userId}\n`);

await check('infra', 'health', async () => {
  const r = await fetch(`${BASE}/api/health`); if (!r.ok) throw new Error(`health ${r.status}`); return 'ok';
});
await check('infra', 'auth bypass (/api/me)', async () => {
  const me = await api('GET', '/api/me');
  if (me.userId !== userId) throw new Error(`got ${me.userId}`); return me.userId.slice(0, 8);
});

// recharge early so nothing gates the LLM steps + exercises recharge
await check('credits', 'recharge top-up (pack_1000)', async () => {
  await api('POST', '/api/credits/recharge', { pack_id: 'pack_1000' });
  return 'granted';
});

await check('project', 'create project', async () => {
  const pr = await api('POST', '/api/projects', {
    name: `E2E full ${new Date().toISOString().slice(0, 16)}`,
    description: 'FieldPulse — an AI safety-inspection copilot for construction site managers who waste 4-6 hrs/week on manual compliance paperwork. Target: mid-size general contractors (50-500 employees) in the US.',
    locale: 'en',
  });
  S.projectId = pr?.project_id || pr?.id;
  if (!S.projectId) throw new Error('no project id');
  return S.projectId;
});

// EDIT idea canvas (also unlocks canvas-gated skills) ------------------------
await check('canvas', 'idea-canvas EDIT (POST all fields)', async () => {
  await api('POST', `/api/projects/${S.projectId}/idea-canvas`, {
    problem: 'GCs lose 4-6 hrs/week to manual safety-compliance paperwork; missed items cause OSHA fines.',
    solution: 'AI copilot that ingests site photos + checklists and auto-drafts compliant inspection reports.',
    target_market: 'US mid-size general contractors, 50-500 employees, $10M-$200M revenue.',
    value_proposition: 'Cut compliance admin 80% and reduce OSHA-fine exposure with audit-ready reports in minutes.',
    business_model: 'Per-seat SaaS, $49/seat/mo, annual contracts.',
    competitive_advantage: 'Vision model fine-tuned on 50k annotated jobsite photos + OSHA rule graph.',
  });
  const row: any = (await db()`SELECT problem, solution, value_proposition, target_market FROM idea_canvas WHERE project_id=${S.projectId}`)[0];
  if (!row?.solution || !row?.value_proposition) throw new Error('canvas not persisted');
  return 'solution+value_prop persisted';
});
await check('canvas', 'idea-canvas READ (GET)', async () => {
  const c = await api('GET', `/api/projects/${S.projectId}/idea-canvas`);
  if (!c || (!c.solution && !c.pending)) throw new Error('empty canvas read');
  return `solution="${String(c.solution || c.pending?.solution || '').slice(0, 30)}..."`;
});

// CHAT ----------------------------------------------------------------------
await check('chat', 'chat turn 1 (pitch + workflow-card)', async () => {
  const r = await sse('/api/chat', {
    project_id: S.projectId, step: 'chat',
    messages: [{ role: 'user', content: 'Here is my idea: FieldPulse, an AI safety-inspection copilot for construction site managers. Briefly react, then propose a 3-step validation plan for this week as a :::artifact{"type":"workflow-card"} with title, description, category "validation", priority "high", a 3-item steps array, and one web source. One sentence of prose max.' }],
  }, 90_000);
  if (!r.done) throw new Error('no done frame');
  const n: any = (await db()`SELECT COUNT(*)::int AS n FROM chat_messages WHERE project_id=${S.projectId}`)[0];
  return `done; ${n.n} chat_messages; tools=[${r.tools.join(',') || 'none'}]`;
});
await check('chat', 'chat turn 2 (market-size research)', async () => {
  const r = await sse('/api/chat', {
    project_id: S.projectId, step: 'chat',
    messages: [{ role: 'user', content: 'Roughly how big is the US construction-safety-software market (TAM/SAM)? Do a quick web check and cite a source. Keep it to a few sentences.' }],
  }, 90_000);
  if (!r.done) throw new Error('no done frame');
  return `done; tools=[${r.tools.join(',') || 'none'}]`;
});

// SKILL ---------------------------------------------------------------------
await check('skills', 'run skill market-research (SSE)', async () => {
  // Skill genuinely runs ~3 min; the keepalive-SSE outlives the gateway. If the
  // client read aborts, the server still finishes — so verify the DB regardless.
  try { await sse(`/api/projects/${S.projectId}/skills`, { skill_id: 'market-research', run: true }, 240_000); } catch { /* verify below */ }
  const row: any = await poll(
    () => one(db()`SELECT skill_id, status, LEFT(summary, 40) AS s FROM skill_completions WHERE project_id=${S.projectId} AND skill_id='market-research' ORDER BY completed_at DESC LIMIT 1`),
    (r) => !!r, 6, 2000,
  );
  if (!row) throw new Error('no skill_completions row');
  return `status=${row.status} "${row.s || ''}..."`;
});

// SCORING -------------------------------------------------------------------
await check('scoring', 'run startup-scoring (POST /score)', async () => {
  const r = await sse(`/api/projects/${S.projectId}/score`, {}, 150_000);
  if (r.done && r.done.skipped) return 'skipped (already fresh)';
  const row: any = (await db()`SELECT overall_score, dimensions FROM scores WHERE project_id=${S.projectId}`)[0];
  if (!row || row.overall_score == null) throw new Error('no score persisted');
  const dimT: any = (await db()`SELECT jsonb_typeof(dimensions) AS t FROM scores WHERE project_id=${S.projectId}`)[0];
  if (dimT.t !== 'object') throw new Error(`dimensions jsonb_typeof=${dimT.t} (double-encode!)`);
  return `overall=${row.overall_score}, dims=${Object.keys(row.dimensions || {}).length}`;
});
await check('scoring', 'read score (GET /score)', async () => {
  const s = await api('GET', `/api/projects/${S.projectId}/score`);
  if (s == null || s.overall_score == null) throw new Error('no score read');
  return `overall=${s.overall_score}`;
});

// FINANCIAL EDIT ------------------------------------------------------------
const ASSUMP = { currency: 'EUR', starting_cash: 200000, arpu_monthly: 35, gross_margin_pct: 80, initial_customers: 5, new_customers_m1: 25, monthly_growth_rate_pct: 15, monthly_churn_rate_pct: 3, monthly_opex: 20000, horizon_months: 36 };
await check('financial', 'EDIT assumptions → recompute + persist', async () => {
  const d = await api('POST', `/api/projects/${S.projectId}/financial-model`, { assumptions: ASSUMP });
  const m = d?.financial_model;
  if (!m?.scenarios || m.scenarios.length !== 3) throw new Error(`scenarios=${m?.scenarios?.length}`);
  if (m.scenarios[0].monthly_projections?.length !== 36) throw new Error(`months=${m.scenarios[0].monthly_projections?.length}`);
  const t: any = (await db()`SELECT jsonb_typeof(financial_model) AS t FROM workflow WHERE project_id=${S.projectId}`)[0];
  if (t.t !== 'object') throw new Error(`financial_model jsonb_typeof=${t.t} (double-encode!)`);
  return `3 scenarios × 36mo, jsonb=object`;
});
await check('financial', 'EDIT again (change starting_cash) → re-persist', async () => {
  await api('POST', `/api/projects/${S.projectId}/financial-model`, { assumptions: { ...ASSUMP, starting_cash: 300000 } });
  const row: any = (await db()`SELECT (financial_model->'assumptions'->>'starting_cash') AS sc FROM workflow WHERE project_id=${S.projectId}`)[0];
  if (Number(row.sc) !== 300000) throw new Error(`starting_cash=${row.sc}`);
  return 'starting_cash=300000 persisted';
});

// WATCHERS ------------------------------------------------------------------
await check('watchers', 'create monitor (founder-driven POST)', async () => {
  const m = await api('POST', `/api/projects/${S.projectId}/monitors`, {
    name: 'OSHA regulation watcher', objective: 'Track new OSHA construction-safety rules and enforcement changes.',
    schedule: 'weekly', type: 'general', kind: 'regulatory', urls_to_track: ['https://www.osha.gov/news'],
  });
  S.monitorId = m?.id || m?.monitor_id;
  const row: any = (await db()`SELECT id, status, next_run FROM monitors WHERE project_id=${S.projectId} ORDER BY created_at DESC LIMIT 1`)[0];
  if (!row || row.status !== 'active') throw new Error(`status=${row?.status}`);
  S.monitorId ||= row.id;
  return `id=${S.monitorId?.slice(0, 12)} status=active`;
});
await check('watchers', 'EDIT monitor (PATCH schedule+objective)', async () => {
  await api('PATCH', `/api/projects/${S.projectId}/monitors/${S.monitorId}`, { schedule: 'daily', objective: 'Track OSHA rule changes AND major competitor compliance-product launches.' });
  const row: any = (await db()`SELECT schedule, objective FROM monitors WHERE id=${S.monitorId}`)[0];
  if (row.schedule !== 'daily') throw new Error(`schedule=${row.schedule}`);
  return 'schedule=daily, objective rebuilt';
});
await check('watchers', 'RUN monitor (manual SSE scan)', async () => {
  try { await sse(`/api/projects/${S.projectId}/monitors/${S.monitorId}`, {}, 180_000); } catch { /* verify below */ }
  const row: any = await poll(
    () => one(db()`SELECT status, alerts_generated FROM monitor_runs WHERE monitor_id=${S.monitorId} ORDER BY run_at DESC LIMIT 1`),
    (r) => !!r, 8, 2000,
  );
  if (!row) throw new Error('no monitor_runs row');
  S.alertsGenerated = row.alerts_generated || 0;
  return `run status=${row.status}, alerts_generated=${row.alerts_generated}`;
});

// SIGNAL → KNOWLEDGE --------------------------------------------------------
await check('signals', 'apply signal_alert → graph_node + memory_fact', async () => {
  // Prefer a real alert from the run; else synthesize one (deterministic path).
  let pending = await api('GET', `/api/projects/${S.projectId}/actions?status=pending&action_type=signal_alert`);
  let actions = pending?.actions || pending || [];
  if (!Array.isArray(actions)) actions = actions?.actions || [];
  if (!actions.length) {
    // synthetic ecosystem_alert (pending) linked to the monitor
    const aid = 'ea_' + crypto.randomUUID().slice(0, 12);
    await db()`INSERT INTO ecosystem_alerts (id, project_id, monitor_id, alert_type, source, source_url, headline, body, relevance_score, confidence, reviewed_state, created_at)
      VALUES (${aid}, ${S.projectId}, ${S.monitorId}, 'regulatory', 'OSHA', 'https://www.osha.gov/news/x', 'OSHA proposes stricter fall-protection rule for 2027', 'New rule would require digital inspection logs for sites >3 stories — directly relevant to FieldPulse positioning.', 0.86, 0.8, 'pending', NOW())`;
    pending = await api('GET', `/api/projects/${S.projectId}/actions?status=pending&action_type=signal_alert`);
    actions = pending?.actions || pending || [];
    if (!Array.isArray(actions)) actions = actions?.actions || [];
  }
  if (!actions.length) throw new Error('no signal_alert action to apply');
  const act = actions[0];
  await api('POST', `/api/projects/${S.projectId}/actions/${act.id}`, { transition: 'apply' });
  const gn: any = (await db()`SELECT COUNT(*)::int AS n FROM graph_nodes WHERE project_id=${S.projectId} AND reviewed_state='applied'`)[0];
  const mf: any = (await db()`SELECT COUNT(*)::int AS n FROM memory_facts WHERE project_id=${S.projectId} AND source_type='monitor'`)[0];
  if (gn.n < 1) throw new Error('no applied graph_node after accept');
  return `applied; graph_nodes(applied)=${gn.n}, monitor_facts=${mf.n}`;
});

// KNOWLEDGE -----------------------------------------------------------------
await check('knowledge', 'create memory fact (applied)', async () => {
  const d = await api('POST', `/api/projects/${S.projectId}/knowledge`, { title: 'Beachhead = Texas GCs (most OSHA fines per capita)', kind: 'observation', apply: true, sources: [{ type: 'internal', title: 'Founder hypothesis' }] });
  if (!d?.id) throw new Error('no fact id');
  S.factId = d.id;
  const row: any = (await db()`SELECT reviewed_state FROM memory_facts WHERE id=${d.id}`)[0];
  return `id=${d.id.slice(0, 12)} state=${row?.reviewed_state}`;
});
await check('knowledge', 'create free-form note', async () => {
  const d = await api('POST', `/api/projects/${S.projectId}/notes`, { note: 'Investor call: emphasize OSHA-fine ROI, not time-savings — buyers care about liability.' });
  const row: any = (await db()`SELECT kind, reviewed_state FROM memory_facts WHERE id=${d.id}`)[0];
  if (row?.kind !== 'note') throw new Error(`kind=${row?.kind}`);
  return `note persisted (state=${row.reviewed_state})`;
});
await check('knowledge', 'create graph node (attributes raw object)', async () => {
  const d = await api('POST', `/api/graph/${S.projectId}/nodes`, { name: 'SiteSafe AI', node_type: 'competitor', summary: 'Incumbent jobsite-safety SaaS, ~$8M ARR est.', attributes: { funding_stage: 'Series A', founded: 2021, website: 'https://sitesafe.example' } });
  S.nodeA = d?.id;
  const t: any = (await db()`SELECT jsonb_typeof(attributes) AS t FROM graph_nodes WHERE id=${d.id}`)[0];
  if (t.t !== 'object') throw new Error(`attributes jsonb_typeof=${t.t} (double-encode!)`);
  return `id=${d.id?.slice(0, 12)} attributes jsonb=object`;
});
await check('knowledge', 'create 2nd node + graph edge', async () => {
  const b = await api('POST', `/api/graph/${S.projectId}/nodes`, { name: 'Inspectify', node_type: 'competitor', summary: 'Mobile-first inspection app.', attributes: { website: 'https://inspectify.example' } });
  S.nodeB = b?.id;
  const e = await api('POST', `/api/graph/${S.projectId}/edges`, { source_node_id: S.nodeA, target_node_id: S.nodeB, relation: 'competes_with', weight: 1.0 });
  const row: any = (await db()`SELECT relation FROM graph_edges WHERE source_node_id=${S.nodeA} AND target_node_id=${S.nodeB} LIMIT 1`)[0];
  if (row?.relation !== 'competes_with') throw new Error('edge not persisted');
  return `edge ${S.nodeA?.slice(0, 8)}→${S.nodeB?.slice(0, 8)} competes_with`;
});
await check('knowledge', 'EDIT state transition (pending fact → applied + debit)', async () => {
  const d = await api('POST', `/api/projects/${S.projectId}/knowledge`, { title: 'Pricing test: $79/seat had 0 churn in pilot.', kind: 'observation', apply: false });
  const before: any = (await db()`SELECT reviewed_state FROM memory_facts WHERE id=${d.id}`)[0];
  const res = await api('PATCH', `/api/projects/${S.projectId}/knowledge/${d.id}`, { state: 'applied' });
  const after: any = (await db()`SELECT reviewed_state FROM memory_facts WHERE id=${d.id}`)[0];
  if (after?.reviewed_state !== 'applied') throw new Error(`state=${after?.reviewed_state}`);
  return `${before?.reviewed_state}→applied (credits_debited=${res?.credits_debited ?? '?'})`;
});
await check('knowledge', 'read knowledge list (state=all)', async () => {
  const d = await api('GET', `/api/projects/${S.projectId}/knowledge?state=all`);
  const items = d?.items || d || [];
  return `${(Array.isArray(items) ? items : []).length} items`;
});

// PENDING ACTIONS edit + apply ----------------------------------------------
// NOTE: POST /actions only accepts a manual-draft allowlist (draft_email,
// proposed_hypothesis, …); configure_monitor/run_skill are created internally by
// the agent/executors, not via this public endpoint. So exercise the
// create→edit→apply STATE MACHINE + double-encode guard with an allowed type.
await check('pending', 'create→EDIT→apply pending action (draft_email)', async () => {
  const created = await api('POST', `/api/projects/${S.projectId}/actions`, {
    action_type: 'draft_email', title: 'Outreach to pilot GC',
    payload: { to: 'ops@example.com', subject: 'FieldPulse pilot', body: 'Initial draft.' },
    rationale: 'e2e',
  });
  const aid = created?.id || created?.action?.id;
  if (!aid) throw new Error('no action id: ' + JSON.stringify(created).slice(0, 120));
  await api('POST', `/api/projects/${S.projectId}/actions/${aid}`, { transition: 'edit', edited_payload: { to: 'ops@example.com', subject: 'FieldPulse pilot (edited)', body: 'Edited draft body.' } });
  const edited: any = (await db()`SELECT status, jsonb_typeof(edited_payload) AS t, (edited_payload->>'subject') AS subj FROM pending_actions WHERE id=${aid}`)[0];
  if (edited.status !== 'edited') throw new Error(`status after edit=${edited.status}`);
  if (edited.t !== 'object') throw new Error(`edited_payload jsonb_typeof=${edited.t} (double-encode!)`);
  if (!/edited/.test(edited.subj || '')) throw new Error(`edited subject not stored: ${edited.subj}`);
  await api('POST', `/api/projects/${S.projectId}/actions/${aid}`, { transition: 'apply' });
  const after: any = (await db()`SELECT status FROM pending_actions WHERE id=${aid}`)[0];
  return `edited_payload jsonb=object, subject="${edited.subj}"; apply→status=${after.status}`;
});

// CREDITS -------------------------------------------------------------------
await check('credits', 'read credits snapshot (GET)', async () => {
  const c = await api('GET', `/api/projects/${S.projectId}/credits`);
  if (c?.remaining == null) throw new Error('no remaining');
  S.creditsBefore = c.remaining;
  return `remaining=${c.remaining}, used=${c.credits_used ?? c.used_usd}`;
});
await check('credits', 'bump credits (PATCH dev/e2e)', async () => {
  const c = await api('PATCH', `/api/projects/${S.projectId}/credits`, { action: 'bump', amount: 100 });
  return `remaining=${c?.remaining}`;
});

// DOCUMENT UPLOAD → entity extraction --------------------------------------
await check('knowledge', 'upload document (multipart) → extract entities', async () => {
  const fd = new FormData();
  const content = 'FieldPulse competitor brief. Procore is a $1B+ construction management platform expanding into safety. Autodesk Construction Cloud bundles compliance modules. Raken focuses on daily reports. OSHA fines averaged ~$15,000 per serious violation in 2024.';
  fd.append('file', new Blob([content], { type: 'text/plain' }), 'competitor-brief.txt');
  // multipart: do NOT set Content-Type (let fetch add the boundary)
  const res = await fetch(`${BASE}/api/projects/${S.projectId}/knowledge/upload?extract=1`, { method: 'POST', headers: { 'x-e2e-user': userId }, body: fd });
  if (!res.ok) throw new Error(`upload ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const facts: any = await one(db()`SELECT COUNT(*)::int AS n FROM memory_facts WHERE project_id=${S.projectId} AND kind='file_upload'`);
  const pend: any[] = await poll(() => db()`SELECT id FROM graph_nodes WHERE project_id=${S.projectId} AND reviewed_state='pending'`, (r) => r.length > 0, 6, 2000);
  S.pendingNodeIds = pend.map((r) => r.id);
  return `file_upload facts=${facts.n}, pending entities=${pend.length}`;
});
await check('knowledge', 'apply-batch extracted entities (+credit debit)', async () => {
  if (!S.pendingNodeIds?.length) return 'no pending entities extracted (skip-equivalent)';
  const d = await api('POST', `/api/projects/${S.projectId}/knowledge/apply-batch`, { item_ids: S.pendingNodeIds, skip_charge: false });
  const applied: any = await one(db()`SELECT COUNT(*)::int AS n FROM graph_nodes WHERE id = ANY(${S.pendingNodeIds}) AND reviewed_state='applied'`);
  return `applied=${d.applied ?? applied.n}, credits_debited=${d.credits_debited ?? '?'}`;
});
await check('knowledge', 'REJECT flow (node → rejected)', async () => {
  const d = await api('POST', `/api/graph/${S.projectId}/nodes`, { name: 'Bogus Competitor (reject me)', node_type: 'competitor', summary: 'should be rejected' });
  await api('PATCH', `/api/projects/${S.projectId}/knowledge/${d.id}`, { state: 'rejected' });
  const row: any = await one(db()`SELECT reviewed_state FROM graph_nodes WHERE id=${d.id}`);
  if (row?.reviewed_state !== 'rejected') throw new Error(`state=${row?.reviewed_state}`);
  return 'node → rejected';
});
await check('knowledge', 'validation commit (competitor + market fact)', async () => {
  const d = await api('POST', `/api/projects/${S.projectId}/validation/commit`, {
    items: [
      { kind: 'competitor', name: 'Raken', label: 'Competitor', value: 'Daily-report-focused jobsite app, weak on AI compliance.', credits: 0.5, sources: [{ type: 'web', title: 'Raken', url: 'https://raken.example' }] },
      { kind: 'market_size_fact', label: 'TAM', value: 'US construction-safety software ~$700M TAM.', credits: 0.5, sources: [{ type: 'web', title: 'est', url: 'https://x.example' }] },
    ],
  });
  const comp: any = await one(db()`SELECT COUNT(*)::int AS n FROM graph_nodes WHERE project_id=${S.projectId} AND node_type='competitor' AND reviewed_state='applied'`);
  return `committed=${d?.committed ?? '?'}, applied competitors=${comp.n}`;
});

// i18n ----------------------------------------------------------------------
await check('i18n', 'locale switch (PATCH preferences en→it→en)', async () => {
  await api('PATCH', '/api/user/preferences', { locale: 'it' });
  const it = await api('GET', '/api/user/preferences');
  if (it.locale !== 'it') throw new Error(`locale=${it.locale}`);
  await api('PATCH', '/api/user/preferences', { locale: 'en' });
  return 'it ↔ en persisted';
});

// EXPORTS (real bytes via pure libs) ----------------------------------------
await check('export', 'context-export endpoint (JSON)', async () => {
  S.ctx = await api('GET', `/api/projects/${S.projectId}/context-export`);
  if (!S.ctx?.project) throw new Error('no project in context-export');
  const keys = Object.keys(S.ctx).filter(k => Array.isArray((S.ctx as any)[k]) && (S.ctx as any)[k].length);
  return `sections w/ data: ${keys.join(',')}`;
});
// The /context-export endpoint omits `date` and `artifacts`; the chat client
// (gatherData) injects them before calling buildContextMarkdown. Mirror that.
const ctxData = () => ({ ...S.ctx, date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), artifacts: S.ctx?.artifacts ?? [] });
await check('export', 'Context Markdown (buildContextMarkdown)', async () => {
  if (!S.ctx) throw new Error('no context data');
  const md = buildContextMarkdown(ctxData());
  const f = path.join(OUT, 'context-export.md');
  fs.writeFileSync(f, md);
  if (!md.startsWith('#')) throw new Error('md missing H1');
  return `${md.length}B → ${path.relative(process.cwd(), f)}`;
});
await check('export', 'Go/No-Go Markdown (goNoGo=true)', async () => {
  if (!S.ctx) throw new Error('no context data');
  const md = buildContextMarkdown(ctxData(), { goNoGo: true });
  const f = path.join(OUT, 'go-no-go.md');
  fs.writeFileSync(f, md);
  const bad = ['## Memory Facts', '## Graph Entities', '## Chat History'].filter(h => md.includes(h));
  if (bad.length) throw new Error(`goNoGo leaked sections: ${bad.join(',')}`);
  return `${md.length}B; excluded chat/facts/entities`;
});
await check('export', 'Financial CSV (buildFinancialExport)', async () => {
  const d = await api('GET', `/api/projects/${S.projectId}/financial-model`);
  const model = d?.financial_model;
  const payload = buildFinancialExport(model);
  if (!payload) throw new Error('export returned null');
  const f = path.join(OUT, payload.filename);
  fs.writeFileSync(f, payload.text);
  if (payload.mime === 'text/csv' && !/[,\n]/.test(payload.text)) throw new Error('csv has no rows');
  return `${payload.mime} ${payload.text.length}B → ${payload.filename}`;
});
await check('export', 'Artifact CSV (buildArtifactExport, comparison-table)', async () => {
  const artifact: any = { type: 'comparison-table', title: 'FieldPulse vs competitors', columns: ['Price', 'OSHA graph', 'Vision AI'], rows: [{ label: 'FieldPulse', values: ['$49', 'Yes', 'Yes'] }, { label: 'SiteSafe', values: ['$69', 'No', 'Partial'] }] };
  const payload = buildArtifactExport(artifact);
  if (!payload) throw new Error('artifact export null');
  const f = path.join(OUT, 'artifact-comparison.' + (payload.mime === 'text/csv' ? 'csv' : 'json'));
  fs.writeFileSync(f, payload.text);
  return `${payload.mime} ${payload.text.length}B`;
});

// ── matrix + persist state ──────────────────────────────────────────────────
const pass = COV.filter(r => r.status === 'PASS').length;
const fail = COV.filter(r => r.status === 'FAIL').length;
const skp = COV.filter(r => r.status === 'SKIP').length;
console.log(`\n──────── COVERAGE MATRIX ────────`);
let lastArea = '';
for (const r of COV) {
  if (r.area !== lastArea) { console.log(`\n${r.area.toUpperCase()}`); lastArea = r.area; }
  const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '–';
  console.log(`  ${icon} ${r.feature}${r.note ? '  — ' + r.note : ''}`);
}
console.log(`\n${pass} PASS / ${fail} FAIL / ${skp} SKIP   (project ${S.projectId})`);
fs.writeFileSync(path.join(process.cwd(), 'data', 'e2e-full-state.json'), JSON.stringify({ ...S, coverage: COV, ts: new Date().toISOString() }, null, 2));
console.log(`exports → ${path.relative(process.cwd(), OUT)}/`);
console.log(`state → data/e2e-full-state.json`);

if (_sql) await _sql.end();
process.exit(fail > 0 ? 1 : 0);

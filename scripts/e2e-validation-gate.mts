/**
 * E2E proof of the L2 Phase-1 Validation Gate alignment (Batch 4):
 *
 *   1. seed a Stage-1-complete project      → stage 2 active + 1C LOCKED
 *      (with a junk 0-score row first       → Stage-1 baseline stays RED)
 *   2. one chat turn                        → phase1_auto watcher proposals land
 *   3. second chat turn                     → NO new proposals (idempotent)
 *   4. apply one proposal                   → monitors_set green
 *   5. seed 1A+1B evidence                  → 1C UNLOCKED
 *   6. log 5 interviews (2 with WTP)        → stage 2 done
 *
 * Run: dev server on :3005 with E2E_AUTH_ENABLED=1 and real LLM keys
 * (the watcher proposer makes one Sonnet call).
 *   npx tsx scripts/e2e-validation-gate.mts
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';

function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}
loadEnv();

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3005';
const userId = crypto.randomUUID();
const sql = postgres(process.env.DATABASE_URL as string, { prepare: false, max: 1 });

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function api(method: string, p: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${p}`, {
    method, headers: { 'Content-Type': 'application/json', 'x-e2e-user': userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { /* sse */ }
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${(j?.error || t || '').slice(0, 160)}`);
  return j && j.success === true && 'data' in j ? j.data : j;
}

async function chat(projectId: string, content: string): Promise<string> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-e2e-user': userId },
    body: JSON.stringify({ project_id: projectId, step: 'chat', messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error(`/api/chat ${res.status}`);
  const reader = res.body!.getReader(); const dec = new TextDecoder();
  let buf = '', text = '';
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try { const f = JSON.parse(line.slice(6)); if (typeof f.content === 'string') text += f.content; if (f.done) { reader.cancel(); return text; } } catch { /* */ }
    }
  }
  return text;
}

interface CheckRow { check: { id: string; track?: string }; result: { passed: boolean; locked?: boolean } }
interface StageEval { stage: { id: string; number: number }; status: string; results: CheckRow[] }

async function gateEval(projectId: string): Promise<StageEval> {
  const data = await api('GET', `/api/projects/${projectId}/stages`);
  const gate = (data.evaluations as StageEval[]).find((e) => e.stage.id === 'market_validation');
  if (!gate) throw new Error('market_validation stage missing from /stages');
  return gate;
}

function result(gate: StageEval, checkId: string): CheckRow['result'] {
  const row = gate.results.find((r) => r.check.id === checkId);
  if (!row) throw new Error(`check ${checkId} missing`);
  return row.result;
}

async function phase1Proposals(projectId: string) {
  return sql<{ id: string; action_type: string; status: string }[]>`
    SELECT id, action_type, status FROM pending_actions
    WHERE project_id = ${projectId} AND payload->>'origin' = 'phase1_auto'
    ORDER BY created_at`;
}

async function pollPhase1(projectId: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const rows = await phase1Proposals(projectId);
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return phase1Proposals(projectId);
}

(async () => {
  console.log(`validation-gate e2e  base=${BASE}  user=${userId.slice(0, 8)}\n`);

  // ── 1. Stage-1-complete project (all 9 Phase-0 checks + baseline score) ────
  const pr = await api('POST', '/api/projects', {
    name: `E2E gate ${new Date().toISOString().slice(0, 16)}`,
    description: 'L2 Phase-1 validation-gate walkthrough.',
    locale: 'en',
  });
  const projectId = pr?.project_id || pr?.id;

  await sql`
    INSERT INTO idea_canvas (project_id, problem, solution, target_market, value_proposition,
                             competitive_advantage, unfair_advantage, business_model, channels,
                             key_metrics, revenue_streams, cost_structure)
    VALUES (${projectId},
            'Small dental practices lose hours every week to fully manual patient recall management.',
            'A cloud recall automation tool for dental practices',
            'Italian dental practices with 1-5 chairs',
            'Save 5+ staff hours per week on recalls',
            'Mobile-first and integrates with the big two practice suites',
            'Proprietary recall-outcome dataset',
            'SaaS subscription per practice',
            'Dental associations and supplier partnerships',
            ${sql.json(['recalls booked / week'])},
            ${sql.json(['subscriptions'])},
            ${sql.json(['cloud infra', 'support'])})
    ON CONFLICT (project_id) DO UPDATE SET problem = EXCLUDED.problem, solution = EXCLUDED.solution,
      target_market = EXCLUDED.target_market, value_proposition = EXCLUDED.value_proposition,
      competitive_advantage = EXCLUDED.competitive_advantage, unfair_advantage = EXCLUDED.unfair_advantage,
      business_model = EXCLUDED.business_model, channels = EXCLUDED.channels,
      key_metrics = EXCLUDED.key_metrics, revenue_streams = EXCLUDED.revenue_streams,
      cost_structure = EXCLUDED.cost_structure`;
  // Zero-score guard first: a junk 0-score row (the chat radar-chart class,
  // 3 in prod) must NOT green the Stage-1 baseline nor advance the spine.
  await sql`
    INSERT INTO scores (project_id, overall_score, scored_at) VALUES (${projectId}, 0, NOW())
    ON CONFLICT (project_id) DO UPDATE SET overall_score = 0`;
  const zeroStages = await api('GET', `/api/projects/${projectId}/stages`);
  const s1 = (zeroStages.evaluations as StageEval[]).find((e) => e.stage.id === 'idea_validation');
  const zeroBaseline = s1?.results.find((r) => r.check.id === 'startup_scoring_baseline');
  check('0-score row does NOT green the Stage-1 baseline', zeroBaseline?.result.passed === false);
  check('stage 1 still active on a 0-score row', zeroStages.active_stage_number === 1, `active=${zeroStages.active_stage_number}`);

  await sql`
    INSERT INTO scores (project_id, overall_score, scored_at) VALUES (${projectId}, 6.5, NOW())
    ON CONFLICT (project_id) DO UPDATE SET overall_score = 6.5`;

  let stages = await api('GET', `/api/projects/${projectId}/stages`);
  check('stage 2 (Validation Gate) is active', stages.active_stage_number === 2, `active=${stages.active_stage_number}`);
  let gate = await gateEval(projectId);
  check('1C interviews_logged is LOCKED', result(gate, 'interviews_logged').locked === true);
  check('1C wtp_signal is LOCKED', result(gate, 'wtp_signal').locked === true);
  check('1B tech_feasibility is open (not locked)', !result(gate, 'tech_feasibility').locked);

  // ── 2. chat turn → phase1_auto proposals (fire-and-forget, so poll) ────────
  await chat(projectId, 'Where do we stand? What should I validate next?');
  const proposals = await pollPhase1(projectId, 90_000);
  check('phase1_auto watcher proposals created', proposals.length > 0, `count=${proposals.length}`);
  check('proposals are pending (approve-first, nothing auto-activated)', proposals.every((p) => p.status === 'pending'));
  const activeBefore = await sql`
    SELECT (SELECT COUNT(*) FROM monitors WHERE project_id = ${projectId} AND status = 'active')::int
         + (SELECT COUNT(*) FROM watch_sources WHERE project_id = ${projectId} AND status = 'active')::int AS n`;
  check('zero ACTIVE watchers before approval', Number(activeBefore[0].n) === 0);

  // ── 3. second chat turn → idempotent (no new proposals) ────────────────────
  await chat(projectId, 'Thanks. Anything else on the market side?');
  await new Promise((r) => setTimeout(r, 20_000)); // give a would-be duplicate run time to land
  const after2 = await phase1Proposals(projectId);
  check('2nd turn creates NO new proposals (idempotent)', after2.length === proposals.length, `before=${proposals.length} after=${after2.length}`);

  // ── 4. approve one proposal → active watcher → monitors_set green ─────────
  const target = after2[0];
  await api('POST', `/api/projects/${projectId}/actions/${target.id}`, { transition: 'apply' });
  const activeAfter = await sql`
    SELECT (SELECT COUNT(*) FROM monitors WHERE project_id = ${projectId} AND status = 'active')::int
         + (SELECT COUNT(*) FROM watch_sources WHERE project_id = ${projectId} AND status = 'active')::int AS n`;
  check('applying the proposal activated a watcher', Number(activeAfter[0].n) >= 1);
  gate = await gateEval(projectId);
  check('monitors_set is green after approval', result(gate, 'monitors_set').passed === true);

  // ── 5. seed the remaining 1A + 1B evidence → 1C unlocks ────────────────────
  for (const name of ['Dentrix', 'CareStack', 'RecallMax']) {
    await sql`
      INSERT INTO graph_nodes (id, project_id, name, node_type, summary, reviewed_state)
      VALUES (${'gnode_' + crypto.randomUUID().slice(0, 12)}, ${projectId}, ${name}, 'competitor', 'e2e seed', 'applied')
      ON CONFLICT DO NOTHING`;
  }
  // approved:true = the stamp applyValidationProposal writes on the founder's
  // yes — the gate's market_size check ignores unapproved (reference) sizing.
  const marketSize = { tam: { value: '$840M', confidence: 'medium' }, sam: { value: '$336M' }, som: { value: '$5M' }, approved: true };
  await sql`INSERT INTO research (project_id, market_size) VALUES (${projectId}, ${sql.json(marketSize)})
            ON CONFLICT (project_id) DO UPDATE SET market_size = ${sql.json(marketSize)}`;
  const factRows = [
    'Unlike legacy desktop suites we are cloud-native and mobile-first — the key differentiator.',
    'Technical feasibility: the recall engine is feasible with existing calendar APIs; the main technical risk is EHR integration depth.',
    'Key dependency: relies on the Google Calendar API and Twilio for SMS reminders.',
    'Regulatory: patient contact data means GDPR applies; we need a DPA with every vendor.',
  ];
  for (const fact of factRows) {
    await sql`
      INSERT INTO memory_facts (id, user_id, project_id, fact, kind, source_type, reviewed_state)
      VALUES (${'mf_' + crypto.randomUUID().slice(0, 12)}, ${userId}, ${projectId}, ${fact}, 'fact', 'chat', 'applied')`;
  }

  gate = await gateEval(projectId);
  const oneAB = gate.results.filter((r) => r.check.track === '1A' || r.check.track === '1B');
  check('all 1A + 1B checks pass after evidence seed', oneAB.every((r) => r.result.passed),
    oneAB.filter((r) => !r.result.passed).map((r) => r.check.id).join(',') || 'all green');
  check('1C interviews_logged UNLOCKED', !result(gate, 'interviews_logged').locked);
  check('1C wtp_signal UNLOCKED', !result(gate, 'wtp_signal').locked);
  check('1C checks still unmet (no interviews yet)', result(gate, 'interviews_logged').passed === false);

  // ── 6. five interviews (2 with WTP) → stage 2 done ─────────────────────────
  const interviews = [
    { name: 'Maria', pain: 'I spend every Friday afternoon calling patients back by hand.', wtp: 60 },
    { name: 'Luca', pain: 'No-shows kill my schedule and I only find out same-day.', wtp: 45 },
    { name: 'Anna', pain: 'The recall list lives in a paper diary.', wtp: null },
    { name: 'Paolo', pain: 'My assistant forgets half the six-month recalls.', wtp: null },
    { name: 'Giulia', pain: 'Recall tracking across two locations is chaos.', wtp: null },
  ];
  for (const iv of interviews) {
    await sql`
      INSERT INTO interviews (id, project_id, user_id, person_name, summary, top_pain, wtp_amount)
      VALUES (${'iv_' + crypto.randomUUID().slice(0, 12)}, ${projectId}, ${userId}, ${iv.name},
              ${'Interview about recall management pain.'}, ${iv.pain}, ${iv.wtp})`;
  }

  gate = await gateEval(projectId);
  check('interviews_logged green (5 logged)', result(gate, 'interviews_logged').passed === true);
  check('pain_validated green (verbatim top_pain)', result(gate, 'pain_validated').passed === true);
  check('wtp_signal green (2 interviews with WTP)', result(gate, 'wtp_signal').passed === true);
  check('stage 2 (Validation Gate) is DONE', gate.status === 'done', `status=${gate.status}`);

  // ── 7. scoring run → weak-section review option-set (road-1 middle step) ──
  // Runs the REAL startup-scoring skill (~30-120s LLM run), so it's gated:
  //   E2E_SCORE_REVIEW=1 npx tsx scripts/e2e-validation-gate.mts
  if (process.env.E2E_SCORE_REVIEW === '1') {
    const drain = async (body: unknown) => {
      const res = await fetch(`${BASE}/api/projects/${projectId}/score`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-e2e-user': userId },
        body: JSON.stringify(body),
      });
      const reader = res.body!.getReader();
      while (true) { const { done } = await reader.read(); if (done) break; }
    };
    await drain({});
    // The offer only fires when the fresh scorecard HAS a sub-60 dimension —
    // normalize the mixed 0-10/0-100 dims scale before deciding what to expect.
    const scoreRow = await sql`SELECT dimensions FROM scores WHERE project_id = ${projectId}`;
    const rawDims = scoreRow[0]?.dimensions;
    const dimVals = Object.values((typeof rawDims === 'string' ? JSON.parse(rawDims) : rawDims) ?? {})
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const scale = dimVals.length > 0 && dimVals.every((v) => v <= 10) ? 10 : 1;
    const hasWeak = dimVals.some((v) => v * scale < 60);
    const reviewMsgs = await sql`
      SELECT id FROM chat_messages WHERE project_id = ${projectId} AND content LIKE '%opt_score_review%'`;
    check('weak-section review option-set persisted to chat', hasWeak ? reviewMsgs.length === 1 : reviewMsgs.length === 0,
      `weakDims=${hasWeak} msgs=${reviewMsgs.length}`);
    const marker = await sql`
      SELECT id FROM memory_events WHERE project_id = ${projectId} AND event_type = 'score_review_offered'`;
    check('score_review_offered marker matches the offer', marker.length === reviewMsgs.length);
    // Idempotency: an auto re-score is debounced (already-fresh) → no duplicate offer.
    await drain({ auto: true });
    const reviewMsgs2 = await sql`
      SELECT id FROM chat_messages WHERE project_id = ${projectId} AND content LIKE '%opt_score_review%'`;
    check('no duplicate review offer on auto re-score', reviewMsgs2.length === reviewMsgs.length,
      `before=${reviewMsgs.length} after=${reviewMsgs2.length}`);
  } else {
    console.log('· skipping score-review leg (set E2E_SCORE_REVIEW=1 to run the real scoring skill)');
  }

  // cleanup the throwaway
  await sql`DELETE FROM projects WHERE id = ${projectId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
  await sql.end();

  console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures} failed checks)`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => { console.error('ERROR:', e.message); try { await sql.end(); } catch {} process.exit(1); });

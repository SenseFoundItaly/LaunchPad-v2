#!/usr/bin/env node
// sim-validated-founder-docs — post-validation spine harness.
//
// Seeds a VALIDATED founder (Stage 0-2 green, Loop-1 closed GO, Stage 3 keyword
// facts in place), uploads four business documents (GTM plan / ad brief / brand
// deck / financial actuals) through the real knowledge-upload+digest pipeline,
// applies every staged proposal, and reports — per document — what the spine
// captured vs LOST. Sentinel values embedded in the docs make loss
// machine-checkable: a sentinel counts as FOUND only when it reaches a
// STRUCTURED store (burn_rate, metrics, pricing_state, idea_canvas, applied
// facts, interviews, graph_nodes) — the raw file_upload fact is the ephemeral
// store under audit and never counts.
//
// Modes:
//   node scripts/sim-validated-founder-docs.mjs            → report (exit 0)
//   node scripts/sim-validated-founder-docs.mjs --expect target
//       → regression gate for the operate-stage digest (exit 1 on miss)
// Flags: --keep (skip cleanup), --project <id> (reuse an existing project)
//
// Env: E2E_AUTH_ENABLED=1 dev server (default :3005 — E2E_BASE_URL overrides);
// DATABASE_URL from ./.env.local (cwd) or env. Writes to the shared DB like
// every existing sim — full cascade cleanup unless --keep.
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3005';
const ARGS = process.argv.slice(2);
const KEEP = ARGS.includes('--keep');
const EXPECT_TARGET = ARGS.includes('--expect') && ARGS[ARGS.indexOf('--expect') + 1] === 'target';
const REUSE_PROJECT = ARGS.includes('--project') ? ARGS[ARGS.indexOf('--project') + 1] : null;

// .env.local from cwd (worktree-safe — e2e-loop1-psf.mjs hardcoded the main
// checkout path, which breaks in Conductor worktrees).
for (const candidate of [path.join(process.cwd(), '.env.local'), path.join(import.meta.dirname, '..', '.env.local')]) {
  if (!fs.existsSync(candidate)) continue;
  for (const rawLine of fs.readFileSync(candidate, 'utf8').split('\n')) {
    const l = rawLine.trim(); if (!l || l.startsWith('#')) continue;
    const eq = l.indexOf('='); if (eq < 0) continue;
    const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
  break;
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not found (.env.local or env)'); process.exit(1); }
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

const uid = 'sim-vf-' + Math.random().toString(36).slice(2, 8);
const rid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };
const note = (m) => console.log(`  · ${m}`);

async function api(method, apiPath, body) {
  const res = await fetch(`${BASE}${apiPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-e2e-user': uid },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  try { return { status: res.status, json: JSON.parse(t) }; } catch { return { status: res.status, text: t }; }
}

async function uploadDoc(pid, filename, text) {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/markdown' }), filename);
  const res = await fetch(`${BASE}/api/projects/${pid}/knowledge/upload?extract=1&digest=1`, {
    method: 'POST', headers: { 'x-e2e-user': uid }, body: form,
  });
  const t = await res.text();
  try { return { status: res.status, json: JSON.parse(t) }; } catch { return { status: res.status, text: t }; }
}

// ---------------------------------------------------------------------------
// Fixture documents. Sentinels carry a unique numeric/text signature; `where`
// records intended placement so the report explains WHY something was lost.
// ---------------------------------------------------------------------------
const filler = (label, n) => {
  let out = '';
  for (let i = 0; out.length < n; i++) {
    out += `\n${label} note ${i}: routine operational detail with no new figures, kept for realistic document bulk and pagination fidelity across sections and appendices.`;
  }
  return out;
};

const GTM_DOC = `# Go-To-Market Plan — CourtVision AI (H2 2026)

## ICP
Amateur sports clubs (football/basket) in Italy with 3+ youth teams and an annual video budget under €2,000. Buying decision sits with the technical director.

## Channels
1. **Federation partnerships** — regional football federations bundle us in coach-education programs.
2. **LinkedIn outbound** — technical directors of Serie D / Eccellenza clubs; 30 touches/week.
3. **Google Ads** — "analisi video calcio dilettanti" cluster; CAC target €42 per trial signup.

## Launch timeline
Sept: federation pilot (2 regions). Oct: paid channels on. Nov: referral loop v1.

## Budget
€3,900/month total acquisition budget for Q4, split 40/35/25 across the three channels.
${filler('GTM appendix', 14_000)}`;

const AD_BRIEF = `# Paid Social Brief — Q4 Trial Campaign

## Audiences
Meta Ads: lookalike on trial signups; interest stack "allenatore calcio", "video analysis". TikTok: coach-content retargeting only.

## Budget & targets
€3,000 monthly ad budget. Target CPM €7.50, target cost per trial €38.

## Messaging pillars
1. "Pro analysis at amateur prices." 2. Time saved per match (4 hours → 20 minutes). 3. GDPR-safe by default for minors.

## Creative specs
9:16 video 15-30s, subtitled Italian, real match footage over talking heads.
${filler('Ad brief appendix', 5_000)}`;

const BRAND_DECK = `# Brand Book v2 — CourtVision AI

## Positioning statement
"Precision without the price tag" — professional-grade video intelligence, priced for the amateur game.

## Voice
Direct, coach-to-coach, zero data-science jargon.

## Visual identity
Pitch-green primary #1E7A46, chalk-white type, broadcast-style overlays.

## Competitor positioning
Veo sells hardware prestige; Pixellot sells venue automation; we sell the Monday-morning decision.
${filler('Brand appendix', 9_000)}`;

function financialDoc() {
  const head = `# Financial Actuals — June 2026 close

## Key figures (verified against bank + Stripe)
- Monthly burn: €18,500 (net, June 2026)
- Cash on hand: €310,000
- MRR: €9,200
- Active users: 1240
- Monthly churn: 4.1%

## Notes
Burn includes the two ML contractors through October. Runway computed on current burn.

## Monthly detail
`;
  let body = head;
  let month = 0;
  const row = () => `\n### Month ${++month} operational detail\nInvoices reconciled, payroll on the 27th, infra spend within envelope. No exceptional items this period beyond seasonal variance in acquisition spend.${filler('ledger', 900)}`;
  while (body.length < 33_000) body += row();
  body += `\n\n## Q3 efficiency (mid-document)\nQ3 marketing efficiency ratio 0.87 — flagged for the board pack.\n`;
  while (body.length < 51_000) body += row();
  body += `\n\n## December projection (late-document)\nDecember cash position €412,000 assuming the bridge closes.\n`;
  while (body.length < 90_000) body += row();
  return body;
}

const DOCS = [
  {
    file: 'gtm-plan.md', text: GTM_DOC,
    sentinels: [
      { label: 'CAC target €42', needles: ['cac target €42', 'cac target 42'], num: 42, where: 'head' },
      { label: 'channel: Federation partnerships', needles: ['federation partnership'], where: 'head' },
      { label: 'channel: LinkedIn outbound', needles: ['linkedin outbound'], where: 'head' },
      { label: 'Q4 budget €3,900/mo', needles: ['3,900', '3900'], num: 3900, where: 'head' },
    ],
  },
  {
    file: 'ad-brief.md', text: AD_BRIEF,
    sentinels: [
      { label: 'ad budget €3,000/mo', needles: ['3,000 monthly ad budget', '3000'], num: 3000, where: 'head' },
      { label: 'cost per trial €38', needles: ['cost per trial €38', 'per trial 38'], num: 38, where: 'head' },
    ],
  },
  {
    file: 'brand-deck.md', text: BRAND_DECK,
    sentinels: [
      { label: 'positioning "Precision without the price tag"', needles: ['precision without the price tag'], where: 'head' },
    ],
  },
  {
    file: 'financial-actuals.md', text: financialDoc(),
    sentinels: [
      { label: 'monthly burn €18,500', needles: ['18,500', '18500'], num: 18500, where: 'head' },
      { label: 'cash on hand €310,000', needles: ['310,000', '310000'], num: 310000, where: 'head' },
      { label: 'MRR €9,200', needles: ['9,200', '9200'], num: 9200, where: 'head' },
      { label: 'active users 1240', needles: ['1240', '1,240'], num: 1240, where: 'head' },
      { label: 'churn 4.1%', needles: ['4.1'], num: 4.1, where: 'head' },
      { label: 'Q3 efficiency ratio 0.87 (32-50k)', needles: ['0.87'], num: 0.87, where: 'mid(32-50k)' },
      { label: 'December cash €412,000 (>50k)', needles: ['412,000', '412000'], num: 412000, where: 'late(>50k)' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Structured-store search: is this sentinel durably captured anywhere the
// spine/skills actually read? (raw file_upload facts deliberately excluded)
// ---------------------------------------------------------------------------
async function sentinelFound(pid, s) {
  const near = (a, b) => a != null && Math.abs(Number(a) - b) < 1e-6;
  if (s.num !== undefined) {
    const br = (await sql`SELECT monthly_burn, cash_on_hand FROM burn_rate WHERE project_id=${pid}`)[0];
    if (br && (near(br.monthly_burn, s.num) || near(br.cash_on_hand, s.num))) return 'burn_rate';
    if ((await sql`SELECT 1 FROM metrics WHERE project_id=${pid} AND current_value IS NOT NULL AND abs(current_value - ${s.num}) < 0.000001 LIMIT 1`).length) return 'metrics';
    const ps = (await sql`SELECT anchor_price FROM pricing_state WHERE project_id=${pid}`)[0];
    if (ps && near(ps.anchor_price, s.num)) return 'pricing_state';
  }
  for (const needle of s.needles) {
    const like = `%${needle}%`;
    if ((await sql`SELECT 1 FROM memory_facts WHERE project_id=${pid} AND kind != 'file_upload' AND reviewed_state='applied' AND fact ILIKE ${like} LIMIT 1`).length) return 'memory_facts';
    if ((await sql`SELECT 1 FROM idea_canvas WHERE project_id=${pid} AND (COALESCE(problem,'')||' '||COALESCE(solution,'')||' '||COALESCE(target_market,'')||' '||COALESCE(value_proposition,'')||' '||COALESCE(competitive_advantage,'')||' '||COALESCE(business_model,'')||' '||COALESCE(channels,'')) ILIKE ${like} LIMIT 1`).length) return 'idea_canvas';
    if ((await sql`SELECT 1 FROM graph_nodes WHERE project_id=${pid} AND (name ILIKE ${like} OR COALESCE(summary,'') ILIKE ${like}) LIMIT 1`).length) return 'graph_nodes';
    if ((await sql`SELECT 1 FROM interviews WHERE project_id=${pid} AND (COALESCE(summary,'') ILIKE ${like} OR COALESCE(top_pain,'') ILIKE ${like}) LIMIT 1`).length) return 'interviews';
    if ((await sql`SELECT 1 FROM pricing_state WHERE project_id=${pid} AND (COALESCE(model,'') ILIKE ${like}) LIMIT 1`).length) return 'pricing_state';
  }
  return null;
}

const checkMap = (stagesRes) => {
  const m = new Map();
  for (const ev of stagesRes.json?.data?.evaluations || []) {
    for (const r of ev.results || []) {
      const id = r.check?.id ?? r.id;
      if (id) m.set(`${ev.stage?.id}.${id}`, !!(r.result?.passed ?? r.passed));
    }
  }
  return m;
};

(async () => {
  // ------------------------------- SEED -------------------------------
  let pid = REUSE_PROJECT;
  if (!pid) {
    await sql`INSERT INTO users (id, email, locale) VALUES (${uid}, ${uid + '@sim.local'}, 'en')`;
    const pr = await api('POST', '/api/projects', { name: 'Validated Founder Docs Sim', locale: 'en', description: 'AI video analysis for amateur sports clubs.' });
    pid = pr.json?.data?.project_id;
    if (!pid) { console.error('project creation failed', pr); process.exit(1); }

    const CANVAS = {
      problem: 'Amateur clubs lose hours every week on manual video review and cannot afford pro tools priced for broadcasters.',
      solution: 'AI cameras + automated match analysis pipeline delivered turnkey to amateur clubs.',
      target_market: 'Amateur sports clubs with three or more youth teams in Italy.',
      value_proposition: 'Professional-grade match analysis at an amateur-club price point.',
      competitive_advantage: 'Turnkey hardware bundle, GDPR-safe for footage of minors by default.',
      business_model: 'Monthly SaaS subscription per team.',
      channels: 'Regional federation partnerships and coach-education programs.',
    };
    // Full L2 Phase-0 canvas (Stage-1 checks need the 9 Lean Canvas blocks incl.
    // key_metrics/cost_structure/revenue_streams arrays + unfair_advantage).
    const km = ['weekly active teams', 'matches analyzed per week'];
    const rs = ['SaaS subscriptions'];
    const cs = ['camera hardware', 'cloud inference'];
    await sql`UPDATE idea_canvas SET problem=${CANVAS.problem}, solution=${CANVAS.solution}, target_market=${CANVAS.target_market},
      value_proposition=${CANVAS.value_proposition}, competitive_advantage=${CANVAS.competitive_advantage},
      business_model=${CANVAS.business_model}, channels=${CANVAS.channels},
      unfair_advantage='Exclusive federation distribution agreements', key_metrics=${sql.json(km)},
      revenue_streams=${sql.json(rs)}, cost_structure=${sql.json(cs)} WHERE project_id=${pid}`;
    if ((await sql`SELECT 1 FROM idea_canvas WHERE project_id=${pid}`).length === 0) {
      await sql`INSERT INTO idea_canvas (project_id, problem, solution, target_market, value_proposition, competitive_advantage, business_model, channels, unfair_advantage, key_metrics, revenue_streams, cost_structure)
        VALUES (${pid}, ${CANVAS.problem}, ${CANVAS.solution}, ${CANVAS.target_market}, ${CANVAS.value_proposition}, ${CANVAS.competitive_advantage}, ${CANVAS.business_model}, ${CANVAS.channels}, 'Exclusive federation distribution agreements', ${sql.json(km)}, ${sql.json(rs)}, ${sql.json(cs)})`;
    }
    // Stage-1 startup-scoring baseline.
    await sql`INSERT INTO scores (project_id, overall_score, dimensions, recommendation)
      VALUES (${pid}, 72, ${sql.json({ Problem: 78, Market: 70, Execution: 68 })}, 'Solid validated baseline')
      ON CONFLICT (project_id) DO UPDATE SET overall_score=EXCLUDED.overall_score`;
    await sql`INSERT INTO research (project_id, market_size) VALUES (${pid}, ${sql.json({ approved: true, approved_at: new Date().toISOString(), tam: '€40M', sam: '€16M' })})
      ON CONFLICT (project_id) DO UPDATE SET market_size=EXCLUDED.market_size`;
    for (const n of ['Veo', 'Pixellot', 'Trace']) {
      await sql`INSERT INTO graph_nodes (id, project_id, name, node_type, summary, reviewed_state) VALUES (${rid('g')}, ${pid}, ${n}, 'competitor', 'seeded competitor', 'applied')`;
    }
    const seedFacts = [
      'Technical feasibility — computer vision on match footage is feasible with current models',
      'Key dependencies — camera hardware suppliers and vision model APIs',
      'Regulatory / compliance — GDPR for footage of minors',
      'Unlike Veo we ship a turnkey bundle priced for amateur clubs — differentiator confirmed in interviews',
      'Ideal customer profile — technical directors of amateur clubs with 3+ youth teams (ICP)',
      'Acquisition channel — regional federation partnerships and coach communities',
    ];
    for (const f of seedFacts) {
      await sql`INSERT INTO memory_facts (id, user_id, project_id, fact, kind, reviewed_state) VALUES (${rid('mf')}, ${uid}, ${pid}, ${f}, 'observation', 'applied')`;
    }
    await sql`INSERT INTO watch_sources (id, project_id, url, label, category, schedule, status) VALUES (${rid('ws')}, ${pid}, 'https://example.com', 'Competitor watch', 'competitor_product', 'weekly', 'active')`;
    for (let i = 0; i < 6; i++) {
      await sql`INSERT INTO interviews (id, project_id, user_id, person_name, summary, top_pain, urgency, wtp_amount, conducted_at)
        VALUES (${rid('iv')}, ${pid}, ${uid}, ${'Seed Person ' + i}, ${'seeded interview ' + i}, ${'manual review takes hours'}, 'high', ${i < 3 ? 50 : null}, NOW())`;
    }
    // Loop-1 closed with GO — the founder is validated, gate lifted. Evidence
    // uses the REAL EvidenceMatrix shape (buildEvidenceMatrix) so the
    // LoopHistoryCard read surface renders it faithfully under --keep.
    await sql`INSERT INTO validation_loops (id, project_id, loop_number, iteration, status, trigger, verdict, verdict_evidence, closed_at)
      VALUES (${rid('vl')}, ${pid}, 1, 1, 'closed', 'auto', 'GO', ${sql.json({
        wtp_rate: 0.5, pain_rate: 1, interviews: 6, iterations: 1,
        signals: [
          { signal: 'wtp_rate', value: 0.5, threshold: 0.3, passed: true },
          { signal: 'pain_confirmed_rate', value: 1, threshold: 0.5, passed: true },
          { signal: 'urgency_rate', value: 1, threshold: 0.3, passed: true },
        ],
        summary: 'After 1 PSF iteration(s) across 6 interviews, willingness-to-pay held at 50% (above the 30% bar).',
      })}, NOW())`;
  }

  const before = await api('GET', `/api/projects/${pid}/stages`);
  const s2 = (before.json?.data?.evaluations || []).find((e) => e.stage?.id === 'market_validation');
  ok('seed: Stage 2 (Validation Gate) done', s2?.status === 'done', `status=${s2?.status}`);
  const openLoops = await sql`SELECT count(*)::int c FROM validation_loops WHERE project_id=${pid} AND status!='closed'`;
  ok('seed: no open Loop-1 (founder validated)', openLoops[0].c === 0);
  const gate = await api('GET', `/api/projects/${pid}/skills?availability=1`);
  ok('seed: Phase-2 skills not gated', !(gate.json?.data?.gated || gate.json?.gated || []).includes('business-model'));
  // B4 read surface: the loop verdict + Evidence Matrix must be retrievable
  // via GET /loops (what LoopHistoryCard renders on the today page).
  const loopsRes = await api('GET', `/api/projects/${pid}/loops`);
  const closedLoop = (loopsRes.json?.data || []).find((l) => l.status === 'closed');
  const evid = typeof closedLoop?.verdict_evidence === 'string' ? JSON.parse(closedLoop.verdict_evidence) : closedLoop?.verdict_evidence;
  ok('loop history readable (verdict + Evidence Matrix for LoopHistoryCard)',
    closedLoop?.verdict === 'GO' && Array.isArray(evid?.signals) && evid.signals.length === 3);
  const checksBefore = checkMap(before);
  const activeBefore = before.json?.data?.active_stage_number;
  note(`active stage before uploads: ${activeBefore} (${before.json?.data?.active_stage_id})`);

  // ------------------------------ UPLOAD ------------------------------
  const report = [];
  for (const doc of DOCS) {
    const paBefore = new Set((await sql`SELECT id FROM pending_actions WHERE project_id=${pid}`).map((r) => r.id));
    const t0 = Date.now();
    const up = await uploadDoc(pid, doc.file, doc.text);
    const r0 = up.json?.data?.results?.[0] ?? {};
    ok(`upload ${doc.file} ingested (${doc.text.length} chars, ${((Date.now() - t0) / 1000).toFixed(1)}s)`, (up.status === 200 || up.status === 201) && r0.status === 'ingested', r0.reason || `HTTP ${up.status}`);
    const factRow = r0.fact_id ? (await sql`SELECT length(fact)::int len, fact LIKE '%[document truncated%' AS truncated FROM memory_facts WHERE id=${r0.fact_id}`)[0] : null;

    const paNew = (await sql`SELECT id, action_type, payload, edited_payload FROM pending_actions WHERE project_id=${pid} AND status IN ('pending','edited')`)
      .filter((r) => !paBefore.has(r.id));
    const kinds = {};
    let monitorProposals = 0;
    const toApply = [];
    for (const p of paNew) {
      if (p.action_type === 'configure_monitor') { monitorProposals++; continue; }
      if (p.action_type !== 'validation_proposal') continue;
      toApply.push(p.id);
      const payload = typeof p.payload === 'string' ? JSON.parse(p.payload) : p.payload;
      for (const it of payload?.items || []) kinds[it.kind] = (kinds[it.kind] || 0) + 1;
    }

    // Apply every staged proposal (the founder's yes) + B5 durability check.
    const writesBefore = await snapshotWrites(pid);
    for (const id of toApply) {
      const res = await api('POST', `/api/projects/${pid}/actions/${id}`, { transition: 'apply' });
      if (res.status !== 200) note(`apply ${id} → ${res.status} ${JSON.stringify(res.json?.error ?? res.text ?? '').slice(0, 120)}`);
      else {
        const er = (await sql`SELECT execution_result FROM pending_actions WHERE id=${id}`)[0]?.execution_result;
        const narrative = typeof er === 'string' ? JSON.parse(er)?.response : er?.response;
        if (!narrative) note(`apply ${id}: no execution_result.response persisted (B5)`);
      }
    }
    const writesAfter = await snapshotWrites(pid);
    const writes = diffWrites(writesBefore, writesAfter);

    report.push({ doc: doc.file, stored: factRow ? `${factRow.len}${factRow.truncated ? ' TRUNC' : ''}` : 'n/a', kinds, monitorProposals, writes, factId: r0.fact_id });
  }

  // --------------------------- STAGE DELTA ---------------------------
  const after = await api('GET', `/api/projects/${pid}/stages`);
  const checksAfter = checkMap(after);
  const flipped = [...checksAfter.entries()].filter(([k, v]) => v && !checksBefore.get(k)).map(([k]) => k);
  note(`active stage after: ${after.json?.data?.active_stage_number} (was ${activeBefore}); checks flipped green: ${flipped.length ? flipped.join(', ') : 'NONE'}`);

  // ---------------------------- LOST LIST ----------------------------
  for (const doc of DOCS) {
    const row = report.find((r) => r.doc === doc.file);
    row.lost = [];
    row.found = [];
    for (const s of doc.sentinels) {
      const where = await sentinelFound(pid, s);
      if (where) row.found.push(`${s.label} → ${where}`);
      else row.lost.push(`${s.label} [${s.where}]`);
    }
  }

  // ----------------------------- REPORT ------------------------------
  console.log('\n================ DOC → SPINE REPORT ================');
  for (const r of report) {
    console.log(`\n■ ${r.doc}  (stored: ${r.stored} chars)`);
    console.log(`  staged kinds: ${Object.keys(r.kinds).length ? JSON.stringify(r.kinds) : 'NONE'}${r.monitorProposals ? `  +${r.monitorProposals} monitor proposal(s)` : ''}`);
    console.log(`  applied writes: ${r.writes.length ? r.writes.join(', ') : 'NONE'}`);
    for (const f of r.found) console.log(`  FOUND ${f}`);
    for (const l of r.lost) console.log(`  LOST  ${l}`);
  }
  console.log(`\nchecks flipped: ${flipped.length ? flipped.join(', ') : 'NONE'}`);
  console.log('====================================================\n');

  // --------------------------- EXPECT MODE ---------------------------
  if (EXPECT_TARGET) {
    const fin = report.find((r) => r.doc === 'financial-actuals.md');
    const gtm = report.find((r) => r.doc === 'gtm-plan.md');
    ok('target: financial doc staged financial_fact items', (fin.kinds.financial_fact || 0) >= 1);
    ok('target: financial doc staged metric items (≥2)', (fin.kinds.metric || 0) >= 2);
    const br = (await sql`SELECT monthly_burn, cash_on_hand FROM burn_rate WHERE project_id=${pid}`)[0];
    ok('target: burn_rate written on apply', !!br && Number(br.monthly_burn) === 18500 && Number(br.cash_on_hand) === 310000, JSON.stringify(br ?? null));
    const mcount = (await sql`SELECT count(DISTINCT LOWER(name))::int c FROM metrics WHERE project_id=${pid}`)[0].c;
    ok('target: ≥3 distinct metrics tracked', mcount >= 3, `count=${mcount}`);
    ok('target: Stage 6 runway check green', checksAfter.get('fundraise.runway_clear') === true);
    ok('target: Stage 7 metrics check green', checksAfter.get('operate.metrics_tracked') === true);
    ok('target: GTM doc staged channel_fact items', (gtm.kinds.channel_fact || 0) >= 1);

    // Mid-doc sentinel (32-50k): recoverable via the retro digest endpoint.
    const digestRes = await api('POST', `/api/projects/${pid}/knowledge/digest`, { fact_id: fin.factId });
    ok('target: retro /digest runs on the financial doc', digestRes.status === 200, JSON.stringify(digestRes.json?.error ?? '').slice(0, 120));
    const paRetro = await sql`SELECT id FROM pending_actions WHERE project_id=${pid} AND action_type='validation_proposal' AND status IN ('pending','edited')`;
    for (const p of paRetro) await api('POST', `/api/projects/${pid}/actions/${p.id}`, { transition: 'apply' });
    const midFound = await sentinelFound(pid, DOCS[3].sentinels.find((s) => s.where.startsWith('mid')));
    ok('target: mid-doc sentinel recovered after re-digest', !!midFound, midFound ?? 'still lost');
    // The >50k sentinel is legitimately unreachable (stored-text cap) — but the
    // loss must be DECLARED, not silent.
    ok('target: >50k truncation is declared on the stored fact', String(report[3].stored).includes('TRUNC'));
  }

  // ----------------------------- CLEANUP -----------------------------
  if (!KEEP && !REUSE_PROJECT) {
    await sql`DELETE FROM projects WHERE id=${pid}`;
    await sql`DELETE FROM users WHERE id=${uid}`;
    note('cleaned up seeded project + user');
  } else {
    note(`kept project ${pid} (user ${uid})`);
  }
  await sql.end();
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => { console.error('ERROR:', e); try { await sql.end(); } catch {} process.exit(1); });

// Row-count snapshot of every structured store a digest apply can write.
async function snapshotWrites(pid) {
  const one = async (q) => (await q)[0]?.c ?? 0;
  return {
    canvas_fields: await one(sql`SELECT (
      (problem IS NOT NULL AND problem<>'')::int + (solution IS NOT NULL AND solution<>'')::int +
      (target_market IS NOT NULL AND target_market<>'')::int + (value_proposition IS NOT NULL AND value_proposition<>'')::int +
      (competitive_advantage IS NOT NULL AND competitive_advantage<>'')::int + (business_model IS NOT NULL AND business_model<>'')::int +
      (channels IS NOT NULL AND channels<>'')::int)::int c FROM idea_canvas WHERE project_id=${pid}`),
    competitors: await one(sql`SELECT count(*)::int c FROM graph_nodes WHERE project_id=${pid} AND node_type='competitor'`),
    facts: await one(sql`SELECT count(*)::int c FROM memory_facts WHERE project_id=${pid} AND kind != 'file_upload'`),
    interviews: await one(sql`SELECT count(*)::int c FROM interviews WHERE project_id=${pid}`),
    pricing: await one(sql`SELECT count(*)::int c FROM pricing_state WHERE project_id=${pid}`),
    burn: await one(sql`SELECT count(*)::int c FROM burn_rate WHERE project_id=${pid}`),
    metrics: await one(sql`SELECT count(*)::int c FROM metrics WHERE project_id=${pid}`),
  };
}
function diffWrites(a, b) {
  return Object.keys(a).filter((k) => b[k] > a[k]).map((k) => `${k}+${b[k] - a[k]}`);
}

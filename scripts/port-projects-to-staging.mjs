#!/usr/bin/env node
// Port production projects to STAGING + top up stage 1-4 evidence so the
// Build tab (stage-5 gate) unlocks there. STAGING-ONLY writes for the top-up;
// production is READ-ONLY throughout.
//
// Usage: node scripts/port-projects-to-staging.mjs <projectId> [<projectId>…]
// Env: PROD .env.local (cwd) + STAGING .env.staging (cancun worktree).
import fs from 'node:fs';
import postgres from 'postgres';

const STAGING_OWNER = '77f0aaf6-fa8f-40eb-b222-f241d666b6cf'; // hello@supalabs.co on staging
const STAGING_ORG = '33af8722-bc17-4ca6-ae85-8e108c394da5';   // "hello@supalabs.co's workspace" on staging
const PROJECT_IDS = process.argv.slice(2);
if (PROJECT_IDS.length === 0) { console.error('usage: port-projects-to-staging.mjs <projectId>…'); process.exit(1); }

function loadEnv(path) {
  const out = {};
  for (const raw of fs.readFileSync(path, 'utf8').split('\n')) {
    const l = raw.trim(); if (!l || l.startsWith('#')) continue; const eq = l.indexOf('='); if (eq < 0) continue;
    out[l.slice(0, eq).trim()] = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}
const prodEnv = loadEnv('.env.local');
const stagEnv = loadEnv('/Users/mikececconello/conductor/workspaces/LaunchPad-v2/cancun/.env.staging');
if (!/ghjbxnnkdketrtmebzxl/.test(prodEnv.DATABASE_URL)) { console.error('prod URL sanity failed'); process.exit(1); }
if (!/ebbhkuvkhkjubhyeaimm/.test(stagEnv.DATABASE_URL)) { console.error('staging URL sanity failed'); process.exit(1); }
const prod = postgres(prodEnv.DATABASE_URL, { prepare: false, max: 1 });
const stag = postgres(stagEnv.DATABASE_URL, { prepare: false, max: 1 });
const rid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

async function tablesWithProjectId(sql) {
  const rows = await sql`
    SELECT DISTINCT table_name FROM information_schema.columns
     WHERE column_name = 'project_id' AND table_schema = 'public'`;
  return new Set(rows.map((r) => r.table_name));
}

async function copyProject(pid) {
  console.log(`\n── porting ${pid} ──`);
  const [prodTables, stagTables] = await Promise.all([tablesWithProjectId(prod), tablesWithProjectId(stag)]);
  const common = [...prodTables].filter((t) => stagTables.has(t) && t !== 'projects');

  // 1. The projects row first (owner remapped to the staging founder).
  const [project] = await prod`SELECT * FROM projects WHERE id = ${pid}`;
  if (!project) { console.log('  NOT FOUND in prod — skipped'); return false; }
  project.owner_user_id = STAGING_OWNER;
  if ('org_id' in project) project.org_id = STAGING_ORG;
  await stag`INSERT INTO projects ${stag(project)} ON CONFLICT (id) DO NOTHING`;
  console.log(`  projects: ${project.name}`);

  // 2. Everything else — two passes so FK order (monitors→watch_sources, …)
  //    resolves without a dependency graph.
  const failed = [];
  const copyTable = async (t) => {
    const rows = await prod.unsafe(`SELECT * FROM ${t} WHERE project_id = $1`, [pid]);
    if (rows.length === 0) return 0;
    let n = 0;
    for (const row of rows) {
      if ('user_id' in row && row.user_id) row.user_id = STAGING_OWNER;
      if ('owner_user_id' in row && row.owner_user_id) row.owner_user_id = STAGING_OWNER;
      try {
        await stag.unsafe(
          `INSERT INTO ${t} (${Object.keys(row).map((c) => `"${c}"`).join(',')})
           VALUES (${Object.keys(row).map((_, i) => `$${i + 1}`).join(',')})
           ON CONFLICT DO NOTHING`,
          Object.values(row).map((v) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v)),
        );
        n++;
      } catch (e) {
        failed.push({ t, row, msg: e.message });
      }
    }
    return n;
  };
  for (const t of common) {
    try {
      const n = await copyTable(t);
      if (n > 0) console.log(`  ${t}: ${n}`);
    } catch (e) { console.log(`  ${t}: SKIP (${e.message.slice(0, 60)})`); }
  }
  // Second pass for rows that hit FK ordering.
  let recovered = 0;
  for (const { t, row } of failed.splice(0)) {
    try {
      await stag.unsafe(
        `INSERT INTO ${t} (${Object.keys(row).map((c) => `"${c}"`).join(',')})
         VALUES (${Object.keys(row).map((_, i) => `$${i + 1}`).join(',')})
         ON CONFLICT DO NOTHING`,
        Object.values(row).map((v) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v)),
      );
      recovered++;
    } catch { /* drop — non-core row */ }
  }
  if (recovered) console.log(`  second-pass recovered: ${recovered}`);
  return true;
}

/** STAGING-ONLY top-up: fill any missing stage 1-4 evidence so the journey's
 *  active stage reaches 5 (Build & Launch) and the Build tab unlocks. Real
 *  ported content is never clobbered — only empty fields are filled and only
 *  count deficits are seeded. */
async function topUp(pid) {
  console.log(`  topping up stage 1-4 evidence…`);
  const F = {
    problem: 'Customers lose hours every week on this manual workflow and current tools are priced out of reach for them.',
    solution: 'A turnkey product that automates the workflow end-to-end at a price the segment can afford.',
    target_market: 'Early-adopter niche segment identified in interviews (staging demo fill).',
    value_proposition: 'Professional-grade results at a fraction of today’s cost and effort.',
    competitive_advantage: 'Turnkey delivery and a distribution channel competitors cannot copy quickly.',
    business_model: 'Monthly SaaS subscription.',
    channels: 'Partnerships with the segment’s existing communities and associations.',
  };
  await stag`UPDATE idea_canvas SET
    problem = COALESCE(NULLIF(problem,''), ${F.problem}),
    solution = COALESCE(NULLIF(solution,''), ${F.solution}),
    target_market = COALESCE(NULLIF(target_market,''), ${F.target_market}),
    value_proposition = COALESCE(NULLIF(value_proposition,''), ${F.value_proposition}),
    competitive_advantage = COALESCE(NULLIF(competitive_advantage,''), ${F.competitive_advantage}),
    business_model = COALESCE(NULLIF(business_model,''), ${F.business_model}),
    channels = COALESCE(NULLIF(channels,''), ${F.channels}),
    unfair_advantage = COALESCE(NULLIF(unfair_advantage,''), 'Exclusive distribution agreements'),
    key_metrics = CASE WHEN key_metrics IS NULL OR key_metrics::text IN ('[]','null') THEN ${stag.json(['weekly active users', 'conversion rate'])} ELSE key_metrics END,
    revenue_streams = CASE WHEN revenue_streams IS NULL OR revenue_streams::text IN ('[]','null') THEN ${stag.json(['SaaS subscriptions'])} ELSE revenue_streams END,
    cost_structure = CASE WHEN cost_structure IS NULL OR cost_structure::text IN ('[]','null') THEN ${stag.json(['infrastructure', 'support'])} ELSE cost_structure END
    WHERE project_id = ${pid}`;
  if ((await stag`SELECT 1 FROM idea_canvas WHERE project_id = ${pid}`).length === 0) {
    await stag`INSERT INTO idea_canvas (project_id, problem, solution, target_market, value_proposition, competitive_advantage, business_model, channels, unfair_advantage, key_metrics, revenue_streams, cost_structure)
      VALUES (${pid}, ${F.problem}, ${F.solution}, ${F.target_market}, ${F.value_proposition}, ${F.competitive_advantage}, ${F.business_model}, ${F.channels}, 'Exclusive distribution agreements', ${stag.json(['weekly active users'])}, ${stag.json(['SaaS subscriptions'])}, ${stag.json(['infrastructure'])})`;
  }

  await stag`INSERT INTO scores (project_id, overall_score, dimensions, recommendation)
    VALUES (${pid}, 72, ${stag.json({ Problem: 78, Market: 70, Execution: 68 })}, 'Validated baseline (staging demo)')
    ON CONFLICT (project_id) DO UPDATE SET overall_score = GREATEST(scores.overall_score, EXCLUDED.overall_score)`;

  // market_size: MERGE the approval stamp, keep any real tiers.
  const research = await stag`SELECT market_size FROM research WHERE project_id = ${pid}`;
  if (research.length === 0) {
    await stag`INSERT INTO research (project_id, market_size) VALUES (${pid}, ${stag.json({ approved: true, approved_at: new Date().toISOString(), tam: '€40M', sam: '€16M' })})`;
  } else {
    await stag`UPDATE research SET market_size = COALESCE(market_size, '{}'::jsonb) || ${stag.json({ approved: true, approved_at: new Date().toISOString() })}
      WHERE project_id = ${pid} AND (jsonb_typeof(market_size) = 'object' OR market_size IS NULL)`;
  }

  const comp = await stag`SELECT count(*)::int c FROM graph_nodes WHERE project_id = ${pid} AND node_type = 'competitor' AND reviewed_state = 'applied'`;
  for (let i = comp[0].c; i < 3; i++) {
    await stag`INSERT INTO graph_nodes (id, project_id, name, node_type, summary, reviewed_state)
      VALUES (${rid('g')}, ${pid}, ${'Demo Competitor ' + (i + 1)}, 'competitor', 'staging demo competitor', 'applied')`;
  }

  const seedFacts = [
    'Technical feasibility — the core workflow is technically feasible with current tooling',
    'Key dependencies — infrastructure vendors and data providers',
    'Regulatory / compliance — GDPR applies to end-user data',
    'Unlike the incumbents we ship a turnkey bundle — differentiator confirmed vs competitors in interviews',
    'Ideal customer profile — early-adopter operators in the beachhead segment (ICP)',
    'Acquisition channel — community partnerships and direct outreach',
  ];
  for (const f of seedFacts) {
    const dup = await stag`SELECT 1 FROM memory_facts WHERE project_id = ${pid} AND fact = ${f} LIMIT 1`;
    if (dup.length === 0) {
      await stag`INSERT INTO memory_facts (id, user_id, project_id, fact, kind, reviewed_state)
        VALUES (${rid('mf')}, ${STAGING_OWNER}, ${pid}, ${f}, 'observation', 'applied')`;
    }
  }

  const ivs = await stag`SELECT count(*)::int c, count(wtp_amount)::int w FROM interviews WHERE project_id = ${pid}`;
  const needIv = Math.max(0, 6 - ivs[0].c);
  const needWtp = Math.max(0, 3 - ivs[0].w);
  for (let i = 0; i < Math.max(needIv, needWtp); i++) {
    await stag`INSERT INTO interviews (id, project_id, user_id, person_name, summary, top_pain, urgency, wtp_amount, conducted_at)
      VALUES (${rid('iv')}, ${pid}, ${STAGING_OWNER}, ${'Demo Interviewee ' + (i + 1)}, 'staging demo interview', 'the manual process takes hours every week', 'high', ${i < needWtp ? 49 : null}, NOW())`;
  }

  // Stage 4: complete pricing_state (anchor / 2 tiers / wtp / model / unit econ LTV:CAC ≈ 8).
  await stag`INSERT INTO pricing_state (project_id, anchor_price, currency, tiers, wtp, model, unit_econ, updated_at)
    VALUES (${pid}, 49, 'EUR',
      ${stag.json([{ name: 'Base', price: 49 }, { name: 'Pro', price: 99 }])},
      ${stag.json({ note: '3 of 6 interviewees stated willingness to pay €49/mo' })},
      'subscription',
      ${stag.json({ ltv: 980, cac: 120 })},
      CURRENT_TIMESTAMP)
    ON CONFLICT (project_id) DO UPDATE SET
      anchor_price = COALESCE(pricing_state.anchor_price, EXCLUDED.anchor_price),
      -- typeof guard: legacy rows carry double-encoded JSONB (string scalar,
      -- [[finding_jsonb_double_encode_audit]]) — array_length on those throws.
      tiers = CASE WHEN pricing_state.tiers IS NOT NULL AND jsonb_typeof(pricing_state.tiers) = 'array' AND jsonb_array_length(pricing_state.tiers) >= 2
                   THEN pricing_state.tiers ELSE EXCLUDED.tiers END,
      wtp = CASE WHEN pricing_state.wtp IS NOT NULL AND jsonb_typeof(pricing_state.wtp) = 'object' THEN pricing_state.wtp ELSE EXCLUDED.wtp END,
      model = COALESCE(NULLIF(pricing_state.model, ''), EXCLUDED.model),
      unit_econ = CASE WHEN pricing_state.unit_econ IS NOT NULL AND jsonb_typeof(pricing_state.unit_econ) = 'object'
                        AND (pricing_state.unit_econ->>'ltv') IS NOT NULL AND (pricing_state.unit_econ->>'cac') IS NOT NULL
                       THEN pricing_state.unit_econ ELSE EXCLUDED.unit_econ END,
      updated_at = CURRENT_TIMESTAMP`;

  // No open Loop-1 (would gate skills); ensure a closed GO loop for history.
  await stag`UPDATE validation_loops SET status = 'closed', verdict = COALESCE(verdict, 'GO'), closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP)
    WHERE project_id = ${pid} AND status <> 'closed'`;
  if ((await stag`SELECT 1 FROM validation_loops WHERE project_id = ${pid} LIMIT 1`).length === 0) {
    await stag`INSERT INTO validation_loops (id, project_id, loop_number, iteration, status, trigger, verdict, verdict_evidence, closed_at)
      VALUES (${rid('vl')}, ${pid}, 1, 1, 'closed', 'auto', 'GO', ${stag.json({
        wtp_rate: 0.5, pain_rate: 1, interviews: 6, iterations: 1,
        signals: [
          { signal: 'wtp_rate', value: 0.5, threshold: 0.3, passed: true },
          { signal: 'pain_confirmed_rate', value: 1, threshold: 0.5, passed: true },
          { signal: 'urgency_rate', value: 1, threshold: 0.3, passed: true },
        ],
        summary: 'After 1 PSF iteration across 6 interviews, willingness-to-pay held at 50% (above the 30% bar).',
      })}, NOW())`;
  }
  if ((await stag`SELECT 1 FROM watch_sources WHERE project_id = ${pid} LIMIT 1`).length === 0) {
    await stag`INSERT INTO watch_sources (id, project_id, url, label, category, schedule, status)
      VALUES (${rid('ws')}, ${pid}, 'https://example.com', 'Competitor watch', 'competitor_product', 'weekly', 'active')`;
  }

  // Verification — mirror the stage 1-4 check conditions in SQL.
  const v = (await stag`SELECT
    (SELECT count(*)::int FROM graph_nodes WHERE project_id = ${pid} AND node_type='competitor' AND reviewed_state='applied') AS competitors,
    (SELECT (market_size->>'approved')::boolean FROM research WHERE project_id = ${pid}) AS ms_approved,
    (SELECT count(*)::int FROM interviews WHERE project_id = ${pid}) AS interviews,
    (SELECT count(wtp_amount)::int FROM interviews WHERE project_id = ${pid}) AS wtp,
    (SELECT anchor_price IS NOT NULL
        AND jsonb_typeof(tiers) = 'array' AND jsonb_array_length(tiers) >= 2
        AND wtp IS NOT NULL AND model IS NOT NULL
        AND (unit_econ->>'ltv')::numeric / NULLIF((unit_econ->>'cac')::numeric,0) >= 1
       FROM pricing_state WHERE project_id = ${pid}) AS stage4,
    (SELECT count(*)::int FROM validation_loops WHERE project_id = ${pid} AND status <> 'closed') AS open_loops`)[0];
  console.log(`  verify: competitors=${v.competitors} ms_approved=${v.ms_approved} interviews=${v.interviews} wtp=${v.wtp} stage4_complete=${v.stage4} open_loops=${v.open_loops}`);
}

(async () => {
  for (const pid of PROJECT_IDS) {
    const ok = await copyProject(pid);
    if (ok) await topUp(pid);
  }
  await prod.end();
  await stag.end();
  console.log('\ndone');
})().catch(async (e) => { console.error('ERROR:', e); try { await prod.end(); await stag.end(); } catch {} process.exit(1); });

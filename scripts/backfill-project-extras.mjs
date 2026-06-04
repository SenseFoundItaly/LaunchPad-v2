#!/usr/bin/env node
/**
 * Companion to backfill-project-sections.mjs. Populates the three sections the
 * canonical backfill doesn't currently touch:
 *   - pending_actions   (drives /project/<id>/actions — the inbox)
 *   - monitors          (drives /project/<id>/monitors)
 *   - llm_usage_logs    (drives /project/<id>/usage)
 *
 * Idempotent: every row carries an `bf_` prefix and is wiped before re-insert.
 *
 * Usage:
 *   node --env-file=.env.local scripts/backfill-project-extras.mjs proj_9738c52c-789
 */

import postgres from 'postgres';
import crypto from 'node:crypto';

const PROJECT_ID = process.argv[2];
if (!PROJECT_ID) {
  console.error('Usage: backfill-project-extras.mjs <projectId>');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false } });
const bf = () => `bf_${crypto.randomBytes(6).toString('hex')}`;

async function main() {
  const proj = await sql`SELECT id, owner_user_id, name FROM projects WHERE id = ${PROJECT_ID}`;
  if (!proj[0]) {
    console.error(`Project ${PROJECT_ID} not found.`);
    process.exit(1);
  }
  const { owner_user_id: userId, name } = proj[0];
  console.log(`Extras backfill: ${name} (owner ${userId})`);

  await wipe();
  await insertMonitors();
  await insertPendingActions();
  await insertUsageLogs(userId);
  console.log('\nDone.');
  await sql.end({ timeout: 5 });
}

async function wipe() {
  // Tasks page (built on pending_actions of action_type='task') and inbox both
  // read from pending_actions — wiping bf_-prefixed rows is enough.
  await sql`DELETE FROM llm_usage_logs WHERE project_id=${PROJECT_ID} AND id LIKE 'bf_%'`;
  await sql`DELETE FROM pending_actions WHERE project_id=${PROJECT_ID} AND id LIKE 'bf_%'`;
  await sql`DELETE FROM monitor_runs    WHERE monitor_id IN (SELECT id FROM monitors WHERE project_id=${PROJECT_ID} AND id LIKE 'bf_%')`;
  await sql`DELETE FROM monitors        WHERE project_id=${PROJECT_ID} AND id LIKE 'bf_%'`;
  console.log('· wiped previous extras');
}

// ───── monitors ────────────────────────────────────────────────────────────
async function insertMonitors() {
  const monitors = [
    {
      type: 'risk', name: 'DCWP permit window — 119 days to close',
      objective: 'Watch DCWP for any rule change, fee revision, or waitlist closure before our 2026-09-30 application window.',
      kind: 'regulation', schedule: 'weekly', status: 'active',
      linked_quote: 'DCWP began accepting new mobile food vending applications Feb 2026 — first reopening in 14 years.',
      urls: [{ url: 'https://www.nyc.gov/site/dca/businesses/mobile-food-vendors.page', label: 'DCWP mobile vending rules' }],
    },
    {
      type: 'competitor', name: 'Joe Coffee subway kiosk expansion',
      objective: 'Detect new kiosk openings on the L/G/F lines that would compete with Lorimer St cart #1.',
      kind: 'competitor', schedule: 'weekly', status: 'active',
      linked_quote: 'Joe Coffee opened 3 micro-format kiosks in Q1 2026; if they cross 6 in our target neighborhoods, re-evaluate price ladder.',
      urls: [{ url: 'https://joecoffee.com/locations', label: 'Joe Coffee locations' }],
    },
    {
      type: 'market', name: 'USDA arabica wholesale index',
      objective: 'Track bean cost. Alert if COGS implication crosses $1.05/cup — that triggers the price-floor review at $5.',
      kind: 'cost', schedule: 'weekly', status: 'active',
      linked_quote: 'COGS at $0.85/cup gives 81% gross margin. Re-price at $5 if sustained >$1.20/cup.',
      urls: [{ url: 'https://www.ers.usda.gov/data-products/coffee', label: 'USDA coffee data' }],
    },
    {
      type: 'market', name: 'MTA ridership Q-by-Q',
      objective: 'Confirm subway ridership stays above the 3.4M/day threshold our 140 cups/day target depends on.',
      kind: 'demand', schedule: 'monthly', status: 'active',
      linked_quote: 'Single-cart target = 140 cups/day, predicated on 36k weekday exits at Lorimer St L holding steady.',
      urls: [{ url: 'https://new.mta.info/agency/new-york-city-transit/subway-bus-ridership-2026', label: 'MTA ridership' }],
    },
    {
      type: 'competitor', name: 'Blue Bottle NYC roadmap',
      objective: 'Catch any pivot to commuter-grab-and-go format that would put them in our occasion.',
      kind: 'competitor', schedule: 'monthly', status: 'paused',
      linked_quote: 'Blue Bottle is sit-down only today — different occasion. Format pivot would be a material threat.',
      urls: [{ url: 'https://bluebottlecoffee.com/nyc-2026', label: 'Blue Bottle NYC' }],
    },
  ];
  for (const m of monitors) {
    const lastRun = m.schedule === 'weekly' ? '3 days' : '12 days';
    const nextRun = m.schedule === 'weekly' ? '4 days' : '18 days';
    // Live DB doesn't yet have the `objective` column from the untracked
    // supabase/migrations/20260603000000_monitors_objective.sql — fold the
    // objective text into linked_quote so it still renders in the detail
    // pane (which falls back to linked_quote when objective is null).
    const fallbackQuote = `${m.objective}\n\n— context: ${m.linked_quote}`;
    await sql`
      INSERT INTO monitors
        (id, project_id, type, name, schedule, kind, status,
         urls_to_track, prompt, linked_quote, last_run, next_run, sources)
      VALUES
        (${bf()}, ${PROJECT_ID}, ${m.type}, ${m.name}, ${m.schedule}, ${m.kind},
         ${m.status}, ${sql.json(m.urls)},
         ${'Summarize what changed since the last check, and flag anything that would affect: ' + m.objective},
         ${fallbackQuote},
         CURRENT_TIMESTAMP - (${lastRun})::interval,
         CURRENT_TIMESTAMP + (${nextRun})::interval,
         ${sql.json([{ type: 'backfill', tag: 'demo-seed' }])})
    `;
  }
  console.log(`· monitors: +${monitors.length}`);
}

// ───── pending_actions (inbox + tasks) ─────────────────────────────────────
async function insertPendingActions() {
  // action_type values map to inbox tabs; payload shape varies per type.
  const actions = [
    // Tasks — what the founder must do this week
    { type: 'task', title: 'Submit DCWP application before 2026-09-30',
      rationale: 'Critical gate. Missing the window forces the $25k+ resale-permit market and breaks the unit-econ thesis.',
      impact: 'critical', priority: 'P0', status: 'pending',
      payload: { stage: 'stage_5_build', due_date: '2026-09-30', estimated_hours: 16 } },
    { type: 'task', title: 'Sign SAFE with M. (uncle, $10k commit)',
      rationale: 'First confirmed F&F check. Closing it now unblocks the cart-build down-payment timeline.',
      impact: 'high', priority: 'P0', status: 'pending',
      payload: { stage: 'stage_6_fundraise', due_date: '2026-06-10', estimated_hours: 2 } },
    { type: 'task', title: 'Walkthrough at Lorimer St L with D. (angel, $15k)',
      rationale: 'Largest soft-circled check. Site visit converts strongest given his restaurant LP background.',
      impact: 'high', priority: 'P1', status: 'pending',
      payload: { stage: 'stage_6_fundraise', due_date: '2026-06-25', estimated_hours: 3 } },
    { type: 'task', title: 'Hire 2nd barista before launch',
      rationale: 'Founder bandwidth is risk #5 (P=4, I=4). Without backup the 5:30am-10am, 6-day cadence is unsustainable.',
      impact: 'high', priority: 'P1', status: 'pending',
      payload: { stage: 'stage_7_ops', estimated_hours: 8 } },

    // Drafts the agent generated — awaiting founder approval
    { type: 'draft_email', title: 'F&F update — week of 2026-06-08',
      rationale: 'Weekly investor cadence. M. + J. signed; pipeline at $18k committed, $28k soft-circled.',
      impact: 'medium', priority: 'P2', status: 'pending',
      payload: {
        to: 'ff-investors@list.local',
        subject: 'Coffee Cart — Week 2 update ($18k committed)',
        body: 'Hi all,\n\nQuick update on week 2. M. and J. signed SAFEs — we crossed $18k committed against the $50k F&F target. Walkthrough at Lorimer St with D. on 2026-06-25.\n\nPermit application sitting at section 6 of 9; on track for August submission, well inside the 2026-09-30 close.\n\n— [Founder]',
      } },
    { type: 'draft_linkedin_post', title: 'Pre-launch teaser — 119 days to permit close',
      rationale: 'Specialty Curious persona is Instagram-driven but converts via LinkedIn for the operator/investor sub-audience.',
      impact: 'low', priority: 'P3', status: 'pending',
      payload: { body: 'I am building a pour-over coffee cart at a Brooklyn subway exit. $4.50 a cup, 90 seconds, no Starbucks queue. 119 days until the DCWP application window closes — first new permits in 14 years. Following the build in public.' } },
    { type: 'draft_linkedin_dm', title: 'DM intro to YC alum operator R.',
      rationale: 'Closest cohort partner with a food-service operating background — high-leverage informal advisor.',
      impact: 'medium', priority: 'P2', status: 'pending',
      payload: { to: 'R. (YC alum)', body: 'Hey — saw your operator post on commissary scheduling. I am opening a pour-over cart at Lorimer in fall 2026 and would love 20 min to ask about your wash-out logistics. No ask beyond a coffee on me.' } },

    // Proposals the agent surfaced — knowledge graph updates
    { type: 'proposed_graph_update', title: 'Add "Greenpoint Commissary" as partner node',
      rationale: 'Daily commissary wash-out is a hard health-dept requirement. Currently not in the graph — its absence is why "operations risk" felt under-weighted in the audit.',
      impact: 'medium', priority: 'P2', status: 'pending',
      payload: { node: { name: 'Greenpoint Commissary', type: 'partner', summary: '$400/mo, 5am open, walking distance to L stations' } } },
    { type: 'proposed_hypothesis', title: 'Test: $5 latte conversion lifts 12% if we add oat-milk option Wk 9',
      rationale: 'Specialty Curious cohort skews dairy-alt (Square data shows oat at 38% of latte orders at similar formats). Adding it as a $0.50 upcharge improves blended unit econ.',
      impact: 'medium', priority: 'P2', status: 'pending',
      payload: { hypothesis: 'Oat milk option lifts latte mix by 12% net of cannibalization', success_metric: 'Week 9-12 latte conversion ≥ 28%', cost: '~$30/wk milk inventory delta' } },

    // Already-actioned for the "Recently sent" tab
    { type: 'draft_email', title: 'Greenpoint Commissary slot confirmation',
      rationale: 'Slot expires 2026-06-15. Confirm the 6am Mon/Wed/Fri reservation.',
      impact: 'high', priority: 'P0', status: 'sent',
      payload: { to: 'ops@greenpointcommissary.com', subject: 'Confirming 6am slot — Coffee Cart NYC', body: 'Hi — confirming the Mon/Wed/Fri 6am wash-out slot through end of 2026. Will swing by this week to drop the deposit.' } },
    { type: 'task', title: 'Greenpoint Commissary site visit',
      rationale: 'Pre-flight check on the wash-out workflow.',
      impact: 'medium', priority: 'P2', status: 'applied',
      payload: { completed_at: '2026-06-01', notes: 'Slot confirmed, deposit dropped.' } },
  ];

  // Some actions reference a backfilled ecosystem_alert so the inbox shows the
  // "from signal" provenance link.
  const alerts = await sql`
    SELECT id FROM ecosystem_alerts WHERE project_id=${PROJECT_ID} AND id LIKE 'bf_%' ORDER BY created_at DESC LIMIT 2
  `;
  const alertIds = alerts.map(a => a.id);

  let i = 0;
  for (const a of actions) {
    const id = bf();
    const linkedAlert = i < alertIds.length && (a.type === 'proposed_hypothesis' || a.type === 'proposed_graph_update') ? alertIds[i++] : null;
    await sql`
      INSERT INTO pending_actions
        (id, project_id, ecosystem_alert_id, action_type, title, rationale,
         payload, estimated_impact, priority, status, sources)
      VALUES
        (${id}, ${PROJECT_ID}, ${linkedAlert}, ${a.type}, ${a.title}, ${a.rationale},
         ${sql.json(a.payload)}, ${a.impact}, ${a.priority}, ${a.status},
         ${sql.json([{ type: 'backfill', tag: 'demo-seed' }])})
    `;
  }
  console.log(`· pending_actions: +${actions.length}`);
}

// ───── llm_usage_logs (Usage page) ─────────────────────────────────────────
async function insertUsageLogs(userId) {
  // ~60 rows spread across last 14 days, mix of providers/models/skills, so the
  // /usage page shows trend, per-skill breakdown, and cache-hit percentages.
  const skills = [
    'idea-shaping', 'startup-scoring', 'market-research', 'simulation',
    'scientific-validation', 'risk-scoring', 'business-model', 'financial-model',
    'prototype-spec', 'gtm-strategy', 'growth-optimization',
    'build-landing-page', 'build-pitch-deck', 'build-one-pager',
    'investment-readiness', 'pitch-coaching', 'investor-relations',
    'weekly-metrics', 'chat',
  ];
  const tierByModel = {
    'claude-haiku-4-5':      { provider: 'anthropic', tier: 'cheap',    in: 0.80,  out: 4.00 },   // $/M
    'claude-sonnet-4-6':     { provider: 'anthropic', tier: 'balanced', in: 3.00,  out: 15.00 },
    'claude-opus-4-7':       { provider: 'anthropic', tier: 'premium',  in: 15.00, out: 75.00 },
    'gpt-4o-mini':           { provider: 'openai',    tier: 'cheap',    in: 0.15,  out: 0.60 },
    'gpt-4o':                { provider: 'openai',    tier: 'balanced', in: 2.50,  out: 10.00 },
  };
  const modelKeys = Object.keys(tierByModel);

  const rows = [];
  const now = Date.now();
  const HOUR = 3600 * 1000;
  for (let day = 13; day >= 0; day--) {
    // 3-6 logs per day, more on weekdays
    const isWeekend = (new Date(now - day * 24 * HOUR).getDay()) % 6 === 0;
    const count = isWeekend ? 3 : 5 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const skill = skills[Math.floor(Math.random() * skills.length)];
      // Chat + simulation usually hit balanced/premium; small skills hit cheap.
      const cheapSkill = ['weekly-metrics', 'build-one-pager', 'build-landing-page'].includes(skill);
      const expensiveSkill = ['simulation', 'market-research', 'chat'].includes(skill);
      const model = cheapSkill ? (Math.random() < 0.5 ? 'claude-haiku-4-5' : 'gpt-4o-mini')
                  : expensiveSkill ? (Math.random() < 0.7 ? 'claude-sonnet-4-6' : 'claude-opus-4-7')
                  : modelKeys[Math.floor(Math.random() * modelKeys.length)];
      const m = tierByModel[model];
      const inputTokens = 2000 + Math.floor(Math.random() * 18000);
      const outputTokens = 200 + Math.floor(Math.random() * 2400);
      const cacheRead = Math.random() < 0.65 ? Math.floor(inputTokens * (0.40 + Math.random() * 0.35)) : 0;
      const cacheCreate = cacheRead === 0 && Math.random() < 0.3 ? Math.floor(inputTokens * 0.6) : 0;
      const cost = (inputTokens / 1_000_000) * m.in
                 + (outputTokens / 1_000_000) * m.out
                 + (cacheRead / 1_000_000) * m.in * 0.1
                 + (cacheCreate / 1_000_000) * m.in * 1.25;
      const latency = 800 + Math.floor(Math.random() * 7000);
      const ts = new Date(now - day * 24 * HOUR - (i * 3 + Math.random() * 2) * HOUR);
      rows.push({
        skill, model, provider: m.provider,
        input_tokens: inputTokens, output_tokens: outputTokens,
        cache_creation_tokens: cacheCreate, cache_read_tokens: cacheRead,
        total_cost_usd: Number(cost.toFixed(6)), latency_ms: latency,
        created_at: ts.toISOString(),
      });
    }
  }

  for (const r of rows) {
    await sql`
      INSERT INTO llm_usage_logs
        (id, project_id, user_id, skill_id, step, provider, model,
         input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
         total_cost_usd, latency_ms, created_at)
      VALUES
        (${bf()}, ${PROJECT_ID}, ${userId}, ${r.skill === 'chat' ? null : r.skill},
         ${r.skill === 'chat' ? 'chat' : null}, ${r.provider}, ${r.model},
         ${r.input_tokens}, ${r.output_tokens}, ${r.cache_creation_tokens}, ${r.cache_read_tokens},
         ${r.total_cost_usd}, ${r.latency_ms}, ${r.created_at}::timestamp)
    `;
  }
  console.log(`· llm_usage_logs: +${rows.length}`);
}

main().catch(async (e) => {
  console.error('Extras failed:', e);
  await sql.end({ timeout: 5 });
  process.exit(1);
});

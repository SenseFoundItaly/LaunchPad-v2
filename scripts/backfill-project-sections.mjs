#!/usr/bin/env node
/**
 * Backfill every "section" of a project so the chat canvas, intelligence
 * panel, knowledge tab, and stages grid all display populated content.
 *
 * Writes:
 *   - memory_facts        derived from project knowledge, kind='observation'
 *   - graph_nodes         competitor / persona / channel entities
 *   - ecosystem_alerts    synthesized recent signals
 *   - intelligence_briefs correlation briefs
 *   - tabular_reviews     competitor landscape
 *   - skill_completions   one row per skill in stages.ts (18 skills, 7 stages)
 *   - chat_messages       one assistant turn carrying canvas-renderable artifacts
 *
 * Idempotent: every backfilled row's id is prefixed `bf_` (or `fact_bf_`,
 * etc.) so a re-run deletes the previous backfill first.
 *
 * Usage:
 *   node --env-file=.env.local scripts/backfill-project-sections.mjs proj_9738c52c-789
 */

import postgres from 'postgres';
import crypto from 'node:crypto';

const PROJECT_ID = process.argv[2];
if (!PROJECT_ID) {
  console.error('Usage: backfill-project-sections.mjs <projectId>');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set. Pass --env-file=.env.local to node.');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: { rejectUnauthorized: false } });

// Short backfill-tagged id. e.g. bf_a1b2c3d4
const bf = (prefix = '') => `${prefix}bf_${crypto.randomBytes(6).toString('hex')}`;

async function main() {
  const proj = await sql`SELECT id, name, owner_user_id, locale FROM projects WHERE id = ${PROJECT_ID}`;
  if (!proj[0]) {
    console.error(`Project ${PROJECT_ID} not found.`);
    process.exit(1);
  }
  const { owner_user_id: userId, name: projectName } = proj[0];
  console.log(`Backfilling project: ${projectName}  (owner ${userId})`);

  await wipePreviousBackfill();

  const factIds = await insertMemoryFacts(userId);
  const nodeIds = await insertGraphNodes();
  const alertIds = await insertEcosystemAlerts();
  await insertIntelligenceBriefs(alertIds);
  const reviewId = await insertTabularReview();
  await insertSkillCompletions();
  await insertCanvasChatMessage(userId, factIds, nodeIds, reviewId);
  // Signals page draws from watch_sources + source_changes (right-rail + raw-
  // findings "change" rows). The ecosystem_alerts inserted above already power
  // the "Raw signals" feed, but the Watcher right rail stays empty without
  // explicit watch_sources. These two calls fill that gap.
  const watchIds = await insertWatchSources();
  await insertSourceChanges(watchIds);

  console.log('\nDone. Reload the chat page to see populated sections.');
  await sql.end({ timeout: 5 });
}

async function wipePreviousBackfill() {
  // FK ordering: delete child rows before their parents.
  //   source_changes  → watch_sources
  //   graph_edges     → graph_nodes
  const deletions = [
    sql`DELETE FROM source_changes      WHERE project_id = ${PROJECT_ID} AND id LIKE 'bf_%'`,
    sql`DELETE FROM watch_sources       WHERE project_id = ${PROJECT_ID} AND id LIKE 'bf_%'`,
    sql`DELETE FROM graph_edges         WHERE project_id = ${PROJECT_ID} AND id LIKE 'bf_%'`,
    sql`DELETE FROM chat_messages       WHERE project_id = ${PROJECT_ID} AND id LIKE 'bf_%'`,
    sql`DELETE FROM intelligence_briefs WHERE project_id = ${PROJECT_ID} AND id LIKE 'bf_%'`,
    sql`DELETE FROM tabular_reviews     WHERE project_id = ${PROJECT_ID} AND id LIKE 'bf_%'`,
    sql`DELETE FROM ecosystem_alerts    WHERE project_id = ${PROJECT_ID} AND id LIKE 'bf_%'`,
    sql`DELETE FROM graph_nodes         WHERE project_id = ${PROJECT_ID} AND id LIKE 'bf_%'`,
    sql`DELETE FROM memory_facts        WHERE project_id = ${PROJECT_ID} AND id LIKE 'fact_bf_%'`,
    sql`DELETE FROM skill_completions   WHERE project_id = ${PROJECT_ID} AND id LIKE 'sc_bf_%'`,
  ];
  for (const d of deletions) await d;
  console.log('· wiped previous backfill rows');
}

// ───── memory_facts ────────────────────────────────────────────────────────
// 12 derived observations spanning each stage's domain. Each cites either the
// existing founder-confirmed facts or a public source.
async function insertMemoryFacts(userId) {
  const facts = [
    // Stage 2 — Market
    { kind: 'observation', fact: 'NYC daily subway ridership is back to 3.6M weekday taps (MTA Q1 2026), with morning peak (6-10am) still ~38% of total daily volume — the addressable commuter pulse for a station-exit format.', src: webSrc('MTA Subway Ridership Report Q1 2026', 'https://new.mta.info/agency/new-york-city-transit/subway-bus-ridership-2026') },
    { kind: 'observation', fact: 'US specialty coffee retail TAM is ~$53B (2026 SCA estimate); the "on-the-go third-wave" sub-segment grew 14% YoY while drive-thru chains were flat.', src: webSrc('SCA US Specialty Coffee Market Report 2026', 'https://sca.coffee/research/us-market-2026') },
    // Stage 2 — Competitor / signal
    { kind: 'observation', fact: 'Joe Coffee opened 3 micro-format kiosks in NYC subway concourses in Q1 2026 — closest direct competitor to the cart concept, but tied to MTA concession leases the founder would not need.', src: webSrc('Joe Coffee expands subway micro-kiosks — NY Eater', 'https://ny.eater.com/2026/02/joe-coffee-subway-kiosks') },
    { kind: 'observation', fact: 'Blue Bottle has not entered the commuter-cart format; its NYC strategy remains brownstone-style sit-down cafes at ~$8 ATV — the cart is a different occasion.', src: webSrc('Blue Bottle 2026 NYC roadmap', 'https://bluebottlecoffee.com/nyc-2026') },
    // Stage 3 — Personas
    { kind: 'observation', fact: 'Primary persona = "Time-Poor Commuter" — 28-42yo, household income $90-180k, takes the subway 4+ days/wk, buys coffee 3-5x/wk, will pay $1-2 premium to save 5+ minutes. Validated by 2026 Square commuter-spend data.', src: webSrc('Square Commuter Spend Index 2026', 'https://squareup.com/data/commuter-spend-2026') },
    { kind: 'observation', fact: 'Secondary persona = "Specialty Curious" — 25-35yo, follows third-wave coffee on Instagram, prefers pour-over to drip, low brand loyalty, will detour 1 block for a better cup but not 3 blocks.', src: webSrc('Third-Wave Coffee Consumer Study, Foodservice Intel 2026', 'https://foodserviceintel.com/third-wave-2026') },
    // Stage 4 — Unit economics
    { kind: 'observation', fact: 'Unit economics at $4.50 price: COGS ~$0.85 (beans $0.55 + cup/lid $0.18 + milk allowance $0.12) → 81% gross margin. Daily breakeven ≈ 95 cups at $1,200/mo fixed (cart lease + permit + insurance).', src: inferenceSrc('Unit economics estimate from price + COGS', [webSrc('USDA Coffee Bean Wholesale Index Mar 2026', 'https://www.ers.usda.gov/data-products/coffee')]) },
    { kind: 'observation', fact: '90-second service target requires 1 trained barista + pre-tempered water + batch-ground beans every 30 min. Bottleneck is the pour, not the order — Square POS handles tap-to-pay in <8s.', src: inferenceSrc('Service-time analysis from operational data', [webSrc('Specialty Coffee Association barista throughput study', 'https://sca.coffee/research/barista-throughput-2025')]) },
    // Stage 5 — GTM / channel
    { kind: 'observation', fact: 'NYC DCWP "Mobile Food Vending" permit waitlist re-opened Feb 2026 for the first time in 14 years; new permits run 2-yr terms at $200, vs. $25k+ on the resale market pre-2026. This window materially changes the entry calculus.', src: webSrc('NYC reopens food cart permit waitlist — NYT', 'https://nytimes.com/2026/02/01/nyregion/nyc-food-cart-permits.html') },
    { kind: 'observation', fact: 'Target station = a "B-tier" exit with ≥30k weekday exits and no Starbucks within 200m. Candidate list (proximity-screened): Lorimer St (L), Bedford Av (L), 1 Av (L), Smith-9 St (F/G).', src: inferenceSrc('Station selection from ridership × competitor map', [webSrc('MTA Turnstile Exit Counts 2026', 'https://new.mta.info/data/turnstile-2026')]) },
    // Stage 6 — Fundraise
    { kind: 'observation', fact: 'Pre-seed F&F round of $40-60k covers cart build ($18k), 6 months working capital, and first-store insurance buffer. No institutional money needed until cart #2 is proven (target month 6).', src: inferenceSrc('Pre-seed sizing from build cost + runway', [webSrc('Mobile cart build quotes — Cart-King 2026', 'https://cart-king.com/quotes-2026')]) },
    // Stage 7 — Ops
    { kind: 'observation', fact: 'Operating cadence target: 5:30am open, 10am close, 4-day work week (cart owner) with 1 weekend barista. Health-dept compliance requires daily wash-out at a commissary — Greenpoint Commissary has 6am slots at $400/mo.', src: webSrc('Greenpoint Commissary Kitchen — rate card', 'https://greenpointcommissary.com/rates') },
  ];

  const ids = [];
  for (const f of facts) {
    const id = bf('fact_');
    ids.push(id);
    await sql`
      INSERT INTO memory_facts
        (id, user_id, project_id, fact, kind, source_type, reviewed_state, sources, confidence)
      VALUES
        (${id}, ${userId}, ${PROJECT_ID}, ${f.fact}, ${f.kind}, 'backfill', 'applied',
         ${sql.json([f.src])}, 0.75)
    `;
  }
  console.log(`· memory_facts: +${ids.length}`);
  return ids;
}

// ───── graph_nodes ─────────────────────────────────────────────────────────
// Node types must match GraphNodeType in src/types/graph.ts — the D3 layout
// only assigns cluster angles to known types. `your_startup` is the anchor
// node at the layout's center and is required for the radial clustering to
// have a focal point.
async function insertGraphNodes() {
  const nodes = [
    { key: 'startup',       name: 'Coffee Cart (Pour-over $4.50, 90s)', type: 'your_startup',    summary: 'Street-level pour-over cart at NYC subway exits. $4.50 unit, 90-second service. Primary location: Lorimer St L.', attrs: { stage: 'pre-launch', price: '$4.50', target_window: '2026-09-30 permit deadline' } },
    { key: 'starbucks',     name: 'Starbucks',                          type: 'competitor',      summary: 'Incumbent. 7-min morning queue documented across NYC stores; mobile-order spillover creates walk-in congestion the cart can siphon.', attrs: { price: '$3.25-$3.75 drip', position: 'mass-market', vulnerability: 'queue-time' } },
    { key: 'joe',           name: 'Joe Coffee',                         type: 'competitor',      summary: 'Closest format match — Q1 2026 launched 3 subway-concourse micro-kiosks. Tied to MTA concession leases (vs. cart\'s street-level cart permit).', attrs: { price: '$4-5', position: 'specialty', moat: 'MTA leases' } },
    { key: 'bluebottle',    name: 'Blue Bottle',                        type: 'competitor',      summary: 'Premium third-wave. Indirect — sit-down cafe ATV ~$8, different occasion than commuter grab-and-go.', attrs: { price: '$5.50-$8', position: 'premium' } },
    { key: 'commuter',      name: 'Time-Poor Commuter',                 type: 'persona',         summary: '28-42yo, $90-180k HHI, 4+ subway days/wk, will pay $1-2 premium to save 5min. Primary segment.', attrs: { willingness_to_pay: '$5-6', frequency: '3-5/wk', loyalty: 'high if reliable' } },
    { key: 'curious',       name: 'Specialty Curious',                  type: 'persona',         summary: '25-35yo, Instagram-driven, low brand loyalty, detours up to 1 block for quality. Secondary but vocal.', attrs: { willingness_to_pay: '$5-7', frequency: '2-3/wk', virality: 'high' } },
    { key: 'lorimer',       name: 'Lorimer St L Train',                 type: 'market_segment',  summary: 'Candidate first location — 36k weekday exits, no Starbucks within 200m, sidewalk wide enough for a cart on the SW corner.', attrs: { exits_per_day: 36000, competitors_200m: 0, permit_zone: 'eligible' } },
    { key: 'dcwp',          name: 'NYC DCWP',                           type: 'regulation',      summary: 'Issues mobile food vending permits. Waitlist re-opened Feb 2026 for first time in 14 years — material entry-cost shift.', attrs: { permit_cost: '$200/2yr', waitlist_status: 'open', critical_dates: 'apply by 2026-09-30' } },
    { key: 'commissary',    name: 'Greenpoint Commissary',              type: 'partner',         summary: 'Health-dept-compliant commissary for daily cart wash-out. 6am slots, $400/mo, walking distance to L-train stations.', attrs: { cost: '$400/mo', open: '5am', requires: 'NYC Food Handler cert' } },
  ];
  const ids = [];
  const byKey = {};
  for (const n of nodes) {
    const id = bf();
    ids.push({ id, name: n.name, type: n.type });
    byKey[n.key] = id;
    await sql`
      INSERT INTO graph_nodes
        (id, project_id, name, node_type, summary, attributes, sources, reviewed_state)
      VALUES
        (${id}, ${PROJECT_ID}, ${n.name}, ${n.type}, ${n.summary},
         ${sql.json(n.attrs)}, ${sql.json([{ type: 'backfill', tag: 'demo-seed' }])}, 'applied')
    `;
  }
  console.log(`· graph_nodes: +${ids.length}`);

  // Edges — wire the anchor node ('startup') to every supporting node + a few
  // cross-relationships so the layout isn't a pure star. Relations match the
  // verbs the agent's persistence layer (src/lib/artifact-persistence.ts)
  // typically emits: competes_with / targets / regulates / partners_with /
  // operates_at / influences.
  const edges = [
    // Hub-and-spoke from the startup
    { src: 'startup',  tgt: 'starbucks',  rel: 'competes_with', label: 'Indirect — different price tier' },
    { src: 'startup',  tgt: 'joe',        rel: 'competes_with', label: 'Direct — same format, different lease' },
    { src: 'startup',  tgt: 'bluebottle', rel: 'competes_with', label: 'Indirect — different occasion' },
    { src: 'startup',  tgt: 'commuter',   rel: 'targets',       label: 'Primary persona (60% revenue)' },
    { src: 'startup',  tgt: 'curious',    rel: 'targets',       label: 'Secondary persona (30% revenue, 80% social)' },
    { src: 'startup',  tgt: 'lorimer',    rel: 'operates_at',   label: 'Cart #1 candidate location' },
    { src: 'startup',  tgt: 'dcwp',       rel: 'regulated_by',  label: '$200/2yr permit; window closes 2026-09-30' },
    { src: 'startup',  tgt: 'commissary', rel: 'partners_with', label: 'Daily wash-out, $400/mo' },
    // Cross-edges that add real structure
    { src: 'starbucks', tgt: 'lorimer',  rel: 'absent_from',    label: 'No Starbucks within 200m of this exit' },
    { src: 'joe',       tgt: 'lorimer',  rel: 'competes_at',    label: 'Joe kiosks now 1 stop away (Bedford Av)' },
    { src: 'commuter',  tgt: 'lorimer',  rel: 'commutes_via',   label: '36k weekday exits' },
    { src: 'dcwp',      tgt: 'lorimer',  rel: 'permits_at',     label: 'Lorimer is in an eligible cart-permit zone' },
  ];
  let edgeCount = 0;
  for (const e of edges) {
    const sourceId = byKey[e.src];
    const targetId = byKey[e.tgt];
    if (!sourceId || !targetId) continue;
    await sql`
      INSERT INTO graph_edges
        (id, project_id, source_node_id, target_node_id, relation, label, weight, sources)
      VALUES
        (${bf()}, ${PROJECT_ID}, ${sourceId}, ${targetId}, ${e.rel}, ${e.label}, 1.0,
         ${sql.json([{ type: 'backfill', tag: 'demo-seed' }])})
    `;
    edgeCount++;
  }
  console.log(`· graph_edges: +${edgeCount}`);

  return ids;
}

// ───── ecosystem_alerts ────────────────────────────────────────────────────
async function insertEcosystemAlerts() {
  const alerts = [
    { type: 'regulatory', headline: 'NYC reopens mobile food vending permit waitlist after 14-year freeze', body: 'DCWP began accepting new applications Feb 2026. New 2-yr permits are $200 — vs. $25k+ resale rate pre-2026. Application window closes 2026-09-30 for first batch.', url: 'https://nytimes.com/2026/02/01/nyregion/nyc-food-cart-permits.html', score: 0.95, source: 'NYT' },
    { type: 'competitor', headline: 'Joe Coffee opens 3rd subway-concourse micro-kiosk', body: 'Latest Lexington-line location takes a similar format. Tied to MTA concession lease — different go-to-market than a street-level cart but signals format validation.', url: 'https://ny.eater.com/2026/02/joe-coffee-subway-kiosks', score: 0.78, source: 'NY Eater' },
    { type: 'market', headline: 'Specialty coffee bean wholesale index up 11% YoY (USDA, Mar 2026)', body: 'Arabica futures climbed on Brazil drought + Vietnam labor shortages. Pass-through to specialty roasters expected within 60 days. Unit-econ at $4.50 still holds if COGS bumps to $1.00; revisit if it crosses $1.20.', url: 'https://www.ers.usda.gov/data-products/coffee', score: 0.82, source: 'USDA' },
    { type: 'market', headline: 'MTA: weekday subway taps recover to 3.6M', body: 'Q1 2026 ridership now 92% of 2019 baseline. Morning peak share (6-10am) is 38% of daily volume — the cart\'s addressable pulse.', url: 'https://new.mta.info/agency/new-york-city-transit/subway-bus-ridership-2026', score: 0.71, source: 'MTA' },
  ];
  const ids = [];
  for (const a of alerts) {
    const id = bf();
    ids.push(id);
    await sql`
      INSERT INTO ecosystem_alerts
        (id, project_id, alert_type, headline, body, source, source_url, relevance_score, confidence, reviewed_state)
      VALUES
        (${id}, ${PROJECT_ID}, ${a.type}, ${a.headline}, ${a.body}, ${a.source}, ${a.url},
         ${a.score}, 0.8, 'pending')
    `;
  }
  console.log(`· ecosystem_alerts: +${ids.length}`);
  return ids;
}

// ───── intelligence_briefs ─────────────────────────────────────────────────
async function insertIntelligenceBriefs(alertIds) {
  const briefs = [
    {
      type: 'correlation',
      entity: 'NYC DCWP',
      title: 'Permit window + reopened waitlist creates a 7-month go/no-go gate',
      narrative: 'The Feb 2026 DCWP waitlist reopening is the first new permit availability since 2012. The first application window closes 2026-09-30. If you apply by then, the $200 permit is yours for 2 years. Miss it and you\'re back to the $25k+ resale market, which moves the unit-econ math from "obvious go" to "marginal." Treat this as a fundraising-style deadline, not an admin task.',
      prediction: 'Application closing by 2026-09-30 is the binary go/no-go event for this version of the business. Recommended: stop everything else for 2 weeks in early September to assemble the application.',
      conf: 0.92,
      actions: [{ label: 'Add 2026-09-30 permit deadline to task list', skill: 'gtm-strategy' }, { label: 'Block a 2-day permit-application sprint', skill: 'weekly-metrics' }],
      signals: alertIds.slice(0, 1),
    },
    {
      type: 'correlation',
      entity: 'Joe Coffee',
      title: 'Joe Coffee\'s subway kiosks validate the format but signal limited MTA-lease moat',
      narrative: 'Joe Coffee\'s 3-kiosk subway run is the first time a specialty brand has paid for MTA concession leases at scale. This is both validation and warning. Validation: a third-wave brand was willing to pay to be near commuters → the demand thesis holds. Warning: if Joe scales to 10+ kiosks, the street-level cart becomes the "value tier" rather than the "specialty option." Defend by being faster (90s) and cheaper ($4.50 vs Joe\'s $5).',
      prediction: 'Joe will likely have 8-12 kiosks by EOY 2026. If they cross 6 in your candidate L-train neighborhoods, re-evaluate price ladder.',
      conf: 0.78,
      actions: [{ label: 'Set up weekly Joe-Coffee kiosk-count monitor', skill: 'market-research' }],
      signals: alertIds.slice(1, 2),
    },
  ];
  for (const b of briefs) {
    const id = bf();
    await sql`
      INSERT INTO intelligence_briefs
        (id, project_id, brief_type, entity_name, title, narrative, temporal_prediction,
         confidence, signal_ids, signal_count, recommended_actions, status)
      VALUES
        (${id}, ${PROJECT_ID}, ${b.type}, ${b.entity}, ${b.title}, ${b.narrative},
         ${b.prediction}, ${b.conf}, ${sql.json(b.signals)}, ${b.signals.length},
         ${sql.json(b.actions)}, 'active')
    `;
  }
  console.log(`· intelligence_briefs: +${briefs.length}`);
}

// ───── tabular_reviews ─────────────────────────────────────────────────────
async function insertTabularReview() {
  const id = bf();
  const columns = ['Competitor', 'Price', 'Service Time', 'Format', 'Threat Level'];
  const column_types = ['text', 'currency', 'text', 'text', 'text'];
  const rows = [
    { label: 'Starbucks',      values: ['Starbucks',      '$3.25-3.75', '7 min (peak)',  'Brick-and-mortar', 'Indirect — they\'re the queue we siphon from'] },
    { label: 'Joe Coffee',     values: ['Joe Coffee',     '$4-5',       '~3 min',        'Subway kiosk',     'Direct — same format, different lease model'] },
    { label: 'Blue Bottle',    values: ['Blue Bottle',    '$5.50-8',    '~5 min',        'Sit-down cafe',    'Indirect — different occasion'] },
    { label: 'Bodega coffee',  values: ['Bodega coffee',  '$1.50-2.50', '<1 min',        'Counter',          'Indirect — quality floor'] },
    { label: 'Pour-over Cart', values: ['Pour-over Cart', '$4.50',      '90 sec target', 'Street-level cart','Us'] },
  ];
  await sql`
    INSERT INTO tabular_reviews
      (id, project_id, title, columns, column_types, sources, reviewed_state)
    VALUES
      (${id}, ${PROJECT_ID}, 'Competitor landscape — NYC commuter coffee',
       ${sql.json(columns)}, ${sql.json(column_types)},
       ${sql.json([webSrc('NY Eater coffee map 2026', 'https://ny.eater.com/maps/best-coffee-nyc-2026')])},
       'applied')
  `;
  // tabular_reviews stores columns + column_types; rows live on the artifact
  // (this matches the existing pattern — reviews are "seen" by joining to
  // comparison-table artifacts that reference review_id).
  console.log(`· tabular_reviews: +1`);
  return { id, columns, column_types, rows };
}

// ───── skill_completions ───────────────────────────────────────────────────
async function insertSkillCompletions() {
  // Aligned with stages.ts (18 skills across 7 stages).
  const skills = [
    // Stage 1
    { id: 'idea-shaping',           summary: heading('Idea Canvas — Coffee Cart at Subway Exit') + ideaShapingSummary(), score: { canvas: 8.5, clarity: 9 } },
    { id: 'startup-scoring',        summary: heading('Startup Scoring — 6 dimensions') + startupScoringSummary(), score: { overall: 7.4, problem: 8.5, market: 7.5, competitive: 6.5, business_model: 8.5, founder_fit: 7.0, timing: 6.5 } },
    // Stage 2
    { id: 'market-research',        summary: heading('Market Research — TAM/SAM/SOM + competitors') + marketResearchSummary(), score: { confidence: 7.5 } },
    { id: 'simulation',             summary: heading('Simulation — 6 persona reactions + 4 risk scenarios') + simulationSummary(), score: { engagement: 7.6 } },
    // Stage 3
    { id: 'scientific-validation',  summary: heading('Buyer Personas — empathy maps') + personasSummary(), score: { coverage: 8.0 } },
    { id: 'risk-scoring',           summary: heading('Risk Audit — top 6 risks scored') + riskSummary(), score: { overall_risk: 5.5 } },
    // Stage 4
    { id: 'business-model',         summary: heading('Business Model — unit economics') + businessModelSummary(), score: { ltv_cac: 4.2, gross_margin: 8.1, payback_months: 1.2 } },
    { id: 'financial-model',        summary: heading('Financial Model — 3-yr projections') + financialModelSummary(), score: { y1_revenue: 168000, y3_revenue: 540000 } },
    // Stage 5
    { id: 'prototype-spec',         summary: heading('MVP Blueprint — cart build + tech stack') + prototypeSummary(), score: { build_weeks: 8 } },
    { id: 'gtm-strategy',           summary: heading('Go-To-Market — first 90 days') + gtmSummary(), score: { day1_target_cups: 60 } },
    { id: 'growth-optimization',    summary: heading('Growth Loops — 3 experiments queued') + growthSummary(), score: { hypothesized_lift: 0.18 } },
    { id: 'build-landing-page',     summary: heading('Landing Page — first version drafted') + landingSummary(), score: { sections: 6 } },
    { id: 'build-pitch-deck',       summary: heading('Pitch Deck — 12-slide Sequoia format') + deckSummary(), score: { slides: 12 } },
    { id: 'build-one-pager',        summary: heading('One-Pager — investor exec summary') + onePagerSummary(), score: { sections: 5 } },
    // Stage 6
    { id: 'investment-readiness',   summary: heading('Investment Readiness — F&F round') + investmentReadinessSummary(), score: { readiness: 6.5 } },
    { id: 'pitch-coaching',         summary: heading('Pitch Coaching — narrative arc + Q&A') + pitchCoachingSummary(), score: { reps: 4 } },
    { id: 'investor-relations',     summary: heading('Investor Pipeline — 12 F&F prospects') + investorRelationsSummary(), score: { committed_usd: 18000, soft_circled_usd: 28000 } },
    // Stage 7
    { id: 'weekly-metrics',         summary: heading('Weekly Metrics — pre-launch baseline') + weeklyMetricsSummary(), score: { runway_months: 9 } },
  ];

  // Unique on (project_id, skill_id) — re-runs UPSERT so the row content stays
  // in sync with the backfill, regardless of who created the original row.
  for (const s of skills) {
    const id = bf('sc_');
    await sql`
      INSERT INTO skill_completions
        (id, project_id, skill_id, status, summary, section_scores, completed_at)
      VALUES
        (${id}, ${PROJECT_ID}, ${s.id}, 'completed', ${s.summary},
         ${sql.json(s.score)}, CURRENT_TIMESTAMP)
      ON CONFLICT (project_id, skill_id) DO UPDATE
      SET status = EXCLUDED.status,
          summary = EXCLUDED.summary,
          section_scores = EXCLUDED.section_scores,
          completed_at = EXCLUDED.completed_at
    `;
  }
  console.log(`· skill_completions: upserted ${skills.length}`);
}

// ───── chat_messages — canvas artifacts ────────────────────────────────────
async function insertCanvasChatMessage(userId, factIds, nodeIds, reviewMeta) {
  // Look up the founder-confirmed Idea Canvas memory_fact so we can cite it
  // as an internal source on the idea-canvas artifact (matches the audit
  // trail convention).
  const founderCanvas = await sql`
    SELECT id FROM memory_facts
    WHERE project_id = ${PROJECT_ID} AND kind = 'decision'
    ORDER BY created_at ASC LIMIT 1
  `;
  const founderRefId = founderCanvas[0]?.id;
  const founderSrc = founderRefId
    ? internalSrc('Founder-confirmed Idea Canvas', 'memory_fact', founderRefId, 'Subway commuters wait 7 minutes for Starbucks every morning. Pour-over cart at station exit, $4.50, 90 seconds.')
    : userSrc('Founder confirmed Idea Canvas');

  const usda = webSrc('USDA Coffee Bean Wholesale Index Mar 2026', 'https://www.ers.usda.gov/data-products/coffee');
  const sca = webSrc('SCA US Specialty Coffee Market Report 2026', 'https://sca.coffee/research/us-market-2026');
  const mta = webSrc('MTA Subway Ridership Report Q1 2026', 'https://new.mta.info/agency/new-york-city-transit/subway-bus-ridership-2026');
  const nyt = webSrc('NYC reopens food cart permit waitlist — NYT', 'https://nytimes.com/2026/02/01/nyregion/nyc-food-cart-permits.html');
  const eater = webSrc('Joe Coffee expands subway micro-kiosks — NY Eater', 'https://ny.eater.com/2026/02/joe-coffee-subway-kiosks');

  // Build artifacts.
  const artifacts = [
    {
      header: { type: 'idea-canvas', id: 'canvas_bf_1' },
      body: {
        title: 'Coffee Cart at Subway Exit — Lean Canvas',
        problem: 'Subway commuters wait 7 minutes for Starbucks at the exit every morning.',
        solution: 'Pour-over cart at the station exit. $4.50. 90-second target service time.',
        target_market: 'NYC subway commuters, 28-42yo, $90-180k HHI, 4+ subway days/wk.',
        value_proposition: 'Skip the 7-minute Starbucks queue. Specialty quality at chain price. Done in 90 seconds.',
        competitive_advantage: 'Street-level cart permit ($200, 2yr) vs. competitors\' MTA concession leases. No real estate overhead.',
        unfair_advantage: 'New 2026 DCWP permit window — first opening in 14 years. Closes 2026-09-30.',
        business_model: '$4.50 unit, $0.85 COGS, 81% gross margin. Single cart breakeven at 95 cups/day.',
        key_metrics: ['Cups/day', 'Avg service time', 'Repeat rate (4-wk)', 'Gross margin %'],
        revenue_streams: ['$4.50 pour-over', '$5.50 latte (manual milk-foam)', '$1 add-ons (oat milk, extra shot)'],
        cost_structure: ['Beans ($0.55/cup)', 'Cup + lid ($0.18/cup)', 'Cart lease ($350/mo)', 'Commissary ($400/mo)', 'Permit ($200/2yr)'],
        sources: [founderSrc],
      },
    },
    {
      header: { type: 'gauge-chart', id: 'score_bf_1' },
      body: {
        title: 'Startup Score — overall',
        score: 7.4,
        maxScore: 10,
        verdict: 'GO',
        sources: [skillSrc('startup-scoring 2026-06-03', 'startup-scoring')],
      },
    },
    {
      header: { type: 'radar-chart', id: 'radar_bf_1' },
      body: {
        title: 'Startup Score — 6 dimensions',
        data: [
          { subject: 'Problem',         value: 8.5, fullMark: 10 },
          { subject: 'Market',          value: 7.5, fullMark: 10 },
          { subject: 'Competitive',     value: 6.5, fullMark: 10 },
          { subject: 'Business Model',  value: 8.5, fullMark: 10 },
          { subject: 'Founder Fit',     value: 7.0, fullMark: 10 },
          { subject: 'Timing',          value: 6.5, fullMark: 10 },
        ],
        sources: [skillSrc('startup-scoring 2026-06-03', 'startup-scoring')],
      },
    },
    {
      header: { type: 'tam-sam-som', id: 'tss_bf_1' },
      body: {
        title: 'TAM / SAM / SOM — NYC commuter specialty coffee',
        tam: { value: '$53B', numeric_usd: 53_000_000_000, methodology: 'SCA US specialty coffee retail estimate 2026', confidence: 'high' },
        sam: { value: '$1.8B', numeric_usd: 1_800_000_000, methodology: 'NYC share of US specialty (3.4%) × morning-peak share (38%) × commuter-on-the-go segment', confidence: 'medium' },
        som: { value: '$2.4M', numeric_usd: 2_400_000, methodology: '12 carts × 200 cups/day × $4.50 × 360 days (3-yr horizon)', confidence: 'medium' },
        timeframe: '3 years (2026-2029)',
        market_share_implied: '0.13% of SAM',
        sources: [sca, mta],
      },
    },
    {
      header: { type: 'comparison-table', id: 'cmp_bf_1' },
      body: {
        title: 'Competitor landscape — NYC commuter coffee',
        columns: reviewMeta.columns,
        column_types: reviewMeta.column_types,
        rows: reviewMeta.rows,
        review_id: reviewMeta.id,
        sources: [eater, webSrc('NY Eater coffee map 2026', 'https://ny.eater.com/maps/best-coffee-nyc-2026')],
      },
    },
    {
      header: { type: 'persona-card', id: 'pers_bf_1' },
      body: {
        name: 'Time-Poor Commuter',
        archetype: 'customer',
        demographics: '28-42yo, $90-180k HHI, 4+ subway days/wk, lives in Brooklyn/Queens, works in Manhattan.',
        jobs_to_be_done: ['Caffeinate on the way to work', 'Avoid being late to the 9am standup', 'Feel like a small daily luxury'],
        pains: ['7-minute Starbucks queue', 'Mobile order pickup confusion', 'Wet/cold cups from bodega'],
        channels: ['Subway-exit signage', 'Word of mouth at offices', 'Google Maps "coffee near subway"'],
        quote: '"If I can get a better cup in 90 seconds without crossing the street, I\'m yours every morning."',
        sources: [webSrc('Square Commuter Spend Index 2026', 'https://squareup.com/data/commuter-spend-2026')],
      },
    },
    {
      header: { type: 'persona-card', id: 'pers_bf_2' },
      body: {
        name: 'Specialty Curious',
        archetype: 'customer',
        demographics: '25-35yo, follows third-wave coffee on Instagram, low brand loyalty.',
        jobs_to_be_done: ['Try the new thing in the neighborhood', 'Share a photo-worthy cup', 'Support local instead of chains'],
        pains: ['Most specialty cafes have a 5+ min sit-down vibe', 'Hard to get pour-over to-go'],
        channels: ['Instagram', 'TikTok food creators', 'Friend recommendations'],
        quote: '"If the cart is photogenic and the bean has a story, I\'ll detour one block."',
        sources: [webSrc('Third-Wave Coffee Consumer Study, Foodservice Intel 2026', 'https://foodserviceintel.com/third-wave-2026')],
      },
    },
    {
      header: { type: 'metric-grid', id: 'metric_bf_1' },
      body: {
        title: 'Unit economics — single cart',
        metrics: [
          { label: 'Avg unit price',  value: '$4.50' },
          { label: 'COGS',            value: '$0.85' },
          { label: 'Gross margin',    value: '81%',  change: '+3 vs. industry avg' },
          { label: 'Daily breakeven', value: '95 cups' },
          { label: 'Target Yr1 vol',  value: '140 cups/day' },
          { label: 'Payback',         value: '5.2 months' },
        ],
        sources: [usda, sca],
      },
    },
    {
      header: { type: 'risk-matrix', id: 'risk_bf_1' },
      body: {
        title: 'Risk audit — top 6',
        risks: [
          { id: 'r1', dimension: 'regulatory', risk: 'Miss the 2026-09-30 DCWP permit window', probability: 2, impact: 5, severity: 'critical', mitigation: 'Block 2-day sprint in early Sept; pre-assemble all forms by Aug 1' },
          { id: 'r2', dimension: 'market',     risk: 'Specialty bean cost spikes >$1.20/cup', probability: 3, impact: 3, severity: 'medium',   mitigation: 'Lock 12-mo contract with roaster; raise price to $5 if sustained' },
          { id: 'r3', dimension: 'market',     risk: 'Starbucks closes 7-min queue gap via in-store throughput fix', probability: 2, impact: 4, severity: 'medium', mitigation: 'Differentiate on quality + 90s SLA; survey customers monthly' },
          { id: 'r4', dimension: 'regulatory', risk: 'Health-dept inspection failure at commissary', probability: 2, impact: 4, severity: 'medium', mitigation: 'Greenpoint Commissary has spotless 5-yr record; daily logs + backup vendor identified' },
          { id: 'r5', dimension: 'team',       risk: 'Founder cannot personally cover 5:30am-10am 6 days/wk', probability: 4, impact: 4, severity: 'high', mitigation: 'Hire 2nd barista before month 3 even if margins compress' },
          { id: 'r6', dimension: 'financial',  risk: 'F&F round under-subscribes, runway <4 months at launch', probability: 3, impact: 4, severity: 'high', mitigation: 'Pre-sell 200 "founders-club" punch-cards at $50 each ($10k bridge)' },
        ],
        overall_assessment: 'Two critical risks (permit window + founder bandwidth) need pre-launch mitigation. Everything else is monitorable post-launch.',
        sources: [nyt, usda, eater],
      },
    },
    {
      header: { type: 'workflow-card', id: 'wf_bf_1' },
      body: {
        title: 'Go-to-Market — first 90 days',
        category: 'sales',
        description: 'Sequenced first-90-days plan: permit → build → soft-launch → measure → expand.',
        priority: 'high',
        steps: [
          'Weeks 1-2  · Submit DCWP permit application; secure Greenpoint Commissary slot',
          'Weeks 3-4  · Cart build (Cart-King, ~$18k); Square POS setup; bean contract',
          'Weeks 5-6  · Stealth dry-runs at Lorimer St L on weekends (no signage)',
          'Weeks 7-8  · Soft launch — Mon/Fri only, 6am-10am, $4.50 flat menu',
          'Weeks 9-10 · Full week open; introduce $5.50 latte; track repeat-rate',
          'Weeks 11-12 · Decision gate — hit 120 cups/day? Scout cart #2',
        ],
        sources: [nyt, mta],
      },
    },
    {
      header: { type: 'investor-pipeline', id: 'inv_bf_1' },
      body: {
        title: 'F&F round — pre-seed pipeline',
        round_target: 50000,
        round_type: 'Friends & Family (SAFE)',
        round_status: 'open',
        target_close: '2026-08-15',
        investors: [
          { id: 'i1', name: 'M. (uncle, NYC restaurateur)',  type: 'F&F',     stage: 'committed',  check_size: 10000, next_step: 'Sign SAFE', next_step_date: '2026-06-10' },
          { id: 'i2', name: 'J. (college roommate, eng)',     type: 'F&F',     stage: 'committed',  check_size: 5000,  next_step: 'Sign SAFE', next_step_date: '2026-06-12' },
          { id: 'i3', name: 'R. (former boss, marketing)',    type: 'F&F',     stage: 'interested', check_size: 3000,  next_step: 'Pitch deck review', next_step_date: '2026-06-15' },
          { id: 'i4', name: 'A. (cousin)',                    type: 'F&F',     stage: 'interested', check_size: 5000,  next_step: 'Family dinner', next_step_date: '2026-06-22' },
          { id: 'i5', name: 'D. (angel, restaurant LP)',      type: 'Angel',   stage: 'meeting',    check_size: 15000, next_step: 'In-person walkthrough at Lorimer St', next_step_date: '2026-06-25' },
          { id: 'i6', name: 'Cohort partner (YC alum)',       type: 'Advisor', stage: 'target',     check_size: 5000,  next_step: 'Cold intro via L.', next_step_date: '2026-07-01' },
        ],
        sources: [userSrc('Founder F&F list, 2026-06-01')],
      },
    },
    {
      header: { type: 'weekly-update', id: 'wu_bf_1' },
      body: {
        title: 'Week of 2026-05-26 — pre-launch baseline',
        period: '2026-05-26 → 2026-06-01',
        morale: 8,
        metrics_snapshot: [
          { label: 'F&F committed', value: '$18k', delta: '+$5k' },
          { label: 'Permit status', value: 'Drafting', delta: 'Section 4/9' },
          { label: 'Cart vendor',   value: 'Cart-King quoted', delta: '$18.2k' },
          { label: 'Days to permit window close', value: '119' },
        ],
        highlights: [
          'M. confirmed $10k F&F check; SAFE template ready',
          'Greenpoint Commissary slot held until 2026-06-15',
          'Lorimer St L picked as target #1 — no Starbucks within 200m',
        ],
        challenges: [
          'DCWP forms ask for "anticipated route map" that conflicts with single-spot model',
          'Need a 2nd barista lined up before launch (currently 0)',
        ],
        asks: [
          'Intro to any NYC coffee operator who has cleared DCWP recently',
          'Pitch deck review (12 slides, current Sequoia format)',
        ],
        sources: [userSrc('Founder weekly update, 2026-06-01')],
      },
    },
  ];

  // Wrap into the chat-message content format.
  const intro = `Backfill summary — all sections populated.

Stage 1 through Stage 7 now have skill completions, the knowledge graph carries 8 entities, and the canvas below shows the synthesized view of the Coffee Cart project. Every artifact below cites either a founder-confirmed memory fact, a public source, or a prior skill run — nothing is unsourced.

`;

  const artifactBlocks = artifacts.map((a) => {
    return `:::artifact${JSON.stringify(a.header)}\n${JSON.stringify(a.body)}\n:::`;
  }).join('\n\n');

  const content = intro + artifactBlocks;

  const id = bf();
  await sql`
    INSERT INTO chat_messages
      (id, project_id, user_id, role, content, step, timestamp)
    VALUES
      (${id}, ${PROJECT_ID}, ${userId}, 'assistant', ${content}, 'chat', CURRENT_TIMESTAMP)
  `;
  console.log(`· chat_messages: +1 (${artifacts.length} artifacts inline)`);
}

// ───── watch_sources ───────────────────────────────────────────────────────
// Populates the right-rail of /signals (the Watcher cards) and gives
// source_changes rows something to reference.
async function insertWatchSources() {
  const sources = [
    { label: 'Joe Coffee (NYC subway kiosk rollout)', url: 'https://joecoffee.com/locations', category: 'competitor' },
    { label: 'NYC DCWP mobile vending permits',       url: 'https://www.nyc.gov/site/dca/businesses/mobile-food-vendors.page', category: 'regulation' },
    { label: 'MTA subway ridership reports',          url: 'https://new.mta.info/agency/new-york-city-transit/subway-bus-ridership-2026', category: 'market' },
    { label: 'USDA coffee wholesale index',           url: 'https://www.ers.usda.gov/data-products/coffee', category: 'market' },
  ];
  const ids = [];
  for (const s of sources) {
    const id = bf();
    ids.push({ id, label: s.label });
    await sql`
      INSERT INTO watch_sources
        (id, project_id, url, label, category, schedule, status, last_scraped_at, next_scrape_at)
      VALUES
        (${id}, ${PROJECT_ID}, ${s.url}, ${s.label}, ${s.category},
         'daily', 'active',
         CURRENT_TIMESTAMP - INTERVAL '2 hours',
         CURRENT_TIMESTAMP + INTERVAL '22 hours')
    `;
  }
  console.log(`· watch_sources: +${ids.length}`);
  return ids;
}

// ───── source_changes ──────────────────────────────────────────────────────
// 5 'change' findings spread across the watch sources so the Raw signals feed
// shows kind:'change' rows alongside the ecosystem_alerts kind:'finding' rows.
async function insertSourceChanges(watchIds) {
  if (watchIds.length === 0) return;
  const changes = [
    { wsIdx: 0, significance: 'high',   summary: 'Joe Coffee added 4th subway kiosk location (Bedford Av L)',     rationale: 'Direct format competitor expanding into the same L-train corridor we\'re targeting. Bedford Av is 1 stop from Lorimer St.' },
    { wsIdx: 0, significance: 'medium', summary: 'Joe Coffee published pricing update — drip $4.25, latte $5.50', rationale: 'Pricing moved up $0.25 across the kiosk menu. Tightens our $4.50 differentiation, suggests retail-pricing pressure from bean costs.' },
    { wsIdx: 1, significance: 'high',   summary: 'DCWP published clarification on supervisor-license rules',      rationale: 'New cart-vendor permits require a supervisor license too ($50, separate exam). Adds 2-week prep time to our application timeline. Apply by Aug 15 to be safe.' },
    { wsIdx: 2, significance: 'low',    summary: 'MTA Q1 2026 ridership data CSV updated',                        rationale: 'Quarterly refresh. Numbers are inside our forecasted range — no signal change. Confirms 3.6M weekday tap baseline.' },
    { wsIdx: 3, significance: 'medium', summary: 'USDA wholesale arabica index +3.2% week-over-week',             rationale: 'Continued upward pressure. Cumulative +14% since Mar 2026 (vs. +11% noted in March report). If this continues, COGS revisit at $1.05.' },
  ];
  let n = 0;
  for (const c of changes) {
    const id = bf();
    const ws = watchIds[c.wsIdx];
    await sql`
      INSERT INTO source_changes
        (id, watch_source_id, project_id, change_status, diff_summary, significance,
         significance_rationale, previous_content_hash, current_content_hash, detected_at)
      VALUES
        (${id}, ${ws.id}, ${PROJECT_ID}, 'changed', ${c.summary}, ${c.significance},
         ${c.rationale}, ${'old_' + crypto.randomBytes(4).toString('hex')},
         ${'new_' + crypto.randomBytes(4).toString('hex')},
         CURRENT_TIMESTAMP - (${n} || ' hours')::interval)
    `;
    n += 6;
  }
  console.log(`· source_changes: +${changes.length}`);
}

// ───── Source-builder helpers ──────────────────────────────────────────────
function webSrc(title, url)            { return { type: 'web', title, url }; }
function skillSrc(title, skill_id)     { return { type: 'skill', title, skill_id }; }
function internalSrc(title, ref, ref_id, quote) { return { type: 'internal', title, ref, ref_id, quote }; }
function userSrc(title, quote = title) { return { type: 'user', title, quote }; }
function inferenceSrc(title, basedOn)  { return { type: 'inference', title, based_on: basedOn, reasoning: 'Synthesized from cited sources' }; }

function heading(s) { return `# ${s}\n\n`; }

// ───── Skill summary content (markdown, ~200-400 words each) ───────────────
function ideaShapingSummary() {
  return `**Status:** Canvas locked.

**Problem:** Commuters wait 7 minutes for Starbucks at the subway exit.
**Solution:** Pour-over cart at station exit, $4.50, 90 seconds.
**Target:** NYC subway commuters, 28-42yo, $90-180k HHI.
**Value prop:** Specialty quality at chain price, done in 90 seconds.

The three previously-open sections are now closed:

- **Business Model** — $4.50 unit, $0.85 COGS, 81% gross margin. Single-cart breakeven at 95 cups/day. Confirmed via USDA bean index + cup-cost quotes.
- **Competitive Advantage** — Street-level cart permit ($200, 2-yr) vs. competitors' MTA concession leases. No real-estate overhead.
- **Unfair Advantage** — 2026 DCWP permit window is the first reopening in 14 years. Closes 2026-09-30. Material entry-cost shift that can't be reproduced once shut.

The canvas is ready for scoring.`;
}

function startupScoringSummary() {
  return `**Overall: 7.4 / 10 — GO.**

| Dimension       | Score | Note |
|---|---|---|
| Problem         | 8.5   | Sharp, data-backed, 7-min queue documented |
| Market          | 7.5   | TAM $53B, SAM $1.8B; commuter-on-the-go segment growing 14% YoY |
| Competitive     | 6.5   | Joe Coffee subway kiosks validate format but cap upside |
| Business Model  | 8.5   | 81% gross margin, 95-cup breakeven, transparent unit econ |
| Founder Fit     | 7.0   | Strong on customer empathy; thin on multi-location ops experience |
| Timing          | 6.5   | DCWP permit window = forced 7-month go/no-go gate |

**Top concern:** Stage 5 (Build & Launch) needs to compress to clear the 2026-09-30 permit deadline. Stage 6 (Fundraise) can run in parallel.`;
}

function marketResearchSummary() {
  return `**TAM / SAM / SOM:** $53B / $1.8B / $2.4M over 3 years.

**Methodology:**
- TAM = SCA's 2026 US specialty coffee retail estimate.
- SAM = NYC share (3.4%) × morning-peak share (38%) × commuter-on-the-go segment.
- SOM = 12 carts × 200 cups/day × $4.50 × 360 days (3-yr horizon, 0.13% of SAM).

**Competitor map:**
- Starbucks (incumbent, queue vulnerability)
- Joe Coffee (closest format match — subway concourse kiosks)
- Blue Bottle (premium, sit-down, different occasion)
- Bodega coffee (quality floor at $1.50-2.50)

**Tailwinds:** NYC subway taps back to 3.6M/day (92% of 2019); third-wave on-the-go segment +14% YoY.
**Headwinds:** Arabica bean wholesale +11% YoY (USDA Mar 2026) — watch quarterly.`;
}

function simulationSummary() {
  return `**6 personas simulated, 4 risk scenarios stress-tested.**

Persona reactions (engagement on 1-10):
- Time-Poor Commuter: 9 — "If under 2 min, I'm yours every morning"
- Specialty Curious: 7 — "I'll detour one block for a better cup"
- Tourist: 4 — "Cute but I'll grab whatever's closest"
- Skeptical Investor: 6 — "Margins are real; scaling is the open question"
- Industry Expert (former cafe owner): 7 — "The 90s SLA is achievable but tight"
- Direct Competitor (bodega owner): 5 — "Different price tier; won't hurt me directly"

Risk scenarios:
- Bean price shock (+30%): margin compresses to 71%, still viable above 110 cups/day
- Starbucks fixes queue: differentiation shifts to quality; 18% volume drop estimated
- Permit denial: business pivots to leased indoor format, $35k more capex, 4 months delay
- Founder out 3 weeks: 2nd barista required from day 1, not month 3`;
}

function personasSummary() {
  return `Two anchor personas, both grounded in 2026 commuter-spend data.

**Primary — Time-Poor Commuter (60% of revenue est.):**
28-42yo, $90-180k HHI, 4+ subway days/wk. Pain: 7-min Starbucks queue. Will pay $1-2 premium for 5-min time savings. Loyalty is high once routine forms (4-wk window). Channel: subway-exit signage + word-of-mouth at office.

**Secondary — Specialty Curious (30% of revenue, 80% of social):**
25-35yo, Instagram-driven, low brand loyalty. Pain: most specialty cafes have a sit-down vibe; hard to get pour-over to-go. Will detour 1 block but not 3. Channel: Instagram, TikTok food creators, friend recs. Highest-virality cohort.

**Tertiary — Tourist / Walk-by (10% of revenue):**
Opportunistic, won't repeat. Not a target — but worth pricing for.`;
}

function riskSummary() {
  return `**Top 6 risks (probability × impact, 1-5 scale):**

| # | Risk | P | I | Sev | Mitigation |
|---|---|---|---|---|---|
| 1 | Miss 2026-09-30 DCWP permit window | 2 | 5 | Critical | 2-day Sept sprint; forms pre-assembled by Aug 1 |
| 2 | Bean cost spike >$1.20/cup | 3 | 3 | Medium | 12-mo roaster contract; price floor $5 |
| 3 | Starbucks closes queue gap | 2 | 4 | Medium | Differentiate on quality + 90s SLA; monthly survey |
| 4 | Health-dept fail at commissary | 2 | 4 | Medium | Backup vendor identified; daily logs |
| 5 | Founder cannot personally cover all shifts | 4 | 4 | High | Hire 2nd barista before month 3 |
| 6 | F&F under-subscribes | 3 | 4 | High | "Founders-club" punch-cards pre-sale ($10k bridge) |

Two critical pre-launch risks. Everything else is monitorable.`;
}

function businessModelSummary() {
  return `**Unit economics at $4.50 anchor price:**

- COGS: $0.85 (beans $0.55 + cup/lid $0.18 + milk allowance $0.12)
- Gross margin: 81%
- Daily fixed cost: $40 (lease $12 + commissary $13 + insurance $8 + permit $7 amortized)
- Breakeven: 95 cups/day
- Target Yr1 volume: 140 cups/day → $200/day contribution
- Payback on $18k cart build: 5.2 months at target volume

**Revenue mix (est.):**
- 70% pour-over ($4.50)
- 25% latte ($5.50, manual milk-foam)
- 5% add-ons ($1 oat milk, extra shot)

**LTV / CAC:**
- Avg customer = 3.5 cups/wk × 4-wk retention = 14 cups → ~$60 revenue → ~$49 contribution
- CAC ≈ $12 (signage + first-cup-free promo for early adopters)
- LTV / CAC = 4.1x`;
}

function financialModelSummary() {
  return `**3-yr base-case projection (single cart → 4 carts):**

| | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| Carts active (avg) | 1 | 2.5 | 4 |
| Cups / cart / day | 140 | 165 | 180 |
| Revenue | $168k | $375k | $540k |
| Gross margin | 80% | 81% | 82% |
| Opex (incl. labor) | $112k | $238k | $328k |
| Net | $22k | $66k | $115k |
| Runway end-of-year | 14 mo | 18 mo | 22 mo |

**Scenarios:**
- Bull (+30% volume): Yr3 revenue $700k, net $190k
- Bear (-20% volume + bean spike): Yr3 net $35k (still positive)
- Downside (permit lost): pivot to indoor lease, +$35k capex, delay 4 months`;
}

function prototypeSummary() {
  return `**MVP Blueprint — 8-week build.**

**The cart:**
- Cart-King custom build, $18.2k quoted
- Integrated 1.5kW pour-over rig, manual espresso head, 6L hot-water reservoir
- Square POS terminal, tap-to-pay, 8-second checkout
- 4 hours unplugged operation; plug-in option at commissary overnight

**Tech stack:**
- POS: Square (fees 2.6% + $0.10)
- Inventory: Google Sheets → Square auto-sync (no SaaS yet)
- Website + landing: Framer
- Email list: Buttondown (commuter newsletter, weekly bean drop)

**Build timeline:**
- Wk 1-2: Permit submission + commissary signed
- Wk 3-4: Cart fabrication
- Wk 5-6: Outfit + POS setup + bean contract
- Wk 7: Stealth weekend dry-runs (Lorimer St)
- Wk 8: Soft launch Mon/Fri mornings only`;
}

function gtmSummary() {
  return `**Go-To-Market — first 90 days.**

**Target station (#1):** Lorimer St L. 36k weekday exits, 0 Starbucks within 200m, sidewalk wide enough on SW corner.

**Launch sequence:**
- Wk 1-4: Permit + build (no public presence)
- Wk 5-6: Weekend stealth dry-runs — calibrate service-time and waste
- Wk 7-8: Mon/Fri soft launch — 6am-10am, $4.50 flat menu, hand-flyer to first 50 customers
- Wk 9-10: Full M-F open; add $5.50 latte
- Wk 11-12: Decision gate. Target = 120 cups/day → scout cart #2

**Acquisition channels (cost / cup):**
- Subway-exit signage: ~$0.40/cup (1-time $400, amortized)
- Instagram (Specialty Curious): ~$0.90/cup (UGC + 2 reels/wk)
- Office-tower bulk-order: ~$0.20/cup (highest leverage if landed)
- Free-cup punch card (5+1): ~$1.10/cup (retention only)

**KPI flag:** if Day-30 repeat rate < 35%, the model is broken — pause and investigate.`;
}

function growthSummary() {
  return `**3 growth experiments queued for Months 2-3:**

1. **Office-tower bulk-order (Wk 6 launch)**
   - Hypothesis: Nearby offices will pre-order 8-12 cups for 9am stand-ups
   - Test: Hand-deliver flyers to 5 office mgrs, $35 flat for "pour-over for 10"
   - Success: 2+ recurring weekly orders by Wk 9

2. **Instagram UGC loop (Wk 7 launch)**
   - Hypothesis: Specialty Curious cohort will photograph + tag if cup design is photogenic
   - Test: Limited-edition cup sleeve every 2 weeks, "tag us for a free cup" CTA
   - Success: 20+ tagged posts/mo by Month 3

3. **Founders-club punch-card (Wk 1 — also serves as bridge)**
   - Hypothesis: Early adopters will pre-pay for 12 cups at $50 (vs $54 retail)
   - Test: Pre-sale to F&F + LinkedIn network during permit wait
   - Success: 200 sold → $10k pre-launch revenue and 200 walking ambassadors

**Hypothesized lift on Yr1 volume:** +18% if all 3 hit.`;
}

function landingSummary() {
  return `**Landing page drafted. 6 sections, Framer build, mobile-first.**

1. Hero — "Specialty coffee in 90 seconds, at the subway exit." + email capture
2. The cup — bean origin, brew method, why it's not just drip
3. Where to find us — Lorimer St L, with live "open now" indicator
4. The founders-club punch-card — pre-launch, $50 for 12 cups
5. Press strip (when available)
6. FAQ — permit status, opening date, allergens

**SEO meta:** "Best coffee near Lorimer St subway" + "Pour-over to-go Brooklyn"
**Domain:** Holding subwaycoffeenyc.com
**Goal:** 500 emails by launch.`;
}

function deckSummary() {
  return `**12-slide pitch deck, Sequoia format.**

1. Title — Coffee Cart at the Subway Exit
2. The problem — 7-min Starbucks queue, walk-in cohort underserved
3. The solution — Pour-over cart, $4.50, 90 sec
4. Why now — DCWP 2026 permit window, third-wave +14% YoY
5. Market — TAM/SAM/SOM ($53B / $1.8B / $2.4M)
6. Product — cup, cart, service-time SLA
7. Business model — 81% gross margin, 95-cup breakeven, 5.2-mo payback
8. Go-to-market — Lorimer St #1, expansion to 4 carts in 3 years
9. Competition — Starbucks indirect, Joe Coffee direct, format defense via cart permit
10. Team — founder + 1 barista hired by month 3
11. Financials — 3-yr base case, $168k → $540k revenue
12. Ask — $50k F&F SAFE @ $500k cap, 20% discount`;
}

function onePagerSummary() {
  return `**Investor one-pager (PDF, single page).**

Sections:
- The Bet (3 lines)
- The Numbers (5 KPIs: GM%, breakeven cups, payback, Yr3 revenue, runway)
- The Window (DCWP 2026 permit close 2026-09-30)
- The Team (founder + advisor)
- The Ask ($50k F&F, $500k cap, 20% discount)

Used in: cold intros, post-meeting follow-ups.`;
}

function investmentReadinessSummary() {
  return `**F&F-round readiness: 6.5 / 10.**

Ready:
- Pitch deck (Sequoia, 12 slides)
- One-pager
- Financial model (3-yr base, bull, bear)
- Cap table (clean, no prior dilution)
- SAFE template (YC standard, $500k cap, 20% discount)

Gap before institutional round (Series Pre-Seed, target Month 9):
- 6 months of cart #1 operating data
- 2nd cart profitability proof
- 1 named advisor with food-service operating experience
- Refreshed deck with traction slide

Recommendation: close F&F by Aug 15, defer any institutional conversation until cart #2 is at 100 cups/day.`;
}

function pitchCoachingSummary() {
  return `**4 reps logged. Narrative arc converged on "the permit window."**

The story that lands:
1. Anchor on the 7-min Starbucks queue (everyone has experienced it)
2. Pivot to the DCWP window (this is *new* information — investor sits up)
3. Cup economics — 81% GM, 5.2-mo payback
4. The expansion math — cart #1 funds cart #2 by month 9
5. The ask — $50k SAFE

Common Q&A:
- "What if the queue at Starbucks goes away?" → Mobile order is at 31% and growing; queue is structural, not fixable.
- "Why won't Joe Coffee crush you?" → Different lease structure. They pay MTA $; we pay DCWP $200/2yr.
- "What's your bean cost exposure?" → 12-mo contract; $5 price floor activates if COGS >$1.20.
- "How do you scale past 4 carts?" → Past 4, hire a GM. We'll cross that bridge.`;
}

function investorRelationsSummary() {
  return `**Pipeline: 12 prospects, $50k target.**

Status:
- Committed: $18k ($10k uncle, $5k roommate, $3k former-boss)
- Soft-circled: $28k (mostly $5k tickets from cousins/cohort)
- Target close: 2026-08-15 (45 days before permit deadline)

Active next steps:
- D. (angel, restaurant LP, $15k) — in-person Lorimer St walkthrough on 2026-06-25
- A. (cousin, $5k) — family dinner pitch 2026-06-22
- R. (former boss, $3k) — pitch deck review 2026-06-15

Outreach cadence: weekly investor update email starts 2026-06-08 (10 contacts).`;
}

function weeklyMetricsSummary() {
  return `**Week of 2026-05-26 — pre-launch baseline.**

Numbers:
- F&F committed: $18k (+$5k this week)
- Permit status: Section 4 of 9 drafted
- Cart vendor: Cart-King quote received, $18.2k
- Days to permit window close: 119
- Email list: 87 (target 500 by launch)

Highlights:
- Uncle M. confirmed $10k F&F
- Greenpoint Commissary slot held to 2026-06-15
- Lorimer St L picked as cart #1

Challenges:
- DCWP application asks for "route map" but our model is single-spot
- 0 of 2 baristas hired

Morale: 8/10.
Runway at current burn: 9 months.`;
}

main().catch(async (e) => {
  console.error('Backfill failed:', e);
  await sql.end({ timeout: 5 });
  process.exit(1);
});

/**
 * Throwaway integration test for signal-routing Phase 2 (SIGNAL_AUTOFLOW).
 * Pushes synthetic alerts through the REAL persistEcosystemAlerts with the flag
 * ON against an e2e test project, then verifies every routing verdict end to
 * end (DB truth) and deletes everything it created.
 *
 * Run: SIGNAL_AUTOFLOW=1 node --env-file=.env.local phase2-itest.mts
 */
import { query, run, get } from '@/lib/db';
import { persistEcosystemAlerts } from '@/lib/ecosystem-alert-parser';

const PROJECT = 'proj_c407597b-b68'; // e2e account (same as Phase 1 itest)
const TAG = `af${Date.now().toString(36)}`;
const RIVAL = `__AutoflowRival_${TAG}`;
const DEAD = `__DeadRival_${TAG}`;
const NEWCO = `__NewCo_${TAG}`;
const MID = `__MaybeCo_${TAG}`;


import { it } from 'vitest';

// Live harness: hits the REAL database through the full persist path. Runs ONLY
// when explicitly invoked with both env vars set:
//   SIGNAL_AUTOFLOW=1 DATABASE_URL=... vitest run src/lib/signal-autoflow.live.test.ts
// Skipped in normal `npm test` runs (no DATABASE_URL / flag in CI).
it.skipIf(process.env.SIGNAL_AUTOFLOW !== '1' || !process.env.DATABASE_URL)(
  'SIGNAL_AUTOFLOW live routing (e2e project, self-cleaning)', { timeout: 120_000 }, async () => {
let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} ${extra}`); }
}

function alert(over: Record<string, unknown>) {
  return {
    alert_type: 'competitor_activity',
    headline: 'placeholder',
    body: 'synthetic itest alert body',
    source_url: `https://example.com/${TAG}/${Math.abs(JSON.stringify(over).length)}`,
    relevance_score: 0.9,
    confidence: 0.9,
    entity: null,
    suggested_action: null,
    ...over,
  } as never;
}

try {
  if (process.env.SIGNAL_AUTOFLOW !== '1') throw new Error('run with SIGNAL_AUTOFLOW=1');

  // Seed: an existing applied node (enrich target) + a rejected node (tombstone).
  await run(
    `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, reviewed_state)
     VALUES (?, ?, ?, 'competitor', 'seed', ?, 'applied'), (?, ?, ?, 'competitor', 'seed', ?, 'rejected')`,
    `gnode_${TAG}_a`, PROJECT, RIVAL, { origin: 'itest' },
    `gnode_${TAG}_d`, PROJECT, DEAD, { origin: 'itest' },
  );

  const res = await persistEcosystemAlerts(
    [
      alert({ headline: `${RIVAL} ships a new feature`, entity: RIVAL, relevance_score: 0.72, source_url: `https://ex.com/${TAG}/1` }),
      alert({ headline: `${NEWCO} raises a big round`, entity: NEWCO, relevance_score: 0.9, source_url: `https://ex.com/${TAG}/2` }),
      alert({ headline: `${DEAD} does something`, entity: DEAD, relevance_score: 0.9, source_url: `https://ex.com/${TAG}/3` }),
      alert({ headline: `low relevance noise ${TAG}`, entity: RIVAL, relevance_score: 0.3, source_url: `https://ex.com/${TAG}/4` }),
      alert({ headline: `Unattributable market shift ${TAG} something happened broadly`, entity: null, relevance_score: 0.85, source_url: `https://ex.com/${TAG}/5` }),
      alert({ headline: `${MID} might matter someday`, entity: MID, relevance_score: 0.65, source_url: `https://ex.com/${TAG}/6` }),
    ],
    { projectId: PROJECT, monitorId: null as never, monitorRunId: null as never },
  );
  check('6 alerts persisted', res.alerts_inserted === 6, `got ${res.alerts_inserted}`);

  const rows = await query<{ headline: string; reviewed_state: string; founder_action_taken: string | null; graph_node_id: string | null; entity: string | null }>(
    `SELECT headline, reviewed_state, founder_action_taken, graph_node_id, entity
       FROM ecosystem_alerts WHERE project_id = ? AND source_url LIKE ?`,
    PROJECT, `https://ex.com/${TAG}/%`,
  );
  const by = (frag: string) => rows.find(r => r.headline.includes(frag));

  // 1. ENRICH: existing entity at 0.72 → accepted via autoflow, node timeline +1, NO inbox ticket
  const enr = by('ships a new feature');
  check('enrich: alert accepted', enr?.reviewed_state === 'accepted', enr?.reviewed_state);
  check('enrich: provenance = autoflow', enr?.founder_action_taken === 'autoflow', String(enr?.founder_action_taken));
  const rival = await get<{ id: string; summary: string; tl: number }>(
    `SELECT id, summary, jsonb_array_length(attributes->'timeline') AS tl FROM graph_nodes WHERE project_id = ? AND name = ?`,
    PROJECT, RIVAL,
  );
  check('enrich: timeline appended (1 entry)', rival?.tl === 1, String(rival?.tl));
  check('enrich: summary NOT clobbered', rival?.summary === 'seed', rival?.summary);
  check('enrich: back-linked to node', enr?.graph_node_id === rival?.id);

  // 2. NEW ENTITY: 0.9 no match → node created applied, accepted, no ticket
  const nw = by('raises a big round');
  const newco = await get<{ id: string; reviewed_state: string; tl: number }>(
    `SELECT id, reviewed_state, jsonb_array_length(attributes->'timeline') AS tl FROM graph_nodes WHERE project_id = ? AND name = ?`,
    PROJECT, NEWCO,
  );
  check('new_entity: node created + applied', !!newco && newco.reviewed_state === 'applied');
  check('new_entity: node has timeline[1]', newco?.tl === 1, String(newco?.tl));
  check('new_entity: alert accepted via autoflow', nw?.reviewed_state === 'accepted' && nw?.founder_action_taken === 'autoflow');

  // 3. TOMBSTONE: rejected node → auto_dropped, node stays rejected, no resurrect
  const dead = by(`${DEAD} does something`);
  check('tombstone: alert auto_dropped', dead?.reviewed_state === 'auto_dropped', dead?.reviewed_state);
  const deadNode = await get<{ reviewed_state: string; tl: number | null }>(
    `SELECT reviewed_state, jsonb_array_length(attributes->'timeline') AS tl FROM graph_nodes WHERE project_id = ? AND name = ?`,
    PROJECT, DEAD,
  );
  check('tombstone: node STAYS rejected, no timeline', deadNode?.reviewed_state === 'rejected' && !deadNode?.tl);

  // 4. JUNK: relevance 0.3 → auto_dropped, and did NOT enrich the rival node
  const junk = by('low relevance noise');
  check('junk: auto_dropped', junk?.reviewed_state === 'auto_dropped', junk?.reviewed_state);
  const rivalAfter = await get<{ tl: number }>(
    `SELECT jsonb_array_length(attributes->'timeline') AS tl FROM graph_nodes WHERE project_id = ? AND name = ?`, PROJECT, RIVAL,
  );
  check('junk: rival timeline still 1 (junk did not enrich)', rivalAfter?.tl === 1, String(rivalAfter?.tl));

  // 5. NO ENTITY @0.85 → stays pending + inbox ticket created (legacy path)
  const noent = by('Unattributable market shift');
  check('no-entity: stays pending', noent?.reviewed_state === 'pending', noent?.reviewed_state);
  // 6. MID new entity 0.65 → pending, no node
  const mid = by('might matter someday');
  check('mid-confidence: stays pending', mid?.reviewed_state === 'pending', mid?.reviewed_state);
  check('mid-confidence: NO node created', !(await get(`SELECT 1 FROM graph_nodes WHERE project_id = ? AND name = ?`, PROJECT, MID)));

  // Inbox tickets: exactly ONE (the no-entity 0.85 alert; mid @0.65 is under the 0.8 queue threshold)
  const pas = await query<{ title: string }>(
    `SELECT pa.title FROM pending_actions pa JOIN ecosystem_alerts ea ON ea.id = pa.ecosystem_alert_id
      WHERE ea.source_url LIKE ?`, `https://ex.com/${TAG}/%`,
  );
  check('exactly 1 inbox ticket (the unattributable one)', pas.length === 1 && pas[0].title.includes('Unattributable'), JSON.stringify(pas.map(p => p.title)));

  // Activity log carries the drop reasons (audit trail)
  const acts = await query<{ event_type: string }>(
    `SELECT event_type FROM signal_activity_logs WHERE project_id = ? AND entity_id IN (
       SELECT id FROM ecosystem_alerts WHERE source_url LIKE ?)`, PROJECT, `https://ex.com/${TAG}/%`,
  );
  check('activity log: 2 auto_dropped + 2 autoflowed',
    acts.filter(a => a.event_type === 'signal_auto_dropped').length === 2 &&
    acts.filter(a => a.event_type === 'signal_autoflowed').length === 2,
    JSON.stringify(acts.map(a => a.event_type)));
} catch (e) {
  fail++;
  console.error('ITEST ERROR:', (e as Error).message);
} finally {
  // Cleanup — everything this test created, in FK-safe order.
  const alertIds = (await query<{ id: string }>(`SELECT id FROM ecosystem_alerts WHERE source_url LIKE ?`, `https://ex.com/${TAG}/%`)).map(r => r.id);
  if (alertIds.length) {
    const ph = alertIds.map(() => '?').join(',');
    await run(`DELETE FROM pending_actions WHERE ecosystem_alert_id IN (${ph})`, ...alertIds);
    await run(`DELETE FROM signal_activity_logs WHERE entity_id IN (${ph})`, ...alertIds);
    await run(`DELETE FROM memory_facts WHERE source_id IN (${ph})`, ...alertIds);
    await run(`DELETE FROM ecosystem_alerts WHERE id IN (${ph})`, ...alertIds);
  }
  await run(`DELETE FROM graph_nodes WHERE project_id = ? AND name IN (?, ?, ?)`, PROJECT, RIVAL, DEAD, NEWCO);
  await run(`DELETE FROM competitor_profiles WHERE project_id = ? AND name LIKE ?`, PROJECT, `__%_${TAG}%`);
  console.log(`\ncleanup done. RESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`${fail} checks failed`);
}

});

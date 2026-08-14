/**
 * Gate write-path audit — is every fact-driven gate check MECHANICALLY
 * closeable, end to end, through the real executor?
 *
 * ── Why this exists, and what it is NOT ────────────────────────────────────
 * `scripts/gate-baseline.mjs` answers "does FOLLOWING the product close the
 * gate?" by driving N founders through the real chat API. That measurement is
 * irreducibly LLM-bound — what it measures IS whether the model stages the
 * right evidence on a given turn — and it costs real money and litters prod
 * with gatewalk-* projects (dev == prod). It found 5 ALWAYS / 5 FLAKY / 1
 * NEVER, and FLAKY was model variance.
 *
 * But that conflates two questions:
 *
 *   Layer A — does the write path EXIST? Stage item kind K, run the executor,
 *             does the check flip? Deterministic. No LLM. This file.
 *   Layer B — will the co-pilot PRODUCE kind K when the founder speaks?
 *             Model behaviour. Needs the real chat loop. gate-baseline.mjs.
 *
 * Layer A is the bug class CLAUDE.md warns about ("a check reading a column
 * nothing fills is permanently red") and the one the 2026-08-14 provenance
 * change could plausibly have broken: every gate check now counts a `kind`,
 * and if the executor writes a kind the check does not accept, the check goes
 * silently red for everyone forever. Nothing tested that chain end to end —
 * the existing assertions check prefix↔keyword lockstep against hand-written
 * strings, which is how the EN-emits-Italian bug survived.
 *
 * Zero LLM calls. Creates ONE scratch project and deletes it in `finally`.
 *
 *   PROBE_WRITEPATH=1 DATABASE_URL=... vitest run \
 *     src/lib/journey/gate-writepath.live.test.ts
 */
import { it, expect } from 'vitest';
import { query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { executeAppliedAction } from '@/lib/action-executors';
import { buildProjectSnapshot, evaluateAllStages } from '@/lib/journey';
import { TRACK_1C_UNLOCKED } from './stage-2-market-validation';
import type { PendingAction } from '@/types';

/** Every fact-driven gate check, and the item that must close it. `value` is
 *  deliberately BLAND — no keyword from any family — so the only thing that can
 *  green the check is the executor's own write, not the sample text. */
const CASES: Array<{ check: string; kind: string; field?: string; track1c?: true }> = [
  // 1A — Market
  { check: 'market_size', kind: 'market_size_fact' },
  { check: 'gtm_opportunities', kind: 'gtm_fact' },
  { check: 'partners_identified', kind: 'partner_fact' },
  // 1B — Technical
  { check: 'build_approach', kind: 'tech_fact', field: 'feasibility' },
  { check: 'technical_risk_named', kind: 'tech_fact', field: 'risk' },
  { check: 'key_dependencies', kind: 'tech_fact', field: 'dependencies' },
  { check: 'regulatory_check', kind: 'tech_fact', field: 'regulatory' },
  { check: 'ip_analysis', kind: 'ip_fact' },
  { check: 'data_availability', kind: 'data_fact' },
  // 1C — PSF. Evaluated through TRACK_1C_UNLOCKED: on the live spine these sit
  // behind the 1A+1B lock, and a locked check reports `passed:false` no matter
  // what its evidence says. Asserting the lock here would measure the lock, not
  // the write path — and would read as "3 checks are broken" when they are not.
  { check: 'validation_strategy', kind: 'validation_strategy_fact', track1c: true },
  { check: 'jtbd_mapping', kind: 'jtbd_fact', track1c: true },
  { check: 'differentiation_evidence', kind: 'differentiation_fact', track1c: true },
  // Stage 3 / Stage 4 families that ride the same machinery
  { check: 'icp_defined', kind: 'persona_fact' },
  { check: 'channels_identified', kind: 'channel_fact' },
  { check: 'cogs_opex_defined', kind: 'cogs_opex_fact' },
  { check: 'revenue_streams_defined', kind: 'revenue_stream_fact' },
];

const BLAND = 'Recorded during the founder session on the fourteenth.';

async function checkState(projectId: string, checkId: string, track1c?: boolean) {
  const snap = await buildProjectSnapshot(projectId);
  if (track1c) {
    const c = TRACK_1C_UNLOCKED.find((x) => x.id === checkId);
    if (!c) throw new Error(`no such 1C check: ${checkId}`);
    return c.evaluate(snap);
  }
  for (const ev of evaluateAllStages(snap)) {
    for (const r of ev.results) if (r.check.id === checkId) return r.result;
  }
  throw new Error(`no such check: ${checkId}`);
}

it.skipIf(process.env.PROBE_WRITEPATH !== '1' || !process.env.DATABASE_URL)(
  'every fact-driven gate check is closeable through the real executor',
  { timeout: 300_000 },
  async () => {
    const userId = `wpaudit-${Math.random().toString(36).slice(2, 8)}`;
    const results: Array<{ check: string; before: boolean; after: boolean; stated?: boolean }> = [];
    const projectIds: string[] = [];
    try {
      await run(
        `INSERT INTO users (id, email) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
        userId, `${userId}@writepath.local`,
      );
      // One scratch project PER case. Sharing one project let an earlier case
      // green a later check and the run reported it as "already green" — and it
      // would have HIDDEN a genuinely broken write path behind a neighbour's
      // fact. Isolation is what makes `before === false` mean anything.
      for (const c of CASES) {
        const projectId = generateId('proj');
        projectIds.push(projectId);
        await run(
          `INSERT INTO projects (id, name, description, status, current_step, owner_user_id, locale)
           VALUES (?, ?, ?, 'created', 1, ?, 'en')`,
          projectId, `WRITEPATH AUDIT ${c.check} (auto-deleted)`, 'write-path audit', userId,
        );
        const before = await checkState(projectId, c.check, c.track1c);
        const action = {
          id: generateId('pa'),
          project_id: projectId,
          action_type: 'validation_proposal',
          title: `write-path ${c.check}`,
          payload: { items: [{ kind: c.kind, field: c.field, value: BLAND }] },
          status: 'pending',
        } as unknown as PendingAction;
        await executeAppliedAction(action);
        const after = await checkState(projectId, c.check, c.track1c);
        results.push({
          check: c.check,
          before: before.passed,
          after: after.passed,
          stated: after.stated,
        });
      }
    } finally {
      // Scratch projects never outlive the run — dev == prod.
      for (const projectId of projectIds) {
        await run('DELETE FROM memory_facts WHERE project_id = ?', projectId).catch(() => {});
        await run('DELETE FROM projects WHERE id = ?', projectId).catch(() => {});
      }
      await run('DELETE FROM users WHERE id = ?', userId).catch(() => {});
    }

    const broken = results.filter((r) => !r.after);
    const preGreen = results.filter((r) => r.before);
    const mislabelled = results.filter((r) => r.after && r.stated);
    for (const r of results) {
      console.log(`  ${r.after ? '✅' : '❌'} ${r.check.padEnd(26)} ${r.before ? '(was already green!) ' : ''}${r.stated ? '⚠️ marked STATED despite an approval' : ''}`);
    }
    console.log(`\n${results.length - broken.length}/${results.length} closeable`);

    // A check that was green before its item was applied means something OTHER
    // than the approval greens it — the false-green class this audit exists for.
    expect(preGreen.map((r) => r.check)).toEqual([]);
    // An approved item must never read as "from something you said in chat".
    expect(mislabelled.map((r) => r.check)).toEqual([]);
    expect(broken.map((r) => r.check)).toEqual([]);
  },
);

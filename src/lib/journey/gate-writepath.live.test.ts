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
import crypto from 'node:crypto';
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

/** Every table these audits write, child rows first. dev == prod, so a scratch
 *  project that outlives its run is real litter on the founder's project list. */
const SCRATCH_TABLES = [
  'memory_facts', 'competitor_profiles', 'monitors', 'interviews',
  'canvas_versions', 'score_history', 'research', 'idea_canvas',
  'pending_actions', 'memory_events', 'stage_events',
] as const;

async function purgeProject(projectId: string): Promise<void> {
  for (const t of SCRATCH_TABLES) {
    await run(`DELETE FROM ${t} WHERE project_id = ?`, projectId).catch(() => {});
  }
  await run('DELETE FROM projects WHERE id = ?', projectId).catch(() => {});
}

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
      for (const projectId of projectIds) await purgeProject(projectId);
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


/**
 * ── Layer A, part 2: can the WHOLE gate be closed? ──────────────────────────
 *
 * The audit above proves each fact-driven check flips on its own. It leaves 11
 * of the gate's 23 checks untested, because they close on rows and diffs rather
 * than on approved facts — competitors, watchers, the interview pipeline, the
 * two canvas-revision checks, the re-score, and the founder's own verdict.
 *
 * "Every check is individually closeable" is a weaker claim than "a founder can
 * finish this gate", and only the second one is worth telling anyone. So this
 * seeds ONE project all the way to 23/23, asserting after each step that the
 * intended check flipped — including that 1C stays LOCKED until 1A and 1B are
 * complete, which is the behaviour, not a bug.
 *
 * Still zero LLM calls.
 */
it.skipIf(process.env.PROBE_WRITEPATH !== '1' || !process.env.DATABASE_URL)(
  'the whole gate can be driven to 23/23 with no LLM',
  { timeout: 300_000 },
  async () => {
    const userId = `wpfull-${Math.random().toString(36).slice(2, 8)}`;
    const projectId = generateId('proj');
    const uuid = () => crypto.randomUUID();
    const gate = async () => {
      const snap = await buildProjectSnapshot(projectId);
      return evaluateAllStages(snap).find((e) => e.stage.id === 'market_validation')!;
    };
    const apply = async (items: unknown[]) => executeAppliedAction({
      id: generateId('pa'), project_id: projectId, action_type: 'validation_proposal',
      title: 'seed', payload: { items }, status: 'pending',
    } as unknown as PendingAction);

    try {
      // Sweep any project a PREVIOUS run abandoned. `finally` does not run when
      // the process is killed (a wall-clock timeout, ^C), and this suite writes
      // to the production database — so the next run cleans up after the last
      // one rather than leaving a slow drip of scratch projects behind.
      //
      // AGE-GUARDED, and that guard is load-bearing: without it the sweep
      // deletes a CONCURRENT run's live scratch project mid-test. Several
      // agents share this database, and an unguarded sweep made this very file
      // fail once with a check that had been green a moment earlier — a flaky
      // audit is worse than no audit, because it teaches people to re-run
      // until it's green.
      const stale = await query<{ id: string }>(
        `SELECT id FROM projects
          WHERE name LIKE 'WRITEPATH%'
            AND created_at < NOW() - INTERVAL '1 hour'`,
      ).catch(() => [] as { id: string }[]);
      for (const p of stale) await purgeProject(p.id);
      await run(
        `DELETE FROM users WHERE (id LIKE 'wpaudit-%' OR id LIKE 'wpfull-%')
           AND created_at < NOW() - INTERVAL '1 hour'`,
      ).catch(() => {});

      await run(`INSERT INTO users (id, email) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
        userId, `${userId}@writepath.local`);
      await run(
        `INSERT INTO projects (id, name, description, status, current_step, owner_user_id, locale)
         VALUES (?, ?, ?, 'created', 1, ?, 'en')`,
        projectId, 'WRITEPATH FULL GATE (auto-deleted)', 'full gate audit', userId,
      );

      // Before any evidence: EVERY 1C check must report locked. Asserting this
      // first stops a future "unlock everything" change from sliding past.
      const start = await gate();
      const unlockedEarly = start.results.filter((r) => r.check.track === '1C' && !r.result.locked);
      expect(unlockedEarly.map((r) => r.check.id), '1C must be locked before 1A+1B').toEqual([]);

      // ── 1A + 1B evidence ────────────────────────────────────────────────
      await apply([
        { kind: 'market_size_fact', value: BLAND },
        { kind: 'gtm_fact', value: BLAND },
        { kind: 'partner_fact', value: BLAND },
        { kind: 'tech_fact', field: 'feasibility', value: BLAND },
        { kind: 'tech_fact', field: 'risk', value: BLAND },
        { kind: 'tech_fact', field: 'dependencies', value: BLAND },
        { kind: 'tech_fact', field: 'regulatory', value: BLAND },
        { kind: 'ip_fact', value: BLAND },
        { kind: 'data_fact', value: BLAND },
      ]);
      for (const n of ['Alpha Co', 'Beta Co', 'Gamma Co']) {
        await run(
          `INSERT INTO competitor_profiles (id, project_id, name, slug) VALUES (?, ?, ?, ?)`,
          generateId('comp'), projectId, n, n.toLowerCase().replace(/ /g, '-'),
        );
      }
      await run(
        `INSERT INTO monitors (id, project_id, type, name, status) VALUES (?, ?, 'topic', ?, 'active')`,
        generateId('mon'), projectId, 'Competitor watch',
      );

      const mid = await gate();
      const openAB = mid.results.filter((r) => r.check.track !== '1C' && !r.result.passed);
      expect(openAB.map((r) => r.check.id), '1A+1B should be complete').toEqual([]);

      // 1C now unlocks — EXCEPT `gate_verdict`, which carries a SECOND lock of
      // its own (`lockVerdict`): the founder's GO is gated on all the evidence
      // being in, not merely on 1A+1B. Found by getting this assertion wrong
      // the first time and reading why it failed; it is the invariant "you
      // cannot approve past evidence you never gathered", and it is worth
      // pinning rather than papering over.
      const stillLocked = mid.results.filter((r) => r.check.track === '1C' && r.result.locked);
      expect(stillLocked.map((r) => r.check.id), 'only gate_verdict stays locked').toEqual(['gate_verdict']);

      // ── 1C ──────────────────────────────────────────────────────────────
      await apply([
        { kind: 'validation_strategy_fact', value: BLAND },
        { kind: 'jtbd_fact', value: BLAND },
        { kind: 'differentiation_fact', value: BLAND },
      ]);
      // The pre-interview canvas baseline, then interviews, then the revision:
      // ordering matters — the two revision checks diff against `psf_start`.
      await run(
        `INSERT INTO idea_canvas (project_id, solution, value_proposition) VALUES (?, ?, ?)`,
        projectId, 'Original solution text.', 'Original value proposition text.',
      );
      await run(
        `INSERT INTO canvas_versions (id, project_id, version_number, canvas, reason)
         VALUES (?, ?, 1, ?, 'psf_start')`,
        generateId('cv'), projectId,
        { solution: 'Original solution text.', value_proposition: 'Original value proposition text.' },
      );
      for (let i = 0; i < 5; i++) {
        await run(
          `INSERT INTO interviews (id, project_id, user_id, person_name, top_pain, wtp_amount, status, summary)
           VALUES (?, ?, ?, ?, ?, ?, 'done', ?)`,
          uuid(), projectId, userId, `Interviewee ${i + 1}`,
          'Losing hours every week to manual reconciliation.', 49, 'Conducted.',
        );
      }
      await run(
        `UPDATE idea_canvas SET solution = ?, value_proposition = ? WHERE project_id = ?`,
        'Rewritten after the interviews: a reconciliation agent, not a dashboard.',
        'Sharpened after the interviews: hours back every week, not more reporting.',
        projectId,
      );
      await run(
        `INSERT INTO score_history (id, project_id, overall_score, source) VALUES (?, ?, 71, 'startup-scoring')`,
        generateId('sh'), projectId,
      );
      await run(
        `INSERT INTO research (project_id, gate_verdict) VALUES (?, ?)
         ON CONFLICT (project_id) DO UPDATE SET gate_verdict = EXCLUDED.gate_verdict`,
        projectId, { verdict: 'GO', decided_at: '2026-08-14T00:00:00Z', motivation: 'Evidence is in.' },
      );

      const final = await gate();
      const open = final.results.filter((r) => !r.result.passed);
      for (const r of final.results) {
        console.log(`  ${r.result.passed ? '✅' : '❌'} ${r.check.track} ${r.check.id}`);
      }
      console.log(`\nGATE: ${final.passed}/${final.total}`);
      expect(open.map((r) => r.check.id), 'the whole gate must be closeable').toEqual([]);
    } finally {
      await purgeProject(projectId);
      await run('DELETE FROM users WHERE id = ?', userId).catch(() => {});
    }
  },
);

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { interviewStatus, hasBeenContacted, isConducted, INTERVIEW_STATUSES } from './interview-status';
import { TRACK_1C_UNLOCKED, COLD_USER_TARGET } from './journey/stage-2-market-validation';
import type { ProjectSnapshot } from './journey/types';

/**
 * #398 — "cold users listed" and "cold users outreach" are two STATES of one
 * record, not two tables. They were unbuildable rather than unwritten:
 * `interviews.summary` was NOT NULL, so a prospect nobody has spoken to had no
 * row to be counted in, and a check reading a column nothing can fill is
 * permanently red (the bug class #251 warned about). Migration 040 adds
 * `status`; both steps become row counts.
 *
 * The risk this creates is the opposite one: prospects living in the same
 * table as interviews could inflate everything that counts interviews — the
 * gate's "5+ logged", the WTP rate, and Loop-1's trigger. That is what the
 * snapshot split defends, and what the first block below pins.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

const snap = (over: Partial<ProjectSnapshot> = {}): ProjectSnapshot => ({
  idea_canvas: null, competitors: [], research: null, monitors: [], watch_sources: [],
  pricing_state: null, burn_rate: null, workflow: null, growth_loops: [], metrics: [],
  memory_facts: [], interviews: [], fundraising_round: null, investors: [],
  counts: { published_assets: 0, pending_actions: 0, knowledge_items: 0 },
  psf_baseline_canvas: null, score_revisions_after_evidence: 0,
  ...over,
} as ProjectSnapshot);

const check = (id: string) => TRACK_1C_UNLOCKED.find((c) => c.id === id)!;
const pipeline = (n: number, status: string) =>
  Array.from({ length: n }, (_, i) => ({ id: `iv${i}`, status }));

describe('interviewStatus — NULL means "done", and that default is load-bearing', () => {
  it('reads an unknown/missing status as done', () => {
    // Every writer predating migration 040 records a conversation that
    // HAPPENED. Defaulting the other way would silently demote all 84 rows in
    // prod out of `interviews_logged`.
    expect(interviewStatus(null)).toBe('done');
    expect(interviewStatus(undefined)).toBe('done');
    expect(interviewStatus('')).toBe('done');
    expect(interviewStatus('nonsense')).toBe('done');
  });

  it('accepts the four real states, case- and space-insensitively', () => {
    for (const s of INTERVIEW_STATUSES) {
      expect(interviewStatus(s)).toBe(s);
      expect(interviewStatus(` ${s.toUpperCase()} `)).toBe(s);
    }
  });

  it('a conducted interview implies outreach — you cannot interview someone you never reached', () => {
    expect(hasBeenContacted('listed')).toBe(false);
    for (const s of ['contacted', 'scheduled', 'done']) expect(hasBeenContacted(s)).toBe(true);
    expect(isConducted('done')).toBe(true);
    for (const s of ['listed', 'contacted', 'scheduled']) expect(isConducted(s)).toBe(false);
  });
});

describe('the two pipeline checks count the pipeline', () => {
  it('cold_users_listed counts every prospect, whatever state', () => {
    expect(check('cold_users_listed').evaluate(snap({ interview_pipeline: pipeline(COLD_USER_TARGET - 1, 'listed') })).passed).toBe(false);
    expect(check('cold_users_listed').evaluate(snap({ interview_pipeline: pipeline(COLD_USER_TARGET, 'listed') })).passed).toBe(true);
  });

  it('cold_users_outreach ignores the merely listed', () => {
    const listedOnly = snap({ interview_pipeline: pipeline(10, 'listed') });
    expect(check('cold_users_listed').evaluate(listedOnly).passed).toBe(true);
    expect(check('cold_users_outreach').evaluate(listedOnly).passed).toBe(false);

    const contacted = snap({ interview_pipeline: pipeline(COLD_USER_TARGET, 'contacted') });
    expect(check('cold_users_outreach').evaluate(contacted).passed).toBe(true);
  });

  it('both count a conducted interview — the funnel is cumulative', () => {
    const done = snap({ interview_pipeline: pipeline(COLD_USER_TARGET, 'done') });
    expect(check('cold_users_listed').evaluate(done).passed).toBe(true);
    expect(check('cold_users_outreach').evaluate(done).passed).toBe(true);
  });

  it('the gap tells the founder the count and the action, never a bare "not yet"', () => {
    const r = check('cold_users_listed').evaluate(snap({ interview_pipeline: pipeline(2, 'listed') }));
    expect(r.gap).toContain('2');
    expect(r.gap).toContain(String(COLD_USER_TARGET));
  });

  it('an old snapshot with no pipeline field degrades to 0, not a crash', () => {
    expect(check('cold_users_listed').evaluate(snap()).passed).toBe(false);
    expect(check('cold_users_outreach').evaluate(snap()).passed).toBe(false);
  });
});

describe('REGRESSION: prospects must not be mistaken for interviews', () => {
  it('the snapshot filters `interviews` to conducted rows only', () => {
    // This is the whole defence. Eight consumers read snapshot.interviews as
    // CONDUCTED interviews — Loop-1 triggers on its length and computes the WTP
    // rate over it, the gate-verdict card summarises it, skill/MVP context
    // quotes it. Filtering at the source keeps every one of them correct
    // without touching them: listing 5 cold users must not fire a PSF review
    // or green "5+ interviews logged".
    const src = read('src/lib/journey/snapshot.ts');
    expect(src).toMatch(/\.filter\(\(iv\) => isConducted\(iv\.status\)\)/);
    expect(src).toContain('interview_pipeline');
  });

  it('interviews_logged reads `interviews`, which prospects never enter', () => {
    const listedOnly = snap({ interviews: [], interview_pipeline: pipeline(10, 'listed') });
    expect(check('interviews_logged').evaluate(listedOnly).passed).toBe(false);
  });
});

describe('the write path exists, and does not freeze the PSF baseline', () => {
  const tools = read('src/lib/project-tools.ts');

  it('list_prospects is registered as a tool', () => {
    expect(tools).toContain("name: 'list_prospects'");
    expect(tools).toContain('listProspectsTool(ctx),');
  });

  it('it refuses to record an interview as having happened', () => {
    // 'done' asserts a conversation took place, which this tool cannot attest
    // to — that is log_interview, which requires what was said.
    expect(tools).toContain("use_log_interview");
  });

  it('a missing status defaults to listed, NOT to the interviewStatus default', () => {
    // interviewStatus(undefined) is 'done' by design; reading the tool
    // parameter through it directly would have written conducted interviews
    // for every prospect the model listed without a status.
    expect(tools).toMatch(/typeof p\.status === 'string' \? p\.status : 'listed'/);
  });

  it('status is forward-only — re-listing never demotes someone already interviewed', () => {
    expect(tools).toMatch(/rank\(status\) > rank\(existing\.status \?\? ''\)/);
  });

  it('listing prospects does NOT call ensureCanvasBaseline', () => {
    // #398's own warning: the PSF baseline freezes "the canvas before the
    // conversations". Listing people you intend to call must not close the
    // window on a canvas the founder is still shaping.
    const tool = tools.slice(tools.indexOf("name: 'list_prospects'"));
    const body = tool.slice(0, tool.indexOf('// ─────'));
    expect(body).not.toContain('ensureCanvasBaseline(');
  });
});

describe('migration 040', () => {
  const sql = read('db/migrations/040_interview_status.sql');

  it('makes summary nullable — the reason the steps were unbuildable', () => {
    expect(sql).toMatch(/ALTER COLUMN summary DROP NOT NULL/i);
  });

  it('backfills existing rows to done BEFORE any prospect can exist', () => {
    expect(sql).toMatch(/UPDATE interviews SET status = 'done' WHERE status IS NULL/i);
    expect(sql.indexOf('ADD COLUMN')).toBeLessThan(sql.indexOf('UPDATE interviews'));
  });

  it('is re-runnable', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/i);
  });
});

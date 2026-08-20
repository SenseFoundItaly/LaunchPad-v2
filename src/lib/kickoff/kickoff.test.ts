import { describe, it, expect } from 'vitest';
import { kickoffProgress, coerceNorthStar, PILLARS, ASKED_PILLARS, isFilled } from './pillars';
import { kickoffPrompt, KICKOFF_STEP } from './prompt';

/**
 * Three questions produce five pillars because two are INFERRED, not asked.
 * Progress is derived from the pillars rather than stored, so the bar cannot
 * disagree with the document beside it.
 *
 * Prompt guidance has no type checker, so the second block IS the guard —
 * the same discipline as journey/stage-prompt.phase0.test.ts.
 */
describe('the five pillars', () => {
  it('three are asked, two inferred', () => {
    expect(PILLARS).toHaveLength(5);
    expect(ASKED_PILLARS).toEqual(['01', '02', '05']);
    expect(PILLARS.filter((p) => p.source === 'inferred').map((p) => p.id)).toEqual(['03', '04']);
  });

  it('every pillar targets an EXISTING idea_canvas column — no canvas migration', () => {
    // Verified against prod: these are all real columns today.
    const columns = new Set(['problem', 'solution', 'target_market', 'business_model', 'competitive_advantage',
      'unfair_advantage', 'value_proposition', 'key_metrics', 'revenue_streams', 'cost_structure', 'channels']);
    for (const p of PILLARS) expect(columns.has(p.promotesTo), `${p.id} → ${p.promotesTo}`).toBe(true);
  });

  it('each asked pillar maps to exactly one question, 1-3', () => {
    const qs = PILLARS.filter((p) => p.source === 'asked').map((p) => p.question).sort();
    expect(qs).toEqual([1, 2, 3]);
  });
});

describe('progress is derived, never stored', () => {
  it('counts only the ASKED pillars — inferred ones cannot fake completion', () => {
    // The agent writes 03/04 from inference; if those counted, a founder could
    // be "done" without answering anything.
    expect(kickoffProgress({ '03': 'a first move', '04': 'growth' }, 3)).toMatchObject({ answered: 0, complete: false });
  });

  it('walks 0 → 3 and reports the next question', () => {
    expect(kickoffProgress({}, 0)).toMatchObject({ answered: 0, currentQuestion: 1, complete: false });
    expect(kickoffProgress({ '01': 'choir directors' }, 1)).toMatchObject({ answered: 1, currentQuestion: 2 });
    expect(kickoffProgress({ '01': 'choir directors', '02': 'it sucks that…' }, 2)).toMatchObject({ answered: 2, currentQuestion: 3 });
    expect(kickoffProgress({ '01': 'choir directors', '02': 'it sucks that…', '05': 'nobody else knows choirs' }, 3))
      .toMatchObject({ answered: 3, currentQuestion: null, complete: true });
  });

  it('jumps correctly when one answer fills two pillars', () => {
    // Self-healing: no reconciliation code, because nothing is stored.
    expect(kickoffProgress({ '01': 'choir directors', '02': 'it sucks that…' }, 2).answered).toBe(2);
  });

  it('REGRESSION: the bar never runs ahead of the conversation', () => {
    // First live run: on a project that already had a canvas, the agent filled
    // 01 and 02 from existing context before the founder had said a word, and
    // the bar jumped to "question 3" while Otto was asking question 1.
    // Pillars measure the document; founder turns measure the interview.
    const rich = { '01': 'choir directors', '02': 'it sucks that…' };
    expect(kickoffProgress(rich, 0).currentQuestion).toBe(1);
    expect(kickoffProgress(rich, 0).answered).toBe(2);      // document IS ahead — that's fine
    expect(kickoffProgress(rich, 0).complete).toBe(false);  // but the interview is not done
  });

  it('complete needs BOTH the pillars and three founder answers', () => {
    const full = { '01': 'choir directors', '02': 'it sucks…', '05': 'we know choirs' };
    expect(kickoffProgress(full, 2).complete).toBe(false);  // document ready, interview short
    expect(kickoffProgress({ '01': 'choir directors' }, 5).complete).toBe(false); // talked, no document
    expect(kickoffProgress(full, 3).complete).toBe(true);
  });

  it('a one-character pillar does not count — 3 chars is the floor', () => {
    // Caught by these tests when they were first written with 'x' and 'y' as
    // fixtures: a stray character must not advance the interview.
    expect(kickoffProgress({ '01': 'x', '02': 'y', '05': 'z' }, 3).answered).toBe(0);
  });

  it('whitespace is not an answer', () => {
    expect(isFilled('  ')).toBe(false);
    expect(kickoffProgress({ '01': '  ', '02': 'real answer', '05': 'real answer' }, 3).complete).toBe(false);
  });

  it('null / garbage input degrades to zero rather than throwing', () => {
    expect(kickoffProgress(null, 0)).toMatchObject({ answered: 0, complete: false });
    expect(coerceNorthStar('nonsense')).toEqual({});
    expect(coerceNorthStar({ '01': 'keep', zz: 'drop', '02': 42 })).toEqual({ '01': 'keep' });
  });
});

describe('the kickoff prompt', () => {
  it('is INERT on every other step — it must not leak into the main co-pilot', () => {
    expect(kickoffPrompt('chat', {}, 1)).toBe('');
    expect(kickoffPrompt('idea_shaping', {}, 1)).toBe('');
    expect(kickoffPrompt('node:abc', {}, 1)).toBe('');
  });

  it.each([1, 2, 3])('question %i carries its own brief and the shared rules', (n) => {
    const p = kickoffPrompt(KICKOFF_STEP, {}, n);
    expect(p).toContain(`question ${n} of 3`);
    expect(p).toMatch(/ONE question per message/i);
    expect(p).toMatch(/reflecting what they just said/i);
  });

  it('forbids flattery and demands a position — the thing that makes it feel human', () => {
    const p = kickoffPrompt(KICKOFF_STEP, {}, 1);
    expect(p).toMatch(/Never open with praise/i);
    expect(p).toMatch(/Take a position/i);
  });

  it('escalates: history → what others get wrong → the visceral moment', () => {
    expect(kickoffPrompt(KICKOFF_STEP, {}, 1)).toMatch(/history/i);
    expect(kickoffPrompt(KICKOFF_STEP, {}, 2)).toMatch(/FUNDAMENTALLY wrong/i);
    expect(kickoffPrompt(KICKOFF_STEP, {}, 3)).toMatch(/It sucks that/i);
  });

  it('tells the agent to write pillars DURING the turn, not at the end', () => {
    const p = kickoffPrompt(KICKOFF_STEP, {}, 1);
    expect(p).toContain('write_north_star');
    expect(p).toMatch(/do not batch them to the end/i);
  });

  it('marks 03 and 04 as inferred, and forbids inventing a pillar', () => {
    const p = kickoffPrompt(KICKOFF_STEP, {}, 2);
    expect(p).toMatch(/INFER it; do not ask/);
    expect(p).toMatch(/Never claim a pillar the founder has not given you grounds for/i);
  });

  it('shows pillars already written, so the agent does not re-ask', () => {
    const p = kickoffPrompt(KICKOFF_STEP, { '01': 'choir directors' }, 2);
    expect(p).toContain('Already written');
    expect(p).toContain('choir directors');
  });

  it('on completion it stops interviewing and proposes ONE next step', () => {
    const p = kickoffPrompt(KICKOFF_STEP, { '01': 'a', '02': 'b', '05': 'c' }, null);
    expect(p).toMatch(/Do NOT ask another interview question/i);
    expect(p).toMatch(/Propose ONE concrete next piece of work/i);
    expect(p).toMatch(/take later, or decline/i);
  });
});

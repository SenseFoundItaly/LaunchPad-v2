import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseScoreSummary } from './score-summary';
import { translate } from './i18n/messages';

/**
 * The Clarity / Startup scoring split (founder decision, changelog 4/08).
 *
 * The full Startup Scoring judges market, competition, feasibility and demand —
 * at Stage 1 those are not weak, they are UNKNOWABLE, so every founder got a
 * low number that read as a verdict on their idea (measured: LocalPulse 54,
 * DeskMate 68, both dragged down by dimensions with no evidence behind them).
 * Pre-gate the founder now gets the Clarity Score (canvas-only); the full
 * rubric runs once tracks 1A+1B are done and evidence exists.
 *
 * These tests pin the CHAIN, not one file — the lesson of the write-path bugs:
 * the skill exists in both locales, the executor's JSON contract covers it, the
 * score route can reach it, the parser reads its verdict, and the founder-facing
 * copy says Clarity in both languages. Any link missing = a red check nothing
 * can green, or a run whose output silently fails to persist.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

describe('the clarity-scoring skill', () => {
  it('exists in BOTH locales with the six variables and the canvas-only rule', () => {
    for (const f of ['launchpad-skills/clarity-scoring/SKILL.md', 'launchpad-skills/clarity-scoring/SKILL.it.md']) {
      const body = read(f);
      expect(body).toContain('name: clarity-scoring');
      // The six snake_case keys are the parser contract — dimensions are read
      // generically, so the SKILL body is the only place they are defined.
      for (const v of ['problem_specificity', 'solution_problem_coherence', 'icp_specificity',
        'value_prop_articulation', 'differentiation_logic', 'revenue_cost_coherence']) {
        expect(body, `${f} must define ${v}`).toContain(v);
      }
      // Canvas-only is the design, not an optimization: web research here would
      // recreate exactly the "score the unknowable" problem the split removed.
      expect(body).toMatch(/NON usare la ricerca web|Do NOT use web search/);
      expect(body).toContain('PIVOT PARZIALE');
    }
  });

  it('is wired into the executor: JSON contract + direct-run whitelist', () => {
    const executor = read('src/lib/skill-executor.ts');
    // Contract: without it the run has no compact-json-first instruction and a
    // 170s truncation silently loses the score (the LocalPulse blocker class).
    expect(executor).toMatch(/'clarity-scoring':\s*\n?\s*'Your response MUST OPEN/);
    // Whitelist: the score route calls runSkill without allowAnySkill, so a
    // missing entry throws "not in the safe auto-rerun whitelist" at runtime.
    expect(executor).toMatch(/SAFE_AUTO_RERUN_SKILL_IDS[\s\S]{0,200}'clarity-scoring'/);
    // Persistence: both scoring skills must persist, each under its own source.
    expect(executor).toContain("skillId === 'startup-scoring' || skillId === 'clarity-scoring'");
    expect(executor).toContain('source: skillId');
  });

  it('the score route picks the skill by GATE STATE, not by founder choice', () => {
    const route = read('src/app/api/projects/[projectId]/score/route.ts');
    expect(route).toContain('validationTracksAB_done');
    expect(route).toMatch(/'startup-scoring'\s*:\s*'clarity-scoring'/);
    // The debounce must ignore BOTH scoring skills' own completions or the
    // score re-fires forever after its own run.
    expect(route).toContain("NOT IN ('startup-scoring', 'clarity-scoring')");
  });
});

describe('the verdict ride-along (parser contract)', () => {
  const block = (rec: string | null, overall = 76) => '```json\n' + JSON.stringify({
    startup_score: {
      overall_score: overall, overall_grade: 'B+',
      ...(rec === null ? {} : { recommendation: rec }),
      summary: 'Idea chiara, ICP da stringere.',
      dimensions: { problem_specificity: { score: 80, rationale: 'x' } },
    },
  }) + '\n```';

  it('prefixes a known verdict onto the recommendation', () => {
    const p = parseScoreSummary(block('GO'));
    expect(p?.recommendation).toBe('GO — Idea chiara, ICP da stringere.');
    expect(parseScoreSummary(block('PIVOT PARZIALE'))?.recommendation).toMatch(/^PIVOT PARZIALE — /);
  });

  it('ignores an arbitrary string where the verdict should be', () => {
    // Anything here becomes a founder-facing badge — only the three known
    // verdicts may pass. An unknown value degrades to plain summary.
    const p = parseScoreSummary(block('MAYBE LATER'));
    expect(p?.recommendation).toBe('Idea chiara, ICP da stringere.');
  });

  it('startup-scoring output (no recommendation field) is untouched', () => {
    const p = parseScoreSummary(block(null));
    expect(p?.recommendation).toBe('Idea chiara, ICP da stringere.');
  });

  it('reads the clarity dimension names generically', () => {
    const p = parseScoreSummary(block('GO'));
    expect(p?.dimensions).toHaveProperty('Problem specificity', 80);
  });
});

describe('founder-facing copy says Clarity, both locales', () => {
  it('check label, gap and prompt', () => {
    for (const locale of ['en', 'it'] as const) {
      expect(translate(locale, 'journey-check.startup_scoring_baseline')).toContain('Clarity');
      expect(translate(locale, 'journey-gap.startup_scoring_baseline')).toContain('Clarity');
      expect(translate(locale, 'journey-prompt.scoring')).toContain('Clarity');
      // The 1C review prompt must KEEP pointing at the full Startup Scoring —
      // that one runs on evidence, which is the whole point of the split.
      expect(translate(locale, 'journey-prompt.scoring-review')).toMatch(/Startup Scoring/i);
    }
  });

  it('the check label still routes to the scoring prompt (keyword contract)', () => {
    // checkActionPrompt routes on the ENGLISH label via /scoring|baseline/ —
    // the renamed label must keep a routing keyword or the substep click falls
    // to the generic fallback (the #399 English-leak class).
    const stage1 = read('src/lib/journey/stage-1-idea-validation.ts');
    expect(stage1).toContain("label: 'Clarity Score baseline (0-100)'");
  });
});

describe('the scoring-skill decision has ONE home (48h audit, cluster A)', () => {
  it('no phase-0 surface still hardcodes the full rubric', () => {
    // Each of these was a stale copy the audit confirmed: a founder-facing
    // surface labeled Clarity that ran startup-scoring pre-gate.
    expect(read('src/app/api/projects/[projectId]/brief/route.ts')).toContain("skill_id: 'clarity-scoring'");
    expect(read('src/lib/direction/index.ts')).toMatch(/phase0Scoring[\s\S]{0,400}'clarity-scoring'/);
    // Stage-1 pipeline scorer is clarity; the full rubric lives at Stage 2.
    const stages = read('src/lib/stages.ts');
    expect(stages).toMatch(/canonicalStageLabel\(1\)[\s\S]{0,900}clarity-scoring/);
  });

  it('kind + scoring_review read only the two scoring skills', () => {
    expect(read('src/app/api/projects/[projectId]/score/route.ts'))
      .toContain("source IN ('clarity-scoring', 'startup-scoring')");
    expect(read('src/lib/journey/snapshot.ts')).toMatch(/score_history[\s\S]{0,200}source = 'startup-scoring'/);
  });
});

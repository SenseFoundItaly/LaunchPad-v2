/**
 * Stage 2 — Market Validation.
 * Evidence that the problem is real, painful, and frequent enough that
 * someone would pay to solve it — and that you can name why you win.
 * Canvas alone doesn't cut it: you need competitors mapped (proves a market
 * exists), customer evidence (proves the pain), and differentiation backed
 * by evidence, not vibes.
 *
 * Re-bucketing note (2026-06 taxonomy unification): absorbs all of legacy
 * "Problem" plus legacy "Solution"'s differentiation_evidence (it reads
 * market facts, so it belongs with market validation). Check ids and
 * evaluator logic are unchanged, with ONE functional fix: `monitors_set`
 * now counts active watch_sources (URL watchers) alongside monitors —
 * both are founder-facing "watchers" and either closes the gate.
 */

import type { Stage } from './types';
import { CANONICAL_BY_ID } from './canonical';
import { countMemoryFactsMatching } from './snapshot';

export const stageMarketValidation: Stage = {
  ...CANONICAL_BY_ID.market_validation,
  tagline: 'Validate the pain is real, frequent, and worth paying to solve.',
  checks: [
    {
      id: 'problem_defined',
      label: 'Problem clearly defined',
      source: 'idea_canvas.problem',
      evaluate: (s) => {
        const p = s.idea_canvas?.problem?.trim() ?? '';
        const ok = p.length >= 40;
        return ok
          ? { passed: true, evidence: `Problem statement: ${p.length} chars` }
          : { passed: false, gap: 'Sharpen the problem to at least 40 chars' };
      },
    },
    {
      id: 'segment_named',
      label: 'Target segment named',
      source: 'idea_canvas.target_market',
      evaluate: (s) => {
        const ok = !!s.idea_canvas?.target_market?.trim();
        return ok
          ? { passed: true, evidence: 'Target market specified' }
          : { passed: false, gap: 'Name a specific customer segment' };
      },
    },
    {
      id: 'competitors_mapped',
      label: '3+ competitors mapped',
      source: 'competitor_profiles',
      evaluate: (s) => {
        const n = s.competitors.length;
        const ok = n >= 3;
        return ok
          ? { passed: true, evidence: `${n} competitors tracked` }
          : { passed: false, gap: `${n} of 3 — ask Co-pilot to research more` };
      },
    },
    {
      id: 'market_size',
      label: 'Market size estimated',
      source: 'memory_facts (market sizing)',
      evaluate: (s) => {
        const n = countMemoryFactsMatching(s, ['market size', 'TAM', 'SAM', 'SOM', 'addressable']);
        const ok = n > 0;
        return ok
          ? { passed: true, evidence: `${n} fact${n === 1 ? '' : 's'} mentioning market sizing` }
          : { passed: false, gap: 'Estimate TAM/SAM with Co-pilot' };
      },
    },
    {
      id: 'interviews_logged',
      label: '5+ customer interviews logged',
      source: 'interviews',
      evaluate: (s) => {
        // Deterministic row count from the structured interviews table.
        // Founder logs via chat (log_interview tool) or POST /api/.../interviews.
        const n = s.interviews.length;
        const ok = n >= 5;
        return ok
          ? { passed: true, evidence: `${n} interviews logged` }
          : { passed: false, gap: `${n} of 5 — tell the Co-pilot "I talked to X about Y" to log` };
      },
    },
    {
      id: 'pain_validated',
      label: 'Top pain point captured',
      source: 'interviews.top_pain + memory_facts',
      evaluate: (s) => {
        // Prefer structured: an interview row with a non-empty top_pain is
        // higher-signal than a memory_fact keyword match. Fall back to
        // memory_facts so the check still passes for historical projects
        // that captured pain before the interviews table existed.
        const withPain = s.interviews.filter((i) => i.top_pain && i.top_pain.trim().length > 5).length;
        if (withPain > 0) {
          return { passed: true, evidence: `${withPain} interview${withPain === 1 ? '' : 's'} with verbatim pain quote` };
        }
        const n = countMemoryFactsMatching(s, ['biggest pain', 'frustration', 'top problem', 'urgent']);
        const ok = n > 0;
        return ok
          ? { passed: true, evidence: `${n} pain-point fact${n === 1 ? '' : 's'}` }
          : { passed: false, gap: 'Pin the single biggest pain in chat' };
      },
    },
    {
      id: 'monitors_set',
      label: 'Watchers active',
      source: 'monitors + watch_sources',
      evaluate: (s) => {
        // ANY active signal-watching counts: topic monitors AND URL watchers
        // (watch_sources). Both are "watchers" to the founder — a project
        // with only URL watchers was wrongly failing this gate before.
        const activeMonitors = s.monitors.filter((m) => m.status === 'active').length;
        const activeWatchSources = s.watch_sources.filter((w) => w.status === 'active').length;
        const active = activeMonitors + activeWatchSources;
        const ok = active >= 1;
        return ok
          ? { passed: true, evidence: `${active} live watcher${active === 1 ? '' : 's'}` }
          : { passed: false, gap: 'Set at least one watcher on competitors or trends' };
      },
    },
    {
      id: 'differentiation_evidence',
      label: 'Differentiation evidenced',
      source: 'memory_facts (vs. competitors)',
      evaluate: (s) => {
        const n = countMemoryFactsMatching(s, ['unlike', 'better than', 'differentiator', 'vs', 'compared to']);
        const ok = n > 0;
        return ok
          ? { passed: true, evidence: `${n} differentiation fact${n === 1 ? '' : 's'}` }
          : { passed: false, gap: 'Pin what makes you different in chat' };
      },
    },
  ],
};

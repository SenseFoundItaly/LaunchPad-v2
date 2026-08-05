import { describe, it, expect } from 'vitest';
import {
  TECH_1B_SOURCES, BUILD_APPROACH_KEYWORDS, DEPENDENCY_KEYWORDS,
  REGULATORY_KEYWORDS, TECH_RISK_KEYWORDS,
} from './stage-2-market-validation';
import { keywordMatcher } from './index';

/**
 * The last link of the write path: keyword family → item kind → source mapping
 * → **executor Apply prefix**. The prefix is the link that rots silently — the
 * check keyword-matches memory_facts, so a prefix that drifts out of its
 * family turns the check red for every founder while every test still passes.
 *
 * These pin the four tech_fact prefixes to the four keyword lists they must
 * satisfy, in BOTH locales. `technical_risk_named` is the reason they exist: it
 * shared a source with `build_approach` and greened on whichever wording the
 * model happened to use, until `risk` was split out (2026-08-05).
 */

// Mirrors the executor's tech_fact branch in action-executors.ts.
const PREFIXES: Record<string, { en: string; it: string; keywords: readonly string[] }> = {
  feasibility: { en: 'Feasibility — ', it: 'Fattibilità tecnica — ', keywords: BUILD_APPROACH_KEYWORDS },
  dependencies: { en: 'Key dependency — ', it: 'Dipendenza chiave — ', keywords: DEPENDENCY_KEYWORDS },
  regulatory: { en: 'Regulatory — ', it: 'Normativa — ', keywords: REGULATORY_KEYWORDS },
  risk: { en: 'Technical risk — ', it: 'Rischio tecnico — ', keywords: TECH_RISK_KEYWORDS },
};

describe('tech_fact Apply prefixes', () => {
  it('every prefix matches its own check in BOTH locales', () => {
    for (const [field, { en, it: itPrefix, keywords }] of Object.entries(PREFIXES)) {
      const re = keywordMatcher([...keywords]);
      // The prefix alone must green the check — a founder's own wording is a
      // bonus, never the thing the write path depends on.
      expect(re.test(`${en}the exercise-verification model runs on-device`), `EN ${field}`).toBe(true);
      expect(re.test(`${itPrefix}il modello gira on-device`), `IT ${field}`).toBe(true);
    }
  });

  it('has one source per field, and risk is NOT feasibility', () => {
    // The bug this split fixed: two checks reading one source with different
    // keyword families, so the staging hint could not target either alone.
    const sources = Object.values(TECH_1B_SOURCES);
    expect(new Set(sources).size, 'each 1B check needs its own source').toBe(sources.length);
    expect(TECH_1B_SOURCES.risk).not.toBe(TECH_1B_SOURCES.feasibility);
  });

  it('a risk finding does NOT accidentally green feasibility', () => {
    // The accident observed in the walkthrough, inverted: prefixes must be
    // discriminating, not merely present.
    const feasibilityRe = keywordMatcher([...BUILD_APPROACH_KEYWORDS]);
    expect(feasibilityRe.test('Technical risk — EHR integration may block us')).toBe(false);
    expect(feasibilityRe.test('Rischio tecnico — l\'integrazione EHR può bloccarci')).toBe(false);
  });
});

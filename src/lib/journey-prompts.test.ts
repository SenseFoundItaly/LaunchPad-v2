import { describe, it, expect } from 'vitest';
import { checkLabel, stageLabel, stageTagline, checkGap, checkEvidence, checkActionPrompt } from './journey-prompts';
import { STAGES } from '@/lib/journey';
import { translate, type MessageKey, type TranslateVars } from '@/lib/i18n/messages';

// Build locale-bound translate fns matching the TFn the helpers expect.
const tEn = (k: MessageKey, v?: TranslateVars) => translate('en', k, v);
const tIt = (k: MessageKey, v?: TranslateVars) => translate('it', k, v);
const FALLBACK = '<<UNMAPPED_FALLBACK>>';

describe('spine label i18n helpers', () => {
  // The founder's IT-consistency ask: EVERY spine check/stage the evaluator can
  // emit must have a localized label — otherwise it leaks English on an IT
  // project. Iterating the real STAGES definitions makes this fail the moment a
  // new check/stage is added without a matching journey-* key (not a silent gap).
  it('every canonical stage has a localized label + tagline (no English leak)', () => {
    for (const stage of STAGES) {
      expect(stageLabel(stage.id, FALLBACK, tIt), `stage ${stage.id} label`).not.toBe(FALLBACK);
      const tl = stageTagline(stage.id, undefined, tIt);
      expect(typeof tl === 'string' && tl.length > 0, `stage ${stage.id} tagline`).toBe(true);
    }
  });

  it('every canonical check has a localized label (no English leak)', () => {
    for (const stage of STAGES) {
      for (const check of stage.checks) {
        expect(checkLabel(check.id, FALLBACK, tIt), `check ${check.id}`).not.toBe(FALLBACK);
      }
    }
  });

  it('EN labels render byte-identical to the source English (EN projects unchanged)', () => {
    for (const stage of STAGES) {
      expect(stageLabel(stage.id, stage.label, tEn)).toBe(stage.label);
      for (const check of stage.checks) {
        expect(checkLabel(check.id, check.label, tEn)).toBe(check.label);
      }
    }
  });

  it('IT differs from EN for a representative check (translation actually applied)', () => {
    // competitors_mapped: EN "3+ competitors mapped" → IT "3+ concorrenti mappati"
    expect(checkLabel('competitors_mapped', 'x', tIt)).not.toBe(checkLabel('competitors_mapped', 'x', tEn));
    expect(stageLabel('market_validation', 'x', tIt)).not.toBe(stageLabel('market_validation', 'x', tEn));
  });

  it('an unmapped id falls back to the passed English label — never a raw key', () => {
    expect(checkLabel('totally_unknown_check', 'English fallback', tIt)).toBe('English fallback');
    expect(stageLabel('unknown_stage', 'English fallback', tIt)).toBe('English fallback');
    expect(stageTagline('unknown_stage', 'English tagline', tIt)).toBe('English tagline');
  });
});

describe('spine gap hint i18n (checkGap)', () => {
  const SENTINEL = '<<ENGLISH GAP>>';

  // Every check the evaluator can render a gap for must have an IT hint — else
  // it leaks English on an IT project. A new check without a journey-gap.* key
  // fails here.
  it('every canonical check has a localized IT gap hint (no English leak)', () => {
    for (const stage of STAGES) {
      for (const check of stage.checks) {
        expect(checkGap(check.id, SENTINEL, tIt, 'it'), `gap ${check.id}`).not.toBe(SENTINEL);
      }
    }
  });

  it('EN keeps the evaluator gap verbatim (runtime specifics like "2 of 3" intact)', () => {
    // EN must NOT be re-keyed — it renders result.gap as-is, so the dynamic
    // count/ratio the evaluator computed survives.
    expect(checkGap('competitors_mapped', '2 of 3 — ask Co-pilot to research more', tEn, 'en'))
      .toBe('2 of 3 — ask Co-pilot to research more');
    expect(checkGap('runway_clear', '8.5mo — raise or cut burn', tEn, 'en'))
      .toBe('8.5mo — raise or cut burn');
  });

  it('IT localizes and differs from the passed English gap', () => {
    expect(checkGap('competitors_mapped', SENTINEL, tIt, 'it')).not.toBe(SENTINEL);
    expect(checkGap('interviews_logged', SENTINEL, tIt, 'it')).not.toBe(SENTINEL);
  });

  it('undefined gap → undefined (passed / locked rows show no hint)', () => {
    expect(checkGap('problem_defined', undefined, tIt, 'it')).toBeUndefined();
  });

  it('an unmapped id falls back to the English gap — never a raw key', () => {
    expect(checkGap('totally_unknown_check', 'English gap', tIt, 'it')).toBe('English gap');
  });
});

describe('spine evidence i18n (checkEvidence)', () => {
  const SENTINEL = '<<ENGLISH EVIDENCE>>';

  it('every canonical check has a localized IT evidence string (no English leak)', () => {
    for (const stage of STAGES) {
      for (const check of stage.checks) {
        expect(checkEvidence(check.id, SENTINEL, tIt, 'it'), `evidence ${check.id}`).not.toBe(SENTINEL);
      }
    }
  });

  it('EN keeps the evaluator evidence verbatim (runtime "3 competitors" intact)', () => {
    expect(checkEvidence('competitors_mapped', "You've mapped 3 competitors in your space.", tEn, 'en'))
      .toBe("You've mapped 3 competitors in your space.");
  });

  it('undefined evidence → undefined (failed rows show a gap, not evidence)', () => {
    expect(checkEvidence('problem_defined', undefined, tIt, 'it')).toBeUndefined();
  });

  it('an unmapped id falls back to the English evidence — never a raw key', () => {
    expect(checkEvidence('totally_unknown_check', 'English evidence', tIt, 'it')).toBe('English evidence');
  });
});

/**
 * The clickable spine substeps and the chat briefing both route through
 * checkActionPrompt, which keyword-matches the check's ENGLISH label. A check
 * with no matching rule falls through to `journey-prompt.generic`, which
 * interpolates that English label into an otherwise Italian sentence:
 *
 *   "Aiutami con: GTM chances & challenges assessed"
 *
 * Seven gate checks shipped that way (2026-08-05) — every one of them added
 * for the founder's own request, so the newest work was the least guided. This
 * fails the moment another check is added without a routing rule.
 */
describe('every spine check routes to a real co-pilot prompt', () => {
  it('no check falls through to the generic English-leaking fallback', () => {
    const unrouted: string[] = [];
    for (const stage of STAGES) {
      for (const check of stage.checks) {
        // journey-prompt.generic is the ONLY prompt that interpolates the raw
        // label, so containing it is an exact test for the fallback.
        if (checkActionPrompt(check.label, tIt).includes(check.label)) {
          unrouted.push(`${stage.id}/${check.id} ("${check.label}")`);
        }
      }
    }
    expect(unrouted, `add a keyword rule in checkActionPrompt for:\n  ${unrouted.join('\n  ')}`).toEqual([]);
  });

  it('routes the 1C scoring REVIEW away from the baseline prompt', () => {
    // Both labels contain "Scoring". The review step asks the founder to
    // re-score against interview evidence; sending them to the baseline prompt
    // told them to redo work they had already done.
    const review = checkActionPrompt('Startup Scoring reviewed against the evidence', tEn);
    const baseline = checkActionPrompt('Startup Scoring baseline recorded', tEn);
    expect(review).not.toBe(baseline);
    expect(review.toLowerCase()).toContain('re-run');
  });
});

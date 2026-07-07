import { describe, it, expect } from 'vitest';
import { checkLabel, stageLabel, stageTagline } from './journey-prompts';
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

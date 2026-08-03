// Unit tests for the contract SCORER (runs in the default suite — free).
//
// #235's acceptance asks that the harness provably detects real failure ("run
// it against Haiku and reproduce the documented collapse"). These tests do that
// deterministically: each synthetic turn reproduces one documented failure mode
// — including the Haiku collapse (prose only, zero artifacts) — and asserts the
// scorer flags exactly the right rule. A harness nobody has seen fail is not
// evidence of anything.

import { describe, it, expect } from 'vitest';
import { scoreTurn } from './chat-contract-scorer';

const SOURCES = '"sources":[{"type":"inference","title":"Synthesized from project context","based_on":[{"type":"internal","title":"Idea Canvas","ref":"research","ref_id":"idea_canvas:solution"}],"reasoning":"follows from the canvas"}]';

const optionSet = (extra = '') =>
  `:::artifact{"type":"option-set","id":"os1"}\n{"prompt":"What next?","options":[{"id":"a","label":"Run market research","description":"Size the market"${extra}}]}\n:::`;

const goodTurn = `Here is the shape of your idea in one line.\n\n${optionSet()}`;

describe('chat contract scorer — a compliant turn', () => {
  it('passes every rule', () => {
    const s = scoreTurn(goodTurn, { beginner: true });
    expect(s.violations).toEqual([]);
    expect(s.artifactTypes).toEqual(['option-set']);
  });
});

describe('chat contract scorer — detects each documented failure mode', () => {
  it('THE HAIKU COLLAPSE: prose only, no artifact directive at all', () => {
    const s = scoreTurn('Sure! Here are some thoughts about your market and what I would do next.');
    const failed = s.violations.map((v) => v.rule);
    expect(failed).toContain('artifact-emitted');
    expect(failed).toContain('trailing-option-set');
  });

  it('turn ends WITHOUT a trailing option-set (skill output but no CTA)', () => {
    const s = scoreTurn(
      `Your market is large.\n\n:::artifact{"type":"metric-grid","id":"m1"}\n{"title":"Market","metrics":[{"label":"TAM","value":"$1B"}],${SOURCES}}\n:::`,
    );
    expect(s.violations.map((v) => v.rule)).toContain('trailing-option-set');
  });

  it('option-set is not LAST (CTA buried under another card)', () => {
    const s = scoreTurn(
      `Here you go.\n\n${optionSet()}\n\n:::artifact{"type":"metric-grid","id":"m2"}\n{"title":"Market","metrics":[{"label":"TAM","value":"$1B"}],${SOURCES}}\n:::`,
    );
    expect(s.violations.map((v) => v.rule)).toContain('trailing-option-set');
  });

  it('unterminated directive (the orphan-stripper case)', () => {
    const s = scoreTurn(`Working on it.\n\n:::artifact{"type":"option-set","id":"os2"}\n{"prompt":"hm"`);
    expect(s.violations.map((v) => v.rule)).toContain('no-orphan-directive');
  });

  it('factual artifact with NO sources is rejected', () => {
    const s = scoreTurn(
      `Numbers below.\n\n:::artifact{"type":"metric-grid","id":"m3"}\n{"title":"Market","metrics":[{"label":"TAM","value":"$1B"}]}\n:::\n\n${optionSet()}`,
    );
    expect(s.violations.map((v) => v.rule)).toContain('no-invalid-artifact');
  });

  it('emoji anywhere in founder-facing text', () => {
    const s = scoreTurn(`Great progress 🚀\n\n${optionSet()}`);
    expect(s.violations.map((v) => v.rule)).toContain('no-emoji');
  });

  it('the word "skill" leaking into prose', () => {
    const s = scoreTurn(`Let's run the market research skill next.\n\n${optionSet()}`);
    expect(s.violations.map((v) => v.rule)).toContain('no-skill-word');
  });

  it('the word "skill" leaking into an option label', () => {
    const s = scoreTurn(
      `Pick one.\n\n:::artifact{"type":"option-set","id":"os3"}\n{"prompt":"Next?","options":[{"id":"a","label":"Run the scoring skill","description":"Score the idea"}]}\n:::`,
    );
    expect(s.violations.map((v) => v.rule)).toContain('no-skill-word');
  });

  it('a credits field on an option (Tier-0 forbids it even though the TYPE still allows it)', () => {
    const s = scoreTurn(`Pick one.\n\n${optionSet(',"credits":4')}`);
    expect(s.violations.map((v) => v.rule)).toContain('no-credits-field');
  });

  it('prose blowing the beginner word cap', () => {
    const s = scoreTurn(`${'word '.repeat(400)}\n\n${optionSet()}`, { beginner: true });
    expect(s.violations.map((v) => v.rule)).toContain('prose-word-cap');
  });

  it('the word cap does NOT apply to an experienced-founder turn', () => {
    const s = scoreTurn(`${'word '.repeat(400)}\n\n${optionSet()}`, { beginner: false });
    expect(s.violations.map((v) => v.rule)).not.toContain('prose-word-cap');
  });

  it('"skill_id" inside an artifact is machine metadata, NOT a founder-facing leak', () => {
    const s = scoreTurn(
      `Here is a good next step.\n\n:::artifact{"type":"option-set","id":"os4"}\n{"prompt":"Next?","options":[{"id":"a","label":"Run market research","description":"Size the market","skill_id":"market-research"}]}\n:::`,
    );
    expect(s.violations.map((v) => v.rule)).not.toContain('no-skill-word');
  });
});

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
import { responseContract } from './chat/response-contract';

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

// ---------------------------------------------------------------------------
// Post-#485 per-turn format rules (#235 revived 2026-09-15).
//
// #485 added responseContract: when a founder asks for "two sentences", "three
// bullets" or "one table only", the prompt SUSPENDS the every-turn artifact +
// option-set mandate. The August scorer did not know that, so it would score a
// correct terse reply as a failure. These pin the exemptions, the new rules,
// and — most importantly — that the scorer keys on the exact directive wording
// responseContract emits, so a wording change breaks a test instead of silently
// switching the exemptions off.
// ---------------------------------------------------------------------------


const violationsOf = (raw: string, founderMessage?: string) =>
  scoreTurn(raw, { founderMessage }).violations.map((v) => v.rule);

describe('chat contract scorer — the directive wording it keys on still exists', () => {
  it('each exemption trigger matches what responseContract actually emits', () => {
    expect(responseContract('In two sentences, tell me.')).toMatch(/sentences TOTAL/);
    expect(responseContract('Give me three bullets.')).toMatch(/bullets TOTAL/);
    expect(responseContract('One table only please.')).toMatch(/ONE table artifact only/);
    expect(responseContract('Just talk, no saving.')).toMatch(/Discussion only:/);
    expect(responseContract('Answer in under 40 words.')).toMatch(/under 40 words/);
  });
});

describe('chat contract scorer — honours format requests', () => {
  const plain = 'Subscriptions fit repeat use. One-off pricing fits a single purchase.';

  it('a plain two-sentence reply is CORRECT when the founder asked for two sentences', () => {
    const v = violationsOf(plain, 'In two sentences: subscription or one-off?');
    expect(v).not.toContain('artifact-emitted');
    expect(v).not.toContain('trailing-option-set');
    expect(v).not.toContain('format-request-honoured');
  });

  it('the same reply with no format request is still the Haiku collapse', () => {
    // The exemption is driven by the founder's message, not granted to every
    // short reply — otherwise the collapse this harness exists for would pass.
    const v = violationsOf(plain);
    expect(v).toContain('artifact-emitted');
    expect(v).toContain('trailing-option-set');
  });

  it('adding cards after the founder asked for plain sentences is a violation', () => {
    const v = violationsOf(`${plain}\n\n${optionSet()}`, 'In two sentences: subscription or one-off?');
    expect(v).toContain('format-request-honoured');
  });

  it('one table only: a lone table with no prose passes; prose or an option-set fails', () => {
    const table = `:::artifact{"type":"metric-grid","id":"t1"}\n{"title":"Pricing","metrics":[{"label":"Monthly","value":"€19"}],${SOURCES}}\n:::`;
    expect(violationsOf(table, 'One table only comparing my options.')).toEqual([]);
    expect(violationsOf(`Here it is.\n\n${table}`, 'One table only comparing my options.')).toContain('format-request-honoured');
    expect(violationsOf(`${table}\n\n${optionSet()}`, 'One table only comparing my options.')).toContain('format-request-honoured');
  });

  it('a word limit is enforced when the founder sets one', () => {
    const long = Array.from({ length: 60 }, () => 'word').join(' ');
    expect(violationsOf(`${long}\n\n${optionSet()}`, 'Answer in under 40 words.')).toContain('format-request-honoured');
  });
});

describe('chat contract scorer — the post-#485 hard rules', () => {
  it('flags internal field names and proposal ids in founder-facing prose', () => {
    const v = violationsOf(`I updated value_proposition and staged pa_x1y2z3 for you.\n\n${optionSet()}`);
    expect(v).toContain('no-internal-keys');
  });

  it('flags a quoted context-block title', () => {
    expect(violationsOf(`Per your CURRENT IDEA CANVAS, the problem is clear.\n\n${optionSet()}`)).toContain('no-internal-keys');
  });

  it('does not flag skill_id — it is a machine field, not founder-facing text', () => {
    expect(violationsOf(`Here is one next step.\n\n${optionSet(',"skill_id":"market-research"')}`)).not.toContain('no-internal-keys');
  });

  it('a commit option on a discussion-only turn is a save the founder said not to make', () => {
    const commit = optionSet(',"commit":{"canvas":{"problem":"Cafes waste food"}}');
    expect(violationsOf(`Worth exploring.\n\n${commit}`, 'Just thinking out loud, no saving.')).toContain('no-save-in-discussion');
    // The same commit option is fine on a normal turn.
    expect(violationsOf(`Worth exploring.\n\n${commit}`)).not.toContain('no-save-in-discussion');
  });
});

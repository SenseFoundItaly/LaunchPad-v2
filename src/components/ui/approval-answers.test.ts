import { describe, it, expect } from 'vitest';
import { collectAnswers, type ApprovalQuestion } from './ApprovalCard';

const QS: ApprovalQuestion[] = [
  { id: 'flavors', question: 'How many flavors?', type: 'radio', options: ['Three', 'Five'] },
  { id: 'mixins', question: 'Which mix-ins?', type: 'check', options: ['Chips', 'Waffle'] },
  { id: 'market', question: 'Which market?', type: 'radio', options: ['Trucks', 'Shops'] },
];

describe('collectAnswers', () => {
  it('keys by question id, not position', () => {
    const out = collectAnswers(QS, { mixins: ['Chips', 'Waffle'] }, {});
    expect(out).toEqual({ mixins: { selected: ['Chips', 'Waffle'] } });
  });

  it('omits untouched questions rather than emitting empty answers', () => {
    // The gate must be able to tell "not answered" from "answered with nothing":
    // an empty entry would read downstream as an explicit empty response.
    const out = collectAnswers(QS, { flavors: ['Three'] }, {});
    expect(Object.keys(out)).toEqual(['flavors']);
    expect(out.mixins).toBeUndefined();
    expect(out.market).toBeUndefined();
  });

  it('carries free text alongside selections', () => {
    const out = collectAnswers(QS, { mixins: ['Chips'] }, { mixins: 'Pistachio' });
    expect(out.mixins).toEqual({ selected: ['Chips'], custom: 'Pistachio' });
  });

  it('accepts free text as the whole answer when nothing is selected', () => {
    const out = collectAnswers(QS, {}, { market: 'Direct to consumer' });
    expect(out.market).toEqual({ selected: [], custom: 'Direct to consumer' });
  });

  it('treats whitespace-only free text as no answer', () => {
    expect(collectAnswers(QS, {}, { market: '   ' })).toEqual({});
  });

  it('captures a final radio pick passed as freshly-computed values', () => {
    // The auto-advance path calls this with the values it just built, because
    // component state has not committed yet. Simulate that exact call.
    const nextSelected = { flavors: ['Three'], mixins: ['Chips'], market: ['Shops'] };
    const out = collectAnswers(QS, nextSelected, {});
    expect(out.market).toEqual({ selected: ['Shops'] });
    expect(Object.keys(out)).toHaveLength(3);
  });
});

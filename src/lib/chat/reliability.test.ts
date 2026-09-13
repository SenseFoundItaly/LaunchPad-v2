import { describe, expect, it } from 'vitest';
import { authorizesPricingWrite } from './write-authorization';
import { needsApprovalReview } from './option-action';
import { createMessageCache } from './message-cache';
import { responseContract } from './response-contract';

describe('pricing write authorization', () => {
  it.each([
    'What is our latest target segment and price hypothesis? Distinguish what is saved from what we only discussed.',
    'Correction: change the price hypothesis to €29. Propose a card for approval.',
    'Do not save pricing yet.', 'Quale prezzo abbiamo salvato?', 'What would happen if we change the price to 49?',
  ])('refuses a discussion/status turn: %s', text => expect(authorizesPricingWrite(text)).toBe(false));
  it.each(['Set the anchor price to €29.', 'Please update pricing to 49 euros.', 'Salva il prezzo di 29 euro.', 'Save €29 as our price hypothesis.'])('allows an explicit current write: %s', text => expect(authorizesPricingWrite(text)).toBe(true));
});

describe('approval action contracts', () => {
  it('makes unsupported approval promises free review links in either renderer', () => {
    for (const label of ['Approve pending card', 'Approva la scheda in sospeso', 'Confirm', 'Save this']) expect(needsApprovalReview({ label })).toBe(true);
    expect(needsApprovalReview({ label: 'Approve', commit: {} })).toBe(true);
    expect(needsApprovalReview({ label: 'Approve', commit: { canvas: { problem: 'A problem' } } })).toBe(false);
    expect(needsApprovalReview({ label: 'Review', navigate_to: 'actions' })).toBe(false);
    expect(needsApprovalReview({ label: 'Explain the problem' })).toBe(false);
  });
});

describe('long-chat parsing', () => {
  it('does not evict 600 completed messages when stream revisions arrive', () => {
    const cached = createMessageCache<string>();
    const messages = Array.from({ length: 600 }, (_, i) => ({ content: `Completed ${i}` }));
    let parses = 0;
    const compute = (text: string) => { parses++; return text; };
    messages.forEach(m => cached(m, compute));
    for (let frame = 0; frame < 20; frame++) {
      messages.forEach(m => cached(m, compute));
      cached({ content: `Streaming ${frame}` }, compute);
    }
    expect(parses).toBe(620);
    messages[0].content = 'Edited historical reply';
    expect(cached(messages[0], compute)).toBe('Edited historical reply');
    expect(parses).toBe(621);
  });
  it('repeats whole-response limits rather than limiting just a quotation', () => {
    expect(responseContract('Phrase the problem in two sentences.')).toContain('2 sentences TOTAL');
    expect(responseContract('Spiegalo in una frase.')).toContain('1 sentences TOTAL');
    expect(responseContract('Answer in fewer than 60 words')).toContain('under 60 words');
    expect(responseContract('Keep this to one compact comparison table')).toContain('ONE table artifact only');
    expect(responseContract('I saw one florist with unsold stems')).toContain('unsold is not discarded');
  });
});

import { describe, expect, it } from 'vitest';
import { isSimpleFollowUp } from './followup-routing';

const history = (answer: string, message: string) => [
  { role: 'user', content: 'Help me' }, { role: 'assistant', content: answer }, { role: 'user', content: message },
];

describe('follow-up model routing', () => {
  it.each(['market research', 'pricing', 'analisi mercato', 'continue', 'avanti', 'go ahead', 'stop', 'cancel', 'skip', 'undo'])(
    'keeps substantive short request %s on the full tool path', (message) => {
      expect(isSimpleFollowUp(message, history('What next?', message))).toBe(false);
    },
  );
  it.each(['yes', 'sì', 'ok'])( 'keeps approval %s of an analysis on the full tool path', (message) => {
    expect(isSimpleFollowUp(message, history(':::artifact{"type":"option-set"}\n{"options":[{"skill_id":"market-research"}]}\n:::', message))).toBe(false);
    expect(isSimpleFollowUp(message, history('Vuoi avviare questa analisi?', message))).toBe(false);
  });
  it('routes acknowledgements cheaply without weakening the first turn', () => {
    expect(isSimpleFollowUp('grazie', history('Your problem is recorded.', 'grazie'))).toBe(true);
    expect(isSimpleFollowUp('yes', history('That describes the problem.', 'yes'))).toBe(false);
    expect(isSimpleFollowUp('yes', [{ role: 'user', content: 'yes' }])).toBe(false);
  });
  it.each([
    ['Shall I compare the options in a table?', 'yes'],
    ['Shall I save this price?', 'sure'],
    ['Vuoi che prepari una proposta?', 'sì'],
    ['Should I update the customer segment or the price?', 'ok'],
    ['Shall I create the draft?', 'sounds good'],
  ])('keeps context-dependent agreement tool-capable: %s', (offer, reply) => {
    expect(isSimpleFollowUp(reply, history(offer, reply))).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { planFactSweep } from './chat-fact-sweep';

// planFactSweep — the pure core of the deterministic capture net. Keyword
// lists are IMPORTED from the Stage-2 checks, so anything the planner stages
// is guaranteed to close its check verbatim once applied; these tests pin the
// guards (already-captured, option clicks, triviality) and the family routing.

describe('planFactSweep', () => {
  it('stages a market-size item for an uncaptured Italian sizing statement (the INV5 phrasing)', () => {
    const items = planFactSweep('Il mercato totale è circa 30 miliardi di euro in Europa.', []);
    expect(items.map((i) => i.kind)).toEqual(['market_size_fact']);
    expect(items[0].value).toContain('30 miliardi');
    expect(items[0].sources?.[0]).toMatchObject({ type: 'user' });
  });

  it('routes each family to its item kind (multi-family message)', () => {
    const items = planFactSweep(
      'A differenza di Dentrix siamo cloud; il rischio tecnico principale è l\'integrazione EHR e dipende da API di terze parti.',
      [],
    );
    const kinds = items.map((i) => `${i.kind}${i.field ? `:${i.field}` : ''}`);
    expect(kinds).toContain('differentiation_fact');
    expect(kinds).toContain('tech_fact:risk');
    expect(kinds).toContain('tech_fact:dependencies');
  });

  it('build-approach and tech-risk stage SEPARATE items, one per 1B check', () => {
    // They used to collapse into one feasibility item, so `technical_risk_named`
    // had no staging call that targeted it and greened only when a feasibility
    // fact's wording happened to hit the risk keywords. One item per check.
    const items = planFactSweep(
      'Architettura a microservizi con stack tecnico Node; il rischio tecnico è la latenza.',
      [],
    );
    expect(items.filter((i) => i.kind === 'tech_fact' && i.field === 'feasibility')).toHaveLength(1);
    expect(items.filter((i) => i.kind === 'tech_fact' && i.field === 'risk')).toHaveLength(1);
  });

  it('skips a family already captured by an existing fact (applied OR pending)', () => {
    const items = planFactSweep(
      'Il mercato totale è circa 30 miliardi di euro.',
      ['Market size: TAM stimato 30 miliardi (dimensione del mercato UE).'],
    );
    expect(items).toEqual([]);
  });

  it('skips option-click messages — agent-drafted text is not a founder statement', () => {
    expect(planFactSweep('I choose: TAM $30B — commit the market size to canvas', [])).toEqual([]);
    expect(planFactSweep('Scelgo: rischio tecnico principale — latenza a scala', [])).toEqual([]);
  });

  it('skips trivial messages and non-matching prose', () => {
    expect(planFactSweep('ok grazie', [])).toEqual([]);
    expect(planFactSweep('Ci vediamo domani per la demo con il team, va bene alle 15?', [])).toEqual([]);
  });

  it('an uncaptured family still stages when a DIFFERENT family is already captured', () => {
    const items = planFactSweep(
      'Il mercato totale vale 30 miliardi e a differenza di Alpha siamo mobile-first.',
      ['A differenza di Alpha il nostro onboarding richiede 5 minuti.'],
    );
    expect(items.map((i) => i.kind)).toEqual(['market_size_fact']);
  });
});

import { describe, it, expect } from 'vitest';
import { cleanCanvasDetails } from './canvas-details';

describe('cleanCanvasDetails', () => {
  it('trims text, filters/limits array items, drops empties', () => {
    expect(cleanCanvasDetails({
      unfair_advantage: '  Network effects from designer referrals  ',
      key_metrics: ['MRR', '  ', 'Churn', 42 as unknown as string],
      revenue_streams: ['Subscriptions'],
      cost_structure: [],
    })).toEqual({
      unfair_advantage: 'Network effects from designer referrals',
      key_metrics: ['MRR', 'Churn'],
      revenue_streams: ['Subscriptions'],
      cost_structure: null, // empty array → null (nothing to write, keeps existing)
    });
  });

  it('returns all-null for missing / non-string / whitespace inputs', () => {
    expect(cleanCanvasDetails({})).toEqual({ unfair_advantage: null, key_metrics: null, revenue_streams: null, cost_structure: null });
    expect(cleanCanvasDetails({ unfair_advantage: '   ', key_metrics: '   \n  ' }))
      .toEqual({ unfair_advantage: null, key_metrics: null, revenue_streams: null, cost_structure: null });
    expect(cleanCanvasDetails({ revenue_streams: 42 as unknown as string[] }).revenue_streams).toBeNull();
  });

  it('coerces string list fields to arrays: newline split, commas preserved', () => {
    // The chat commit option emits prose strings — a single line becomes a
    // one-element array; commas inside stay intact (prose, not separators).
    expect(cleanCanvasDetails({ key_metrics: 'nope' }).key_metrics).toEqual(['nope']);
    expect(cleanCanvasDetails({ key_metrics: 'MRR\nChurn\n\n  Retention  ' }).key_metrics)
      .toEqual(['MRR', 'Churn', 'Retention']);
    // Regression: the exact commit.canvas payloads that were silently dropped
    // (LocalPulse, 2026-08-04) — must survive as single items, commas intact.
    expect(cleanCanvasDetails({
      revenue_streams: 'Abbonamento mensile per agente attivo + vendita di report premium su zone specifiche',
      cost_structure: 'Dati/cloud (fisso), sviluppo prodotto (principale), acquisizione clienti (variabile)',
      key_metrics: 'MRR, nuovi studi/mese, agenti attivi settimanali, retention mensile',
    })).toEqual({
      unfair_advantage: null,
      revenue_streams: ['Abbonamento mensile per agente attivo + vendita di report premium su zone specifiche'],
      cost_structure: ['Dati/cloud (fisso), sviluppo prodotto (principale), acquisizione clienti (variabile)'],
      key_metrics: ['MRR, nuovi studi/mese, agenti attivi settimanali, retention mensile'],
    });
  });

  it('caps arrays at 12 items', () => {
    const km = Array.from({ length: 20 }, (_, i) => `m${i}`);
    expect(cleanCanvasDetails({ key_metrics: km }).key_metrics).toHaveLength(12);
  });
});

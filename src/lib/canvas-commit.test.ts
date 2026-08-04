import { describe, it, expect } from 'vitest';
import { pickCanvasCommitFields, droppedCanvasCommitFields } from './canvas-commit';

describe('pickCanvasCommitFields', () => {
  it('passes core text fields trimmed, drops unknown keys and empties', () => {
    expect(pickCanvasCommitFields({
      problem: '  Agenti immobiliari perdono lead  ',
      solution: 'Radar di zona',
      not_a_field: 'dropped',
      target_market: '   ',
      value_proposition: 7,
    })).toEqual({
      problem: 'Agenti immobiliari perdono lead',
      solution: 'Radar di zona',
    });
  });

  it('forwards soft fields both as arrays and as prose strings', () => {
    expect(pickCanvasCommitFields({
      cost_structure: ['Dati/cloud (fisso)', '  Sviluppo prodotto  ', '', 42],
      revenue_streams: 'Abbonamento mensile per agente attivo',
      unfair_advantage: 'Rete di segnalatori locali',
    })).toEqual({
      cost_structure: ['Dati/cloud (fisso)', 'Sviluppo prodotto'],
      revenue_streams: 'Abbonamento mensile per agente attivo',
      unfair_advantage: 'Rete di segnalatori locali',
    });
  });

  it('drops arrays with no usable items', () => {
    expect(pickCanvasCommitFields({ key_metrics: ['', '   ', 42] })).toEqual({});
  });

  it('droppedCanvasCommitFields flags content-carrying keys the picker discarded', () => {
    // Aliased/localized keys (the drift mode behind the original stall) must
    // surface as dropped so the commit fails into retry instead of narrating
    // a complete canvas with a block missing.
    const raw = {
      solution: 'Radar di zona',
      costi: 'Dati/cloud (fisso), sviluppo prodotto',
      ricavi: ['Abbonamento mensile'],
      note: '',
      extra_null: null,
      cost_structure: [{ item: 'cloud', cost: 200 }],
    };
    const picked = pickCanvasCommitFields(raw);
    expect(picked).toEqual({ solution: 'Radar di zona' });
    expect(droppedCanvasCommitFields(raw, picked).sort())
      .toEqual(['cost_structure', 'costi', 'ricavi']);
  });

  it('droppedCanvasCommitFields is empty when everything persistable survived', () => {
    const raw = {
      problem: 'Lead persi',
      key_metrics: ['MRR'],
      empty_alias: '   ',
    };
    expect(droppedCanvasCommitFields(raw, pickCanvasCommitFields(raw))).toEqual([]);
  });

  it('regression: the LocalPulse close-the-canvas commit forwards all 3 soft strings', () => {
    // The exact commit.canvas payload silently dropped on 2026-08-04 — the old
    // 7-key allowlist filtered these out BEFORE the POST, so the canvas never
    // updated and Stage 1 stalled at 6/9 while the chat narrated "9/9 done".
    const picked = pickCanvasCommitFields({
      revenue_streams: 'Abbonamento mensile per agente attivo + vendita di report premium su zone specifiche',
      cost_structure: 'Dati/cloud (fisso), sviluppo prodotto (principale), acquisizione clienti (variabile)',
      key_metrics: 'MRR, nuovi studi/mese, agenti attivi settimanali, retention mensile',
    });
    expect(Object.keys(picked).sort()).toEqual(['cost_structure', 'key_metrics', 'revenue_streams']);
  });
});

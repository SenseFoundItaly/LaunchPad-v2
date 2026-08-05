import { describe, it, expect } from 'vitest';
import { diffCanvas, VERSIONED_CANVAS_FIELDS, type CanvasPayload } from './canvas-versions';

/**
 * The Loop-1 "diff visuale v1/v2" the Iteration Cycle mandates as loop output.
 * diffCanvas is pure, so the comparison rules are asserted here directly.
 */

const base: CanvasPayload = {
  problem: 'Dentists lose hours to manual recalls',
  solution: 'A cloud recall tool',
  target_market: 'Italian dental practices',
  value_proposition: 'Save 5 hours a week',
  cost_structure: ['hosting', 'support'],
};

describe('diffCanvas', () => {
  it('reports ONLY the fields that moved', () => {
    // Eleven rows where two changed is the fastest way to make a diff
    // unreadable — the whole point is seeing what the pivot touched.
    const after = { ...base, target_market: 'Italian dental chains, 5+ locations' };
    const changes = diffCanvas(base, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe('target_market');
    expect(changes[0].kind).toBe('changed');
    expect(changes[0].before).toContain('practices');
    expect(changes[0].after).toContain('chains');
  });

  it('classifies added and removed, not just changed', () => {
    expect(diffCanvas(base, { ...base, unfair_advantage: 'Exclusive data' })[0])
      .toMatchObject({ field: 'unfair_advantage', kind: 'added', before: null });
    expect(diffCanvas(base, { ...base, solution: null })[0])
      .toMatchObject({ field: 'solution', kind: 'removed', after: null });
  });

  it('is empty for an identical canvas', () => {
    expect(diffCanvas(base, { ...base })).toEqual([]);
  });

  it('treats whitespace-only edits as no change', () => {
    // Re-saving the canvas must not manufacture a pivot in the history.
    expect(diffCanvas(base, { ...base, problem: '  Dentists lose hours to manual recalls  ' })).toEqual([]);
  });

  it('treats empty string and null as the same absence', () => {
    expect(diffCanvas({ problem: '' }, { problem: null })).toEqual([]);
    expect(diffCanvas({ problem: null }, { problem: '   ' })).toEqual([]);
  });

  it('compares array fields entry-wise, not by reference', () => {
    expect(diffCanvas(base, { ...base, cost_structure: ['hosting', 'support'] })).toEqual([]);
    const changed = diffCanvas(base, { ...base, cost_structure: ['hosting', 'support', 'sales'] });
    expect(changed).toHaveLength(1);
    expect(changed[0].after).toContain('sales');
  });

  it('drops empty array entries rather than reporting a phantom change', () => {
    expect(diffCanvas({ cost_structure: ['hosting'] }, { cost_structure: ['hosting', '', '  '] })).toEqual([]);
    expect(diffCanvas({ cost_structure: [] }, { cost_structure: null })).toEqual([]);
  });

  it('covers the founder-authored canvas, in Lean Canvas reading order', () => {
    expect(VERSIONED_CANVAS_FIELDS).toContain('problem');
    expect(VERSIONED_CANVAS_FIELDS).toContain('value_proposition');
    expect(VERSIONED_CANVAS_FIELDS).toContain('cost_structure');
    expect(VERSIONED_CANVAS_FIELDS[0]).toBe('problem');
    expect(new Set(VERSIONED_CANVAS_FIELDS).size).toBe(VERSIONED_CANVAS_FIELDS.length);
  });

  it('reports every changed field when a heavy pivot moves several', () => {
    // The case the spec is actually for: a PIVOT that rewrites ICP, problem
    // and value prop together.
    const pivoted = {
      ...base,
      problem: 'Chains cannot standardise recalls across locations',
      target_market: 'Dental chains',
      value_proposition: 'One recall policy across every location',
    };
    expect(diffCanvas(base, pivoted).map((c) => c.field).sort())
      .toEqual(['problem', 'target_market', 'value_proposition']);
  });
});

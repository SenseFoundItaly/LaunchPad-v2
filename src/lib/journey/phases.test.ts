import { describe, it, expect } from 'vitest';
import { PHASES, phaseStatus, buildSpine, type PhaseEval } from './phases';
import type { StageId } from './types';

const ev = (statuses: Partial<Record<StageId, 'done' | 'active' | 'pending'>>): PhaseEval[] =>
  (Object.entries(statuses) as [StageId, 'done' | 'active' | 'pending'][]).map(([id, status]) => ({ stage: { id }, status }));

describe('phaseStatus', () => {
  const p1 = PHASES.find((p) => p.n === 1)!; // Validation Gate ← [market_validation]
  const p2 = PHASES.find((p) => p.n === 2)!; // Business Essentials ← [persona, business_model]

  it('done only when every reduced stage is done', () => {
    expect(phaseStatus(p2, ev({ persona: 'done', business_model: 'done' }))).toBe('done');
    expect(phaseStatus(p2, ev({ persona: 'done', business_model: 'active' }))).toBe('active'); // partial
  });
  it('active once any reduced stage has started', () => {
    expect(phaseStatus(p1, ev({ market_validation: 'active' }))).toBe('active');
  });
  it('pending when nothing has started', () => {
    expect(phaseStatus(p2, ev({ persona: 'pending', business_model: 'pending' }))).toBe('pending');
    expect(phaseStatus(p2, ev({}))).toBe('pending'); // no data
  });
});

describe('buildSpine', () => {
  it('interleaves the 5 phases with loops in the transitions + the module', () => {
    const spine = buildSpine(ev({ idea_validation: 'done', market_validation: 'active' }));
    const shape = spine.map((n) => n.kind === 'phase' ? `P${n.n}` : n.kind === 'loop' ? `L${n.loopNumber}` : 'MOD');
    // P0 · P1 · L1 · P2 · MOD · L2 · P3 · L3 · P4 · L4
    expect(shape).toEqual(['P0', 'P1', 'L1', 'P2', 'MOD', 'L2', 'P3', 'L3', 'P4', 'L4']);
  });
  it('reduces phase status from the live stage evals', () => {
    const spine = buildSpine(ev({ idea_validation: 'done', market_validation: 'active' }));
    const phases = spine.filter((n) => n.kind === 'phase') as Extract<typeof spine[number], { kind: 'phase' }>[];
    expect(phases.find((p) => p.n === 0)!.status).toBe('done');
    expect(phases.find((p) => p.n === 1)!.status).toBe('active');
    expect(phases.find((p) => p.n === 2)!.status).toBe('pending');
  });
});

describe('PHASES config', () => {
  it('is 5 macro phases (0-4); fundraise + operate are NOT phases (IRL add-ons)', () => {
    expect(PHASES.map((p) => p.n)).toEqual([0, 1, 2, 3, 4]);
    const allStages = PHASES.flatMap((p) => p.stageIds);
    expect(allStages).not.toContain('fundraise');
    expect(allStages).not.toContain('operate');
  });
});

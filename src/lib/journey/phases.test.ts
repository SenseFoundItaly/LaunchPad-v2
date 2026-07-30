import { describe, it, expect } from 'vitest';
import { PHASES, phaseStatus, buildSpine, type PhaseEval } from './phases';
import type { StageId } from './types';

const ev = (statuses: Partial<Record<StageId, 'done' | 'active' | 'pending'>>): PhaseEval[] =>
  (Object.entries(statuses) as [StageId, 'done' | 'active' | 'pending'][])
    .map(([id, status]) => ({ stage: { id }, status, passed: status === 'done' ? 2 : 1, total: 2 }));

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


describe('buildSpine — CONTIGUITY (regression: real projects showed later phases "validated" while phase 0 was active)', () => {
  // Observed on real projects: the later stages carry far fewer checks, so they
  // pass fully while idea_validation is 5/9 — the spine then claimed phases 2-4
  // were validated for a founder still on phase 0.
  const realWorld = ev({
    idea_validation: 'active',    // 5/9 in the wild
    market_validation: 'pending', // 2/12
    persona: 'done', business_model: 'done', build_launch: 'done',
  });

  it('never shows a later phase as done while an earlier one is not', () => {
    const phases = buildSpine(realWorld).filter((n) => n.kind === 'phase') as Extract<ReturnType<typeof buildSpine>[number], { kind: 'phase' }>[];
    const firstNotDone = phases.findIndex((p) => p.status !== 'done');
    expect(phases.slice(firstNotDone).every((p) => p.status !== 'done')).toBe(true);
  });

  it("marks evidence-complete-but-blocked phases 'ahead', not 'done'", () => {
    const phases = buildSpine(realWorld).filter((n) => n.kind === 'phase') as Extract<ReturnType<typeof buildSpine>[number], { kind: 'phase' }>[];
    expect(phases.find((p) => p.n === 0)!.status).toBe('active'); // the phase in play
    expect(phases.find((p) => p.n === 2)!.status).toBe('ahead');  // was falsely 'done'
    expect(phases.find((p) => p.n === 3)!.status).toBe('ahead');
  });

  it('still shows a genuinely contiguous run as done', () => {
    const phases = buildSpine(ev({ idea_validation: 'done', market_validation: 'done', persona: 'done', business_model: 'done' }))
      .filter((n) => n.kind === 'phase') as Extract<ReturnType<typeof buildSpine>[number], { kind: 'phase' }>[];
    expect(phases.find((p) => p.n === 0)!.status).toBe('done');
    expect(phases.find((p) => p.n === 1)!.status).toBe('done');
    expect(phases.find((p) => p.n === 2)!.status).toBe('done');
  });

  it('carries evidence tallies for the readout', () => {
    const p0 = buildSpine(realWorld).find((n) => n.kind === 'phase' && n.n === 0) as Extract<ReturnType<typeof buildSpine>[number], { kind: 'phase' }>;
    expect(p0.total).toBeGreaterThan(0);
  });
});

// Tooltip coverage (spine hover explainers). The component maps phase and loop
// numbers to i18n keys; a phase added here without a matching key would lose
// its explainer silently, since a missing tooltip renders as no tooltip.
describe('spine tooltip coverage', () => {
  it('every phase and every interleaved loop has an explainer key in BOTH locales', async () => {
    const { en } = await import('@/lib/i18n/messages/en');
    const { it: itMsgs } = await import('@/lib/i18n/messages/it');
    for (const p of PHASES) {
      const key = `journey-phase.tip-phase-${p.n}`;
      expect(en, `missing EN ${key}`).toHaveProperty(key);
      expect(itMsgs, `missing IT ${key}`).toHaveProperty(key);
      if (p.loopAfter) {
        const lk = `journey-phase.tip-loop-${p.loopAfter}`;
        expect(en, `missing EN ${lk}`).toHaveProperty(lk);
        expect(itMsgs, `missing IT ${lk}`).toHaveProperty(lk);
      }
    }
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// stageSequenceLock reads a journey snapshot then evaluates stages. Mock the
// snapshot + evaluator so we can drive the active stage deterministically.
const { snapMock, evalMock, activeMock } = vi.hoisted(() => ({
  snapMock: vi.fn(), evalMock: vi.fn(), activeMock: vi.fn(),
}));
vi.mock('@/lib/journey/snapshot', () => ({ buildProjectSnapshot: snapMock }));
vi.mock('@/lib/journey/index', () => ({ evaluateAllStages: evalMock, activeStage: activeMock }));

import { stageSequenceLock, stageNumberForSkill, LOCK_FROM_STAGE } from '@/lib/journey/stage-lock';
import { en } from '@/lib/i18n/messages/en';
import { it as itMsgs } from '@/lib/i18n/messages/it';

describe('stage-locked message is localized (gap #2 — no English leak for IT)', () => {
  it('exists in both EN and IT with the interpolation placeholders', () => {
    for (const [name, m] of [['en', en], ['it', itMsgs]] as const) {
      const msg = (m as Record<string, string>)['skills.stage-locked'];
      expect(msg, `${name} missing skills.stage-locked`).toBeTruthy();
      expect(msg).toContain('{skillStage}');
      expect(msg).toContain('{blockingName}');
      expect(msg).toContain('{passed}');
    }
  });
});

function active(number: number, label = `Stage ${number}`) {
  activeMock.mockReturnValue({ stage: { number, label }, passed: 1, total: 3 });
}

describe('stageNumberForSkill', () => {
  it('maps skills to their pipeline stage', () => {
    expect(stageNumberForSkill('startup-scoring')).toBe(1);      // stage 1
    expect(stageNumberForSkill('market-research')).toBe(2);      // stage 2
    expect(stageNumberForSkill('prototype-spec')).toBe(5);       // Build & Launch
    expect(stageNumberForSkill('investment-readiness')).toBe(6); // Fundraise
    expect(stageNumberForSkill('weekly-metrics')).toBe(7);       // Operate
    expect(stageNumberForSkill('not-a-skill')).toBeNull();
  });
  it('locks from stage 5', () => { expect(LOCK_FROM_STAGE).toBe(5); });
});

describe('stageSequenceLock', () => {
  beforeEach(() => { snapMock.mockReset(); evalMock.mockReset(); activeMock.mockReset(); snapMock.mockResolvedValue({}); evalMock.mockReturnValue([]); });

  it('never locks stages 1-4 (returns not-locked without checking snapshot)', async () => {
    const r = await stageSequenceLock('p1', 'market-research'); // stage 2
    expect(r.locked).toBe(false);
    expect(snapMock).not.toHaveBeenCalled();
  });

  it('LOCKS a Build & Launch skill when the founder is still on Stage 2', async () => {
    active(2, 'Validation Gate');
    const r = await stageSequenceLock('p1', 'prototype-spec'); // stage 5
    expect(r.locked).toBe(true);
    expect(r.skillStage).toBe(5);
    expect(r.blockingStage).toBe(2);
    expect(r.message).toContain('Validation Gate');
  });

  it('LOCKS Fundraise while Build & Launch (5) is the active stage', async () => {
    active(5, 'Build & Launch');
    const r = await stageSequenceLock('p1', 'pitch-coaching'); // stage 6
    expect(r.locked).toBe(true);
    expect(r.blockingStage).toBe(5);
  });

  it('UNLOCKS Build & Launch once the active stage reaches 5', async () => {
    active(5, 'Build & Launch');
    const r = await stageSequenceLock('p1', 'gtm-strategy'); // stage 5
    expect(r.locked).toBe(false);
  });

  it('UNLOCKS Operate when all earlier stages are done (active at 7)', async () => {
    active(7, 'Operate');
    const r = await stageSequenceLock('p1', 'weekly-metrics'); // stage 7
    expect(r.locked).toBe(false);
  });

  it('fails OPEN (not locked) if the snapshot throws — a lock bug must never wedge the founder', async () => {
    snapMock.mockRejectedValueOnce(new Error('db down'));
    const r = await stageSequenceLock('p1', 'prototype-spec');
    expect(r.locked).toBe(false);
  });
});

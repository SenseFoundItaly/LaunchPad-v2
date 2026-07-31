import { describe, it, expect, vi, beforeEach } from 'vitest';

// persona-card / risk-matrix / weekly-update used to be view-only no-ops:
// chat-inline emissions rendered once and persisted nothing (ephemerality
// audit 2026-07-21). These tests pin the new persisters' merge semantics.
const { getMock, runMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  runMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ get: getMock, run: runMock, query: vi.fn() }));

import { persistArtifact } from '@/lib/artifact-persistence';
import type { Artifact } from '@/types/artifacts';

const ctx = { userId: 'u1', projectId: 'p1' };

describe('persona-card → simulation.personas', () => {
  beforeEach(() => { getMock.mockReset(); runMock.mockReset(); });

  it('no simulation row → INSERT with a single-persona array', async () => {
    getMock.mockResolvedValue(undefined);
    const r = await persistArtifact(ctx, {
      type: 'persona-card', id: 'a1', name: 'Coach Marco', archetype: 'customer',
      pains: ['manual video review'], sources: [],
    } as unknown as Artifact);
    expect(r.persisted).toBe(true);
    const [sql, , personas] = runMock.mock.calls[0];
    expect(String(sql)).toContain('INSERT INTO simulation');
    expect(personas).toHaveLength(1);
    expect(personas[0].name).toBe('Coach Marco');
  });

  it('same name (case-insensitive) merges in place, preserving prior fields', async () => {
    getMock.mockResolvedValue({
      personas: [{ name: 'coach marco', engagement_score: 8, reaction: 'positive' }],
    });
    await persistArtifact(ctx, {
      type: 'persona-card', id: 'a1', name: 'Coach Marco', archetype: 'customer',
      pains: ['manual video review'], sources: [],
    } as unknown as Artifact);
    const [sql, personas] = runMock.mock.calls[0];
    expect(String(sql)).toContain('UPDATE simulation SET personas');
    expect(personas).toHaveLength(1);
    // Incoming fields land; prior Stage-2 validation fields survive.
    expect(personas[0].pains).toEqual(['manual video review']);
    expect(personas[0].engagement_score).toBe(8);
  });

  it('a new name appends instead of replacing', async () => {
    getMock.mockResolvedValue({ personas: [{ name: 'Coach Marco' }] });
    await persistArtifact(ctx, {
      type: 'persona-card', id: 'a1', name: 'Direttore Anna', archetype: 'customer', sources: [],
    } as unknown as Artifact);
    const [, personas] = runMock.mock.calls[0];
    expect(personas).toHaveLength(2);
  });
});

describe('risk-matrix → simulation.risk_scenarios', () => {
  beforeEach(() => { getMock.mockReset(); runMock.mockReset(); });

  const RISK = {
    id: 'r1', dimension: 'market', risk: 'Veo undercuts pricing',
    probability: 0.6, impact: 0.8, mitigation: 'battlecard + annual plans',
  };

  it('no row → INSERT with the risks array (mitigation included)', async () => {
    getMock.mockResolvedValue(undefined);
    const r = await persistArtifact(ctx, {
      type: 'risk-matrix', id: 'a1', title: 'Risk matrix', risks: [RISK], sources: [],
    } as unknown as Artifact);
    expect(r.persisted).toBe(true);
    const [sql, , risks] = runMock.mock.calls[0];
    expect(String(sql)).toContain('INSERT INTO simulation');
    expect(risks[0].mitigation).toBe('battlecard + annual plans');
  });

  it('NEVER clobbers a skill audit blob (non-array risk_scenarios)', async () => {
    getMock.mockResolvedValue({ risk_scenarios: { risk_audit: { top_risks: [] } } });
    const r = await persistArtifact(ctx, {
      type: 'risk-matrix', id: 'a1', title: 'Risk matrix', risks: [RISK], sources: [],
    } as unknown as Artifact);
    expect(r.persisted).toBe(false);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('same risk id merges (mitigation/status edits), new risks append', async () => {
    getMock.mockResolvedValue({ risk_scenarios: [{ id: 'r1', risk: 'Veo undercuts pricing', status: 'new' }] });
    await persistArtifact(ctx, {
      type: 'risk-matrix', id: 'a1', title: 'Risk matrix',
      risks: [{ ...RISK, status: 'in_progress' }, { id: 'r2', dimension: 'regulatory', risk: 'AI Act minors', probability: 0.3, impact: 0.9 }],
      sources: [],
    } as unknown as Artifact);
    const [, risks] = runMock.mock.calls[0];
    expect(risks).toHaveLength(2);
    expect(risks[0].status).toBe('in_progress');
  });
});

describe('weekly-update → startup_updates', () => {
  beforeEach(() => { getMock.mockReset(); runMock.mockReset(); });

  it('new period → INSERT', async () => {
    getMock.mockResolvedValue(undefined);
    const r = await persistArtifact(ctx, {
      type: 'weekly-update', id: 'a1', title: 'Week 38', period: '2026-W38',
      morale: 7, highlights: ['38 club attivi'], sources: [],
    } as unknown as Artifact);
    expect(r.persisted).toBe(true);
    expect(String(runMock.mock.calls[0][0])).toContain('INSERT INTO startup_updates');
  });

  it('same period → refresh in place, no duplicate row', async () => {
    getMock.mockResolvedValue({ id: 'upd_1' });
    const r = await persistArtifact(ctx, {
      type: 'weekly-update', id: 'a1', title: 'Week 38', period: '2026-W38',
      highlights: ['MRR +18%'], sources: [],
    } as unknown as Artifact);
    expect(r.persisted).toBe(true);
    expect(String(runMock.mock.calls[0][0])).toContain('UPDATE startup_updates');
  });

  it('no period → not persisted (nothing to key the journey feed on)', async () => {
    const r = await persistArtifact(ctx, {
      type: 'weekly-update', id: 'a1', title: 'Update', period: '', sources: [],
    } as unknown as Artifact);
    expect(r.persisted).toBe(false);
    expect(runMock).not.toHaveBeenCalled();
  });
});

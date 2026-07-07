import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pins the metric-grid → research.market_size routing (audit B3): the sizing
// column is reserved for actual TAM/SAM/SOM grids — operational dashboards
// were landing there 3/8 times in prod under the old broad regex — and a
// routed re-write must CARRY the founder's approval stamp keys.
const { getMock, runMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  runMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ get: getMock, run: runMock, query: vi.fn() }));

import { persistArtifact } from '@/lib/artifact-persistence';
import type { MetricGrid } from '@/types/artifacts';

const ctx = { userId: 'u1', projectId: 'p1' };
const grid = (title: string): MetricGrid => ({
  type: 'metric-grid',
  id: 'mg_1',
  title,
  metrics: [{ label: 'TAM', value: '$2B' }],
  sources: [{ type: 'web', title: 'src', url: 'https://example.com' }],
});

const researchWrites = () =>
  runMock.mock.calls.filter(([sql]) => /research/i.test(String(sql)));

beforeEach(() => {
  getMock.mockReset(); runMock.mockReset();
  getMock.mockResolvedValue(undefined);
  runMock.mockResolvedValue({ count: 1 });
});

describe('persistMetricGrid — isMarket routing', () => {
  it('routes a real market-sizing grid into research.market_size', async () => {
    const r = await persistArtifact(ctx, grid('Market Sizing (TAM/SAM/SOM)'));
    expect(r.persisted).toBe(true);
    expect(r.target).toContain('research.market_size');
    expect(researchWrites().length).toBe(1);
  });

  it('does NOT route an operational dashboard into the sizing column', async () => {
    const r = await persistArtifact(ctx, grid('Weekly Health Dashboard'));
    expect(r.persisted).toBe(true);
    expect(r.target).toBe('graph_nodes'); // still visible in Context
    expect(researchWrites().length).toBe(0);
  });

  it('does NOT route "size"/"executive" lookalike titles (the prod mis-route class)', async () => {
    for (const title of ['Executive Summary', 'Team size benchmark', 'Demand funnel']) {
      runMock.mockClear();
      await persistArtifact(ctx, grid(title));
      expect(researchWrites().length, title).toBe(0);
    }
  });

  it('a routed re-write over an existing row carries the approval stamp keys', async () => {
    getMock
      .mockResolvedValueOnce({ project_id: 'p1' }) // research row exists
      .mockResolvedValueOnce(undefined); // graph-node lookup
    await persistArtifact(ctx, grid('TAM update'));
    const [sql] = researchWrites()[0];
    expect(String(sql)).toContain('UPDATE research');
    expect(String(sql)).toContain("'approved', market_size->'approved'");
    expect(String(sql)).toContain('approved_value');
  });
});

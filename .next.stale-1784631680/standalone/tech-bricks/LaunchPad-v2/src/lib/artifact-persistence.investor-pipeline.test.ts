import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pins the investor-pipeline → graph_nodes routing (audit B7): each named
// investor lands as a PENDING funding_source node (founder applies from
// knowledge review — nothing enters intelligence without their click),
// deduped on LOWER(name) so a re-emitted pipeline updates instead of
// duplicating.
const { getMock, runMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  runMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ get: getMock, run: runMock, query: vi.fn() }));

import { persistArtifact } from '@/lib/artifact-persistence';
import type { InvestorPipelineArtifact, InvestorEntry } from '@/types/artifacts';

const ctx = { userId: 'u1', projectId: 'p1' };
const pipeline = (investors: Partial<InvestorEntry>[], round_type?: string): InvestorPipelineArtifact => ({
  type: 'investor-pipeline',
  id: 'ip_1',
  title: 'Seed pipeline',
  round_type,
  investors: investors as InvestorEntry[],
});

const nodeInserts = () =>
  runMock.mock.calls.filter(([sql]) => /INSERT INTO graph_nodes/i.test(String(sql)));
const nodeUpdates = () =>
  runMock.mock.calls.filter(([sql]) => /UPDATE graph_nodes/i.test(String(sql)));
const edgeInserts = () =>
  runMock.mock.calls.filter(([sql]) => /INSERT INTO graph_edges/i.test(String(sql)));

beforeEach(() => {
  getMock.mockReset(); runMock.mockReset();
  getMock.mockResolvedValue(undefined);
  runMock.mockResolvedValue([]);
});

describe('persistInvestorPipeline — investors → PENDING funding_source nodes', () => {
  it('inserts each named investor as a pending funding_source node with {stage, check_size, round}', async () => {
    const r = await persistArtifact(ctx, pipeline([
      { id: 'inv_1', name: 'Acme Ventures', type: 'VC', stage: 'contacted', check_size: 500000 },
      { id: 'inv_2', name: 'Jane Angel', type: 'angel', stage: 'target' },
    ], 'Seed'));
    expect(r.persisted).toBe(true);
    expect(r.target).toContain('funding_source ×2');

    const inserts = nodeInserts();
    expect(inserts.length).toBe(2);
    // INSERT params: (id, project_id, name, node_type, summary, attributes, sources, reviewed_state)
    const [, , , name, nodeType, , attributes, , reviewedState] = inserts[0];
    expect(name).toBe('Acme Ventures');
    expect(nodeType).toBe('funding_source');
    expect(reviewedState).toBe('pending'); // founder applies — never auto-applied
    expect(attributes).toEqual({ stage: 'contacted', check_size: 500000, round: 'Seed' });
  });

  it('dedups on LOWER(name): an existing node is UPDATED, not re-inserted', async () => {
    getMock
      .mockResolvedValueOnce(undefined)            // your_startup root lookup
      .mockResolvedValueOnce({ id: 'node_seen' }); // existing node by LOWER(name)
    const r = await persistArtifact(ctx, pipeline([
      { id: 'inv_1', name: 'Acme Ventures', stage: 'meeting' },
    ]));
    expect(r.persisted).toBe(true);
    expect(r.persisted_id).toBe('node_seen');
    expect(nodeInserts().length).toBe(0);
    const updates = nodeUpdates();
    expect(updates.length).toBe(1);
    // UPDATE must not touch reviewed_state — an applied investor stays applied.
    expect(String(updates[0][0])).not.toContain('reviewed_state');
  });

  it('links new investors to the startup root with a funded_by edge', async () => {
    getMock
      .mockResolvedValueOnce({ id: 'root_1' }) // your_startup root
      .mockResolvedValueOnce(undefined)        // no existing node
      .mockResolvedValueOnce(undefined);       // no existing edge
    await persistArtifact(ctx, pipeline([{ id: 'inv_1', name: 'Acme Ventures' }]));
    const edges = edgeInserts();
    expect(edges.length).toBe(1);
    expect(String(edges[0][0])).toContain("'funded_by'");
  });

  it('skips unnamed/junk entries and reports nothing persisted when none survive', async () => {
    const r = await persistArtifact(ctx, pipeline([
      { id: 'inv_1', name: '' },
      { id: 'inv_2', name: 'Options' }, // junk heading name
    ]));
    expect(r.persisted).toBe(false);
    expect(nodeInserts().length).toBe(0);
  });
});

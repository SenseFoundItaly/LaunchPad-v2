import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ query: vi.fn(), run: runMock }));
vi.mock('@/lib/api-helpers', () => ({ generateId: (p: string) => `${p}_test` }));

import { isRetrievableArtifact, captureChatArtifact } from '@/lib/chat-artifacts';

describe('isRetrievableArtifact (gap C blocklist)', () => {
  it('captures analysis/deliverable cards', () => {
    for (const t of ['comparison-table', 'metric-grid', 'risk-matrix', 'persona-card', 'tam-sam-som', 'insight-card', 'bar-chart', 'entity-card']) {
      expect(isRetrievableArtifact(t), t).toBe(true);
    }
  });
  it('skips ephemeral / proposal / already-stored types', () => {
    for (const t of ['option-set', 'skill-suggestion', 'knowledge-suggestion', 'monitor-proposal', 'validation-proposal', 'action-suggestion', 'solve-progress', 'document', 'html-preview', 'fact', 'workflow-card']) {
      expect(isRetrievableArtifact(t), t).toBe(false);
    }
  });
});

describe('captureChatArtifact', () => {
  beforeEach(() => runMock.mockReset());

  it('inserts a retrievable artifact with RAW jsonb payload + sources (no double-encode)', async () => {
    const artifact = { type: 'comparison-table', id: 'a1', title: 'Competitors', sources: [{ type: 'web', url: 'https://x', title: 'X' }] } as never;
    const id = await captureChatArtifact({ projectId: 'p1', turnPreview: 'map competitors' }, artifact);
    expect(id).toBe('cart_test');
    expect(runMock).toHaveBeenCalledOnce();
    const args = runMock.mock.calls[0];
    // payload arg is the raw object, sources arg is the raw array (not strings).
    expect(typeof args[6]).toBe('object');
    expect(Array.isArray(args[7])).toBe(true);
    expect(args[4]).toBe('comparison-table'); // artifact_type
    expect(args[5]).toBe('Competitors');      // title
  });

  it('no-ops (returns null, no insert) for a non-retrievable type', async () => {
    const id = await captureChatArtifact({ projectId: 'p1' }, { type: 'option-set', id: 'o1' } as never);
    expect(id).toBeNull();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('derives a friendly title when the artifact has none', async () => {
    await captureChatArtifact({ projectId: 'p1' }, { type: 'risk-matrix', id: 'r1' } as never);
    expect(runMock.mock.calls[0][5]).toBe('Risk matrix');
  });

  it('never throws on a DB error (returns null)', async () => {
    runMock.mockRejectedValueOnce(new Error('db down'));
    await expect(captureChatArtifact({ projectId: 'p1' }, { type: 'metric-grid', id: 'm1' } as never)).resolves.toBeNull();
  });
});

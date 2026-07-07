import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pins the reshape-merge behavior (audit B2): an open AUTO card the founder
// hasn't touched absorbs new items in place; a founder-edited card is NEVER
// clobbered (a fresh card is created instead); identical re-emissions stage
// nothing. Plus stageMarketSizeProposal (audit B4) and the direct-apply
// supersede (audit A8). DB + pending-actions are mocked — no live DB.
const { queryMock, createMock, updateMock, rejectMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  rejectMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ query: queryMock, run: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/pending-actions', () => ({
  createPendingAction: createMock,
  updateOpenProposalPayload: updateMock,
  rejectPendingAction: rejectMock,
}));
vi.mock('@/lib/credits', () => ({ KNOWLEDGE_APPLY_CREDITS: 1 }));

import {
  autoStageValidationFromArtifact,
  stageMarketSizeProposal,
  supersedeCoveredAutoProposals,
} from '@/lib/auto-stage-validation';
import type { IdeaCanvasArtifact } from '@/types/artifacts';

const canvasArtifact = (problem: string): IdeaCanvasArtifact => ({
  type: 'idea-canvas',
  id: 'ic_test',
  title: 'Test',
  problem,
});

type Item = Record<string, unknown>;
const problemItem = (value: string): Item => ({ id: 'item_0', kind: 'canvas_field', field: 'problem', label: 'Problem', value });
const marketItem = (value: string): Item => ({ id: 'item_1', kind: 'market_size_fact', label: 'Market size', value });

function openRow(over: Partial<{ id: string; status: string; payload: unknown; edited_payload: unknown }> = {}) {
  return {
    id: 'pa_open',
    status: 'pending',
    payload: { origin: 'auto', items: [problemItem('OLD problem statement'), marketItem('Market size — TAM $1B')] },
    edited_payload: null,
    ...over,
  };
}

beforeEach(() => {
  queryMock.mockReset(); createMock.mockReset(); updateMock.mockReset(); rejectMock.mockReset();
  createMock.mockResolvedValue({ id: 'pa_new' });
  updateMock.mockResolvedValue(true);
  rejectMock.mockResolvedValue({ id: 'pa_open', status: 'rejected' });
});

describe('autoStageValidationFromArtifact — reshape merge', () => {
  it('merges a reshape into the open untouched auto card (same-slot replace, other items kept)', async () => {
    queryMock.mockResolvedValue([openRow()]);
    const r = await autoStageValidationFromArtifact('p1', canvasArtifact('NEW sharper problem statement'));

    expect(r.staged).toBe(true);
    expect(r.merged).toBe(true);
    expect(r.pendingActionId).toBe('pa_open');
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledTimes(1);
    const [id, payload] = updateMock.mock.calls[0];
    expect(id).toBe('pa_open');
    const items = (payload as { items: Item[] }).items;
    expect(items).toHaveLength(2); // replaced in place, not appended
    expect(items[0].value).toBe('NEW sharper problem statement');
    expect(items[1].value).toBe('Market size — TAM $1B'); // non-matching item kept
    expect((payload as { origin: string }).origin).toBe('auto');
  });

  it('never clobbers a founder-edited card — creates a NEW proposal instead', async () => {
    queryMock.mockResolvedValue([openRow({
      status: 'edited',
      edited_payload: { origin: 'auto', items: [problemItem('Founder-tuned wording')] },
    })]);
    const r = await autoStageValidationFromArtifact('p1', canvasArtifact('Agent reshape attempt'));

    expect(updateMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ staged: true, pendingActionId: 'pa_new' });
  });

  it('does not merge into a chat/tool-origin proposal — creates a NEW card', async () => {
    queryMock.mockResolvedValue([openRow({ payload: { origin: 'chat', items: [problemItem('Tool-staged')] } })]);
    const r = await autoStageValidationFromArtifact('p1', canvasArtifact('Different problem entirely'));

    expect(updateMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(r.staged).toBe(true);
  });

  it('is idempotent: identical values already staged (even founder-edited) stage nothing', async () => {
    queryMock.mockResolvedValue([openRow({
      status: 'edited',
      edited_payload: { origin: 'auto', items: [problemItem('Same problem statement')] },
    })]);
    const r = await autoStageValidationFromArtifact('p1', canvasArtifact('Same problem statement'));

    expect(r.staged).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('stages a fresh card when nothing is open', async () => {
    queryMock.mockResolvedValue([]);
    const r = await autoStageValidationFromArtifact('p1', canvasArtifact('A brand new problem statement'));

    expect(createMock).toHaveBeenCalledTimes(1);
    const input = createMock.mock.calls[0][0];
    expect(input.action_type).toBe('validation_proposal');
    expect(input.payload.origin).toBe('auto');
    expect(r).toMatchObject({ staged: true, itemCount: 1 });
  });

  it('falls back to a fresh card when the merge loses the race (founder resolved mid-flight)', async () => {
    queryMock.mockResolvedValue([openRow()]);
    updateMock.mockResolvedValue(false);
    const r = await autoStageValidationFromArtifact('p1', canvasArtifact('Race-condition reshape'));

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(r.staged).toBe(true);
    expect(r.merged).toBeUndefined();
  });
});

describe('stageMarketSizeProposal', () => {
  it('creates one approve-to-green market-size card when nothing is open', async () => {
    queryMock.mockResolvedValue([]);
    const r = await stageMarketSizeProposal('p1', { tam: '$2.5B', sam: '$400M', som: '$40M' });

    expect(r.staged).toBe(true);
    const input = createMock.mock.calls[0][0];
    const items = input.payload.items as Item[];
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('market_size_fact');
    expect(items[0].value).toBe('Market size — TAM $2.5B · SAM $400M · SOM $40M');
  });

  it('merges the sizing item into the open auto card instead of blocking on it', async () => {
    queryMock.mockResolvedValue([openRow({ payload: { origin: 'auto', items: [problemItem('Canvas in review')] } })]);
    const r = await stageMarketSizeProposal('p1', { tam: '$2.5B' });

    expect(r).toMatchObject({ staged: true, merged: true, pendingActionId: 'pa_open' });
    const items = (updateMock.mock.calls[0][1] as { items: Item[] }).items;
    expect(items).toHaveLength(2); // canvas item kept, sizing appended
    expect(items[1].kind).toBe('market_size_fact');
  });

  it('replaces a stale sizing item on re-run (per-kind slot), does not duplicate', async () => {
    queryMock.mockResolvedValue([openRow({ payload: { origin: 'auto', items: [marketItem('Market size — TAM $1B')] } })]);
    const r = await stageMarketSizeProposal('p1', { tam: '$2.5B' });

    expect(r.merged).toBe(true);
    const items = (updateMock.mock.calls[0][1] as { items: Item[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0].value).toBe('Market size — TAM $2.5B');
  });

  it('does not block on an unrelated founder-edited proposal — new card', async () => {
    queryMock.mockResolvedValue([openRow({
      status: 'edited',
      edited_payload: { origin: 'auto', items: [problemItem('Founder-tuned')] },
    })]);
    const r = await stageMarketSizeProposal('p1', { tam: '$2.5B' });

    expect(updateMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(r.staged).toBe(true);
  });

  it('stages nothing without any tier', async () => {
    const r = await stageMarketSizeProposal('p1', {});
    expect(r.staged).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('supersedeCoveredAutoProposals — direct canvas apply', () => {
  const canvasRow = {
    problem: 'Applied problem', solution: 'Applied solution', target_market: null,
    value_proposition: null, business_model: null, competitive_advantage: null, channels: null,
  };

  it('rejects only the untouched auto card whose canvas items are all applied', async () => {
    queryMock
      .mockResolvedValueOnce([canvasRow]) // idea_canvas read
      .mockResolvedValueOnce([
        openRow({ id: 'pa_covered', payload: { origin: 'auto', items: [problemItem('Draft problem')] } }),
        openRow({ id: 'pa_market', payload: { origin: 'auto', items: [problemItem('x'), marketItem('TAM $1B')] } }),
        openRow({ id: 'pa_edited', status: 'edited', payload: { origin: 'auto', items: [problemItem('y')] }, edited_payload: { origin: 'auto', items: [problemItem('y')] } }),
        openRow({ id: 'pa_chat', payload: { origin: 'chat', items: [problemItem('z')] } }),
        openRow({ id: 'pa_uncovered', payload: { origin: 'auto', items: [{ id: 'item_0', kind: 'canvas_field', field: 'channels', label: 'Channels', value: 'Direct sales' }] } }),
      ]);

    const closed = await supersedeCoveredAutoProposals('p1');
    expect(closed).toBe(1);
    expect(rejectMock).toHaveBeenCalledTimes(1);
    expect(rejectMock.mock.calls[0][0]).toBe('pa_covered');
  });

  it('no canvas row → no-op', async () => {
    queryMock.mockResolvedValueOnce([]);
    expect(await supersedeCoveredAutoProposals('p1')).toBe(0);
    expect(rejectMock).not.toHaveBeenCalled();
  });
});

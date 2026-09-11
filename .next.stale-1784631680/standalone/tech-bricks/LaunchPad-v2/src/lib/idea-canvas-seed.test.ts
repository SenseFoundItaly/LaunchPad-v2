import { describe, it, expect, vi, beforeEach } from 'vitest';

// The seed hits the DB (canvasIsEmpty + open-proposal dedup), the LLM
// (chatJSONByTask), and the auto-stage path. Mock all three so the GUARDS
// (thin description, dedup, already-has-content, all-empty extraction, the
// timeout, never-throw) are pinned without a live DB/LLM.
const { queryMock, chatMock, autoStageMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  chatMock: vi.fn(),
  autoStageMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ query: queryMock, run: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/llm', () => ({ chatJSONByTask: chatMock }));
vi.mock('@/lib/auto-stage-validation', () => ({ autoStageValidationFromArtifact: autoStageMock }));

import { seedIdeaCanvasFromDescription } from '@/lib/idea-canvas-seed';

const RICH = 'Un SaaS gestionale per piccole palestre italiane che automatizza abbonamenti, rinnovi e promemoria ai clienti via WhatsApp.';
const ARGS = (over = {}) => ({ projectId: 'p1', name: 'PalestraSmart', description: RICH, locale: 'it', ...over });

/** canvasIsEmpty → [] (empty), hasOpenProposal → [] (none). */
function dbFreshProject() {
  queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
}

describe('seedIdeaCanvasFromDescription', () => {
  beforeEach(() => { queryMock.mockReset(); chatMock.mockReset(); autoStageMock.mockReset(); });

  it('skips a thin description WITHOUT an LLM call', async () => {
    const r = await seedIdeaCanvasFromDescription(ARGS({ description: 'too short' }));
    expect(r.seeded).toBe(false);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('skips (no LLM) when an open proposal already exists — dedup before paying', async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'pa_1' }]);
    const r = await seedIdeaCanvasFromDescription(ARGS());
    expect(r.seeded).toBe(false);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('skips (no LLM) when the canvas already has content', async () => {
    queryMock.mockResolvedValueOnce([{ problem: 'già definito', solution: null, target_market: null, value_proposition: null, competitive_advantage: null, business_model: null }]);
    const r = await seedIdeaCanvasFromDescription(ARGS());
    expect(r.seeded).toBe(false);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('stages an idea-canvas artifact from a non-empty extraction (empty fields dropped)', async () => {
    dbFreshProject();
    chatMock.mockResolvedValue({ problem: 'P', solution: 'S', target_market: '', value_proposition: 'V', competitive_advantage: '', business_model: '' });
    autoStageMock.mockResolvedValue({ staged: true, itemCount: 3 });

    const r = await seedIdeaCanvasFromDescription(ARGS());
    expect(r.seeded).toBe(true);
    expect(autoStageMock).toHaveBeenCalledTimes(1);
    const [pid, artifact] = autoStageMock.mock.calls[0];
    expect(pid).toBe('p1');
    expect(artifact.type).toBe('idea-canvas');
    expect(artifact.problem).toBe('P');
    expect(artifact.value_proposition).toBe('V');
    expect(artifact.target_market).toBeUndefined(); // empty string → not written
    expect(artifact.business_model).toBeUndefined();
    expect(artifact.sources?.[0]?.type).toBe('inference'); // AI-extracted provenance, not founder-verbatim
  });

  it('does NOT stage when the extraction yields all-empty fields', async () => {
    dbFreshProject();
    chatMock.mockResolvedValue({ problem: '', solution: '   ', target_market: '', value_proposition: '', competitive_advantage: '', business_model: '' });
    const r = await seedIdeaCanvasFromDescription(ARGS());
    expect(r.seeded).toBe(false);
    expect(autoStageMock).not.toHaveBeenCalled();
  });

  it('never throws if the LLM call rejects', async () => {
    dbFreshProject();
    chatMock.mockRejectedValue(new Error('provider 500'));
    const r = await seedIdeaCanvasFromDescription(ARGS());
    expect(r.seeded).toBe(false);
    expect(autoStageMock).not.toHaveBeenCalled();
  });

  it('skips on extraction timeout (cannot hang creation)', async () => {
    vi.useFakeTimers();
    try {
      dbFreshProject();
      chatMock.mockReturnValue(new Promise(() => {})); // never resolves
      const p = seedIdeaCanvasFromDescription(ARGS());
      await vi.advanceTimersByTimeAsync(8_001);
      const r = await p;
      expect(r.seeded).toBe(false);
      expect(autoStageMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

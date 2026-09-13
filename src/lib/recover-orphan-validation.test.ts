import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock, runMock, getMock, rows, actions } = vi.hoisted(() => ({
  queryMock: vi.fn(), runMock: vi.fn(), getMock: vi.fn(),
  rows: [] as Array<{ id: string; content: string }>,
  actions: new Map<string, Record<string, unknown>>(),
}));
vi.mock('./db', () => ({ query: queryMock, run: runMock }));
vi.mock('./pending-actions', () => ({ getPendingAction: getMock }));

import { recoverOrphanValidation, findRecoveredValidation, recoveredValidationEdits } from './recover-orphan-validation';

const item = { id: 'item_0', kind: 'canvas_field', field: 'problem', label: 'Problem', value: 'Original problem', sources: [] };
const original = { items: [item] };
const edited = { items: [{ ...item, value: 'Founder edited problem' }] };
const input = { projectId: 'proj_1', requestedId: 'pending', artifactId: 'validation_1', transition: 'apply', editedPayload: edited };
const card = (id = 'validation_1') => `:::artifact{"type":"validation-proposal","id":"${id}"}\n${JSON.stringify({ pending_action_id: 'pending', ...original })}\n:::`;

beforeEach(() => {
  vi.clearAllMocks();
  rows.splice(0, rows.length, { id: 'msg_original', content: card() });
  actions.clear();
  queryMock.mockImplementation(async (_sql: string, projectId: string) => projectId === 'proj_1' ? rows : []);
  runMock.mockImplementation(async (_sql: string, id: string, projectId: string, _title: string, _rationale: string, payload: unknown) => {
    // Emulate the primary-key ON CONFLICT guard, including simultaneous inserts.
    if (!actions.has(id)) actions.set(id, { id, project_id: projectId, payload, status: 'pending' });
  });
  getMock.mockImplementation(async (id: string) => actions.get(id) ?? null);
});

describe('durable orphan-card recovery', () => {
  it('recovers once across repeat, edited, and concurrent requests', async () => {
    const [first, second] = await Promise.all([recoverOrphanValidation(input), recoverOrphanValidation(input)]);
    expect(first?.id).toBe(second?.id);
    const third = await recoverOrphanValidation({ ...input, editedPayload: original });
    expect(third?.id).toBe(first?.id);
    expect(actions.size).toBe(1);
    expect(runMock.mock.calls[0][0]).toContain('ON CONFLICT (id) DO NOTHING');
    expect(first?.payload.items).toEqual(original.items); // identity/original never based on edited text
  });

  it('keeps two real cards with the same placeholder separate', async () => {
    rows.push({ id: 'msg_other', content: card('validation_2') });
    const first = await recoverOrphanValidation(input);
    const second = await recoverOrphanValidation({ ...input, artifactId: 'validation_2' });
    expect(first?.id).not.toBe(second?.id);
    expect(actions.size).toBe(2);
  });

  it('lets Skip resolve and keeps it resolved on reload/retry', async () => {
    const skipped = await recoverOrphanValidation({ ...input, transition: 'reject', editedPayload: undefined });
    expect(skipped).not.toBeNull();
    actions.get(skipped!.id)!.status = 'rejected';
    expect((await recoverOrphanValidation(input))?.status).toBe('rejected');
    runMock.mockClear();
    expect((await findRecoveredValidation(input))?.status).toBe('rejected');
    expect(runMock).not.toHaveBeenCalled();
  });

  it('allows dismissal of an authentic malformed card without applying it', async () => {
    rows[0].content = ':::artifact{"type":"validation-proposal","id":"validation_1"}\n{"pending_action_id":"pending","items":[]}\n:::';
    expect(await recoverOrphanValidation(input)).toBeNull();
    expect(await recoverOrphanValidation({ ...input, transition: 'reject' })).not.toBeNull();
  });

  it('refuses invented, wrong-project, wrong-placeholder and ambiguous cards', async () => {
    expect(await recoverOrphanValidation({ ...input, artifactId: undefined })).toBeNull();
    expect(await recoverOrphanValidation({ ...input, artifactId: 'invented' })).toBeNull();
    expect(await recoverOrphanValidation({ ...input, projectId: 'proj_other' })).toBeNull();
    expect(await recoverOrphanValidation({ ...input, requestedId: 'another-placeholder' })).toBeNull();
    rows.push({ id: 'msg_duplicate', content: card() });
    expect(await recoverOrphanValidation(input)).toBeNull();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('read-only lookup never stages a row, and recovery cannot edit/send/fail', async () => {
    expect(await findRecoveredValidation(input)).toBeNull();
    for (const transition of ['edit', 'mark_sent', 'mark_failed']) {
      expect(await recoverOrphanValidation({ ...input, transition })).toBeNull();
    }
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('recovered founder edits', () => {
  it('keeps approved text, strips forged metadata, and supports removing items', () => {
    const source = { items: [item, { ...item, id: 'item_1' }] };
    const forged = { items: [{ ...item, value: 'New text', sources: [{ url: 'fake' }], extra: { wtp_amount: 100 }, credits: 100 }] };
    expect(recoveredValidationEdits(source, forged)).toEqual({ items: [{ ...item, value: 'New text' }] });
  });

  it('refuses injected, retyped, duplicate, empty and whitespace items', () => {
    for (const items of [[], [{ ...item, id: 'unknown' }], [{ ...item, kind: 'interview' }], [item, item], [{ ...item, value: ' ' }]]) {
      expect(recoveredValidationEdits(original, { items })).toBeNull();
    }
  });
});

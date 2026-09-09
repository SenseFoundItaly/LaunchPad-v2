import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('./pending-actions', () => ({ createPendingAction: createMock }));

import { recoverOrphanValidation, extractValidationItems } from './recover-orphan-validation';

/**
 * Measured on prod 2026-09-08 20:58: a "Valida le prove" card carried
 * `"pending_action_id": "pending"` — the literal placeholder word, not an id.
 * No such row existed, Apply answered 404, and because the task check keys off
 * a successful apply, the founder's validation funnel stopped dead at a button
 * that could never work.
 *
 * Recovery has to be narrow. It stages rows from a request body, so anything it
 * does not positively recognise must still 404 rather than be guessed at.
 */

const item = (over: Record<string, unknown> = {}) => ({
  id: 'item_0', kind: 'market', field: 'market_size', label: 'Market size',
  value: 'TAM €500M', credits: 1, ...over,
});

describe('what counts as a recoverable validation payload', () => {
  it('accepts the shape the card actually sends', () => {
    expect(extractValidationItems({ items: [item(), item({ id: 'item_1' })] })).toHaveLength(2);
  });

  it('rejects anything that is not a validation payload', () => {
    for (const bad of [null, undefined, {}, { items: [] }, { items: 'nope' }, 'string', 42]) {
      expect(extractValidationItems(bad as unknown), JSON.stringify(bad)).toBeNull();
    }
  });

  it('rejects a partially-garbage list rather than salvaging the good half', () => {
    // Half-understood input means we do not understand the input.
    expect(extractValidationItems({ items: [item(), { id: 'x' }] })).toBeNull();
    expect(extractValidationItems({ items: [item(), item({ value: '   ' })] })).toBeNull();
  });

  it('refuses an implausibly long list', () => {
    const many = Array.from({ length: 21 }, (_, i) => item({ id: `item_${i}` }));
    expect(extractValidationItems({ items: many })).toBeNull();
    expect(extractValidationItems({ items: many.slice(0, 20) })).toHaveLength(20);
  });
});

describe('recovery only fires where it is safe', () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({ id: 'pa_realrowid123', project_id: 'proj_1' });
  });

  it('stages the approved items and returns the REAL row', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const row = await recoverOrphanValidation({
      projectId: 'proj_1', requestedId: 'pending', transition: 'apply',
      editedPayload: { items: [item()] },
    });
    expect(row?.id).toBe('pa_realrowid123');
    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0][0];
    expect(arg).toMatchObject({ project_id: 'proj_1', action_type: 'validation_proposal' });
    expect(arg.payload.origin).toBe('recovered');
    expect(arg.payload.items).toHaveLength(1);
    // The bogus id is recorded, so how often the Co-pilot does this is measurable.
    expect(warn.mock.calls[0][0]).toContain('"pending"');
    warn.mockRestore();
  });

  it('never fires on a non-apply transition', async () => {
    for (const transition of ['reject', 'edit', 'mark_sent', 'mark_failed']) {
      expect(await recoverOrphanValidation({
        projectId: 'proj_1', requestedId: 'pending', transition,
        editedPayload: { items: [item()] },
      })).toBeNull();
    }
    expect(createMock).not.toHaveBeenCalled();
  });

  it('never fires without a payload it recognises — the 404 still stands', async () => {
    expect(await recoverOrphanValidation({
      projectId: 'proj_1', requestedId: 'pa_whatever', transition: 'apply', editedPayload: undefined,
    })).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('the route uses the resolved row, not the id from the URL', () => {
  const route = readFileSync(
    join(process.cwd(), 'src/app/api/projects/[projectId]/actions/[actionId]/route.ts'),
    'utf-8',
  );

  it('recovers before giving up with a 404', () => {
    expect(route).toMatch(/recoverOrphanValidation\(/);
    const recover = route.indexOf('recoverOrphanValidation({');
    const notFound = route.indexOf("if (!existing) return error('Action not found', 404)");
    expect(recover).toBeGreaterThan(-1);
    expect(recover, 'recovery must be attempted BEFORE the 404').toBeLessThan(notFound);
  });

  it('every transition addresses the row that was actually resolved', () => {
    // A recovered row is NEWLY created, so its id is not the one in the URL.
    // Applying `actionId` there would operate on a row that does not exist.
    expect(route).toMatch(/const rowId = existing\.id;/);
    const body = route.slice(route.indexOf('let updated;'));
    expect(body).toMatch(/applyPendingAction\(rowId\)/);
    expect(body).toMatch(/editPendingAction\(rowId,/);
    expect(body, 'no transition may still use the raw URL id').not.toMatch(/\(actionId[,)]/);
  });

  it('the project ownership check still runs on the resolved row', () => {
    expect(route).toMatch(/existing\.project_id !== projectId/);
  });
});

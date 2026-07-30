import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ run: runMock }));

import { appendNodeTimeline, timelineEntryNow } from './node-timeline';
import { coerceTimeline } from '@/lib/timeline';

beforeEach(() => { vi.clearAllMocks(); runMock.mockResolvedValue([]); });

describe('timelineEntryNow', () => {
  it('stamps an ISO date + kind, includes fields only when non-empty', () => {
    const e = timelineEntryNow('founder_edit', 'Updated', { fields: ['name'] });
    expect(e.kind).toBe('founder_edit');
    expect(e.headline).toBe('Updated');
    expect(e.fields).toEqual(['name']);
    expect(Number.isNaN(new Date(e.date!).getTime())).toBe(false);
    expect(timelineEntryNow('apply', 'Approved').fields).toBeUndefined();
    expect(timelineEntryNow('apply', 'Approved', { fields: [] }).fields).toBeUndefined();
  });
});

describe('appendNodeTimeline', () => {
  it('appends atomically in SQL (jsonb_set + cap 20), scoped to (id, project_id), RAW array bind', async () => {
    const entry = timelineEntryNow('apply', 'Approved');
    await appendNodeTimeline('proj_1', 'node_1', entry);
    expect(runMock).toHaveBeenCalledTimes(1);
    const [sql, boundEntry, nodeId, projectId] = runMock.mock.calls[0];
    expect(sql).toContain('jsonb_set');
    expect(sql).toContain("'{timeline}'");
    expect(sql).toContain('LIMIT 20');
    expect(sql).toContain('WHERE id = ? AND project_id = ?');
    // RAW array (single-encode into jsonb) — never a pre-stringified string.
    expect(Array.isArray(boundEntry)).toBe(true);
    expect(boundEntry[0]).toBe(entry);
    expect(nodeId).toBe('node_1');
    expect(projectId).toBe('proj_1');
  });

  it('is NON-THROWING: a failed history write never fails the mutation it documents', async () => {
    runMock.mockRejectedValueOnce(new Error('db down'));
    await expect(appendNodeTimeline('p', 'n', timelineEntryNow('apply', 'x'))).resolves.toBeUndefined();
  });
});

describe('coerceTimeline with origin-tagged entries', () => {
  it('accepts kind/fields-carrying entries alongside legacy ones', () => {
    const parsed = coerceTimeline([
      { headline: 'legacy watcher move', date: '2026-01-01' },
      { headline: 'Updated', kind: 'founder_edit', fields: ['name'] },
      { not_an_entry: true },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[1].kind).toBe('founder_edit');
  });
});

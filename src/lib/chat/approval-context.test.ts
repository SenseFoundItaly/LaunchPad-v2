import { expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ query: vi.fn() }));
import { query } from '@/lib/db';
import { loadApprovalContext } from './approval-context';

it('reports successful server applies as saved without treating hypotheses as validation', async () => {
  vi.mocked(query).mockResolvedValue([{ id: 'pa1', payload: { items: [{ kind: 'canvas_field', field: 'problem' }, { kind: 'canvas_field', field: 'target_market' }] } }]);
  const context = await loadApprovalContext('p1');
  expect(context).toContain('founder applied problem, target_market successfully');
  expect(context).toContain('not market validation');
  expect(context).toContain('later edits, removals and pivots supersede these approvals');
  expect(context).toContain('never restore an old value');
  expect(vi.mocked(query).mock.calls[0][0]).toContain("status = 'sent'");
  expect(vi.mocked(query).mock.calls[0][1]).toBe('p1');
});

it('does not invent approvals from malformed or unrelated payloads', async () => {
  vi.mocked(query).mockResolvedValue([{ id: 'pa1', payload: 'invalid' }, { id: 'pa2', payload: { items: [{ kind: 'tech_fact' }] } }]);
  expect(await loadApprovalContext('p1')).toBe('');
});

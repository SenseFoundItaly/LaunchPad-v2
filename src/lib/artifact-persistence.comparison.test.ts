import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ get: vi.fn(), run: vi.fn(), query: vi.fn() }));
import { get, run, query } from '@/lib/db';
import { persistArtifact } from './artifact-persistence';
import type { ComparisonTable } from '@/types/artifacts';

const table = (title: string): ComparisonTable => ({
  type: 'comparison-table', id: 'cmp-probe', title, columns: ['Advantage', 'Limitation'], sources: [],
  rows: [{ label: 'Shared spreadsheet', values: ['Familiar', 'Manual process'] }, { label: 'Dedicated app', values: ['Tailored input', 'Build effort'] }],
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(get).mockResolvedValue(undefined);
  vi.mocked(run).mockResolvedValue([] as never);
  vi.mocked(query).mockResolvedValue([]);
});

it.each(['Shared Spreadsheet vs Dedicated App', '10 vs 25 paying shops', 'Platform options', 'Alternative pricing scenarios'])(
  'keeps ordinary comparisons out of competitor research and proposals: %s', async title => {
    const result = await persistArtifact({ projectId: 'p1', userId: 'u1' }, table(title));
    expect(result.persisted).toBe(true);
    expect(result.target).toBe('graph_nodes');
    expect(vi.mocked(run).mock.calls.some(([sql]) => /(?:INSERT INTO|UPDATE) research/.test(sql))).toBe(false);
    const nodeInserts = vi.mocked(run).mock.calls.filter(([sql]) => /INSERT INTO graph_nodes/.test(sql));
    expect(nodeInserts).toHaveLength(1);
    expect(nodeInserts[0]).toContain('comparison');
    expect(nodeInserts[0]).not.toContain('competitor');
  },
);

it.each(['Competitor comparison', 'Confronto concorrenti', 'Competitive landscape'])(
  'still stages explicitly identified competitors for founder review: %s', async title => {
    const result = await persistArtifact({ projectId: 'p1', userId: 'u1' }, table(title));
    expect(result.target).toContain('research.competitors');
    expect(result.target).toContain('2 pending competitor');
    const competitors = vi.mocked(run).mock.calls.filter(([sql, ...params]) => /INSERT INTO graph_nodes/.test(sql) && params.includes('competitor'));
    expect(competitors).toHaveLength(2);
    expect(competitors.every(call => call.includes('pending'))).toBe(true);
  },
);

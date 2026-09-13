import { expect, it } from 'vitest';
import { comparisonColumns } from './comparison-columns';
import { buildArtifactExport, buildArtifactMarkdown } from '@/lib/artifact-export';
import type { ComparisonTable } from '@/types/artifacts';

const table: ComparisonTable = { type: 'comparison-table', id: 't1', title: 'Pricing assumptions', sources: [{ type: 'user', title: 'Founder input', quote: '€29' }], columns: ['Item', 'Value', 'Type'], rows: [{ label: 'Price per shop', values: ['€29', 'Founder assumption'] }] };

it('aligns an explicit identity header and column types without changing values', () => {
  expect(comparisonColumns({ ...table, column_types: ['text', 'currency', 'text'] })).toEqual({ identityLabel: 'Item', columns: ['Value', 'Type'], columnTypes: ['currency', 'text'] });
  expect(table.rows[0].values).toEqual(['€29', 'Founder assumption']);
});
it('leaves canonical and incomplete table shapes untouched', () => {
  expect(comparisonColumns({ ...table, columns: ['Value', 'Type'] }).identityLabel).toBeUndefined();
  expect(comparisonColumns({ ...table, columns: ['Price', 'Cost', 'Margin'] }).columns).toHaveLength(3);
});
it('uses the same aligned headers in CSV and Markdown exports', () => {
  expect(buildArtifactExport(table)?.text.split(/\r?\n/)[0]).toBe('Item,Value,Type');
  expect(buildArtifactMarkdown(table)?.text).toContain('| Item | Value | Type |');
  expect(buildArtifactMarkdown(table)?.text).toContain('| Price per shop | €29 | Founder assumption |');
});

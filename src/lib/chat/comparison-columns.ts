import type { ComparisonTable } from '@/types/artifacts';

/** The artifact contract excludes row labels from columns, but models often
 * include an explicit Item/Metric header. Recognize that complete shape rather
 * than shifting prices into Item and adding an empty trailing column. */
export function comparisonColumns(table: Pick<ComparisonTable, 'columns' | 'rows' | 'column_types'>) {
  const hasIdentityHeader = /^(item|line item|metric|option|factor|assumption|competitor|voce|elemento|metrica|opzione|parametro|ipotesi)$/i.test(table.columns[0]?.trim() ?? '')
    && table.rows.length > 0 && table.rows.every(row => row.values.length === table.columns.length - 1);
  return {
    identityLabel: hasIdentityHeader ? table.columns[0] : undefined,
    columns: hasIdentityHeader ? table.columns.slice(1) : table.columns,
    columnTypes: hasIdentityHeader && table.column_types?.length === table.columns.length ? table.column_types.slice(1) : table.column_types,
  };
}

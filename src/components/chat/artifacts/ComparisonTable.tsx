'use client';

import type { ComparisonTable as ComparisonTableType, ColumnType } from '@/types/artifacts';
import { useT } from '@/components/providers/LocaleProvider';
import { RecordsTable, type RecordCell, type RecordColumn, type RecordRow } from '@/components/ui/RecordsTable';
import ArtifactCardShell from './ArtifactCardShell';
import KnowledgeApplyControls from './SavedHint';

interface ComparisonTableProps {
  artifact: ComparisonTableType;
  onAction?: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
  /** Mount collapsed (older-turn artifacts on the canvas). */
  defaultCollapsed?: boolean;
}

/**
 * Format a cell value according to its column type, as a RecordsTable cell.
 *
 * The typed formatting rules are unchanged from the hand-rolled table this
 * replaced — same currency abbreviation thresholds, same 0-1 → 0-100 percentage
 * rescale, same 0-10 score clamp and moss/accent/clay bands, same hostname-only
 * link display. What changed is the CARRIER: RecordCell takes text, not
 * ReactNode, so the colour that used to live in a <span>/progress bar is
 * carried by a `dot` cell instead (`link` for urls, `text` for the rest). No
 * number is re-scaled and no threshold moved — in particular the score clamp
 * stays 0-10; the open question about that scale is not settled here.
 */
function formatCell(value: string | number, colType: ColumnType | undefined): RecordCell {
  const type = colType ?? 'text';

  switch (type) {
    case 'currency': {
      const num = typeof value === 'number' ? value : parseFloat(String(value));
      if (isNaN(num)) return { kind: 'text', text: String(value) };
      const text =
        Math.abs(num) >= 1_000_000_000 ? `$${(num / 1_000_000_000).toFixed(1)}B`
        : Math.abs(num) >= 1_000_000 ? `$${(num / 1_000_000).toFixed(1)}M`
        : Math.abs(num) >= 1_000 ? `$${(num / 1_000).toFixed(0)}K`
        : `$${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
      // sort on the raw number: "$1.2M" vs "$900K" sorts wrong lexically.
      return { kind: 'text', text, sort: num };
    }
    case 'percentage': {
      const num = typeof value === 'number' ? value : parseFloat(String(value));
      if (isNaN(num)) return { kind: 'text', text: String(value) };
      // If the value is already 0-100, display as-is. If 0-1, multiply by 100.
      const pct = Math.abs(num) <= 1 ? num * 100 : num;
      return {
        kind: 'dot',
        text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
        color: pct >= 0 ? 'var(--moss)' : 'var(--clay)',
        sort: pct,
      };
    }
    case 'score': {
      const num = typeof value === 'number' ? value : parseFloat(String(value));
      if (isNaN(num)) return { kind: 'text', text: String(value) };
      const clamped = Math.max(0, Math.min(10, num));
      const color = clamped >= 7 ? 'var(--moss)' : clamped >= 4 ? 'var(--accent)' : 'var(--clay)';
      return { kind: 'dot', text: num.toFixed(1), color, sort: num };
    }
    case 'url': {
      const str = String(value);
      if (!str.startsWith('http')) return { kind: 'text', text: str, sort: str };
      let display: string;
      try {
        display = new URL(str).hostname.replace(/^www\./, '');
      } catch {
        display = str.slice(0, 30);
      }
      return { kind: 'link', text: display, href: str, sort: display };
    }
    default: {
      const str = String(value);
      return { kind: 'text', text: str, sort: str };
    }
  }
}

/**
 * Comparison table — title + table + collapsed sources + Apply/Dismiss footer.
 * Founder directive (2026-06-11): the comparison persists as a PROPOSAL
 * (graph_nodes, reviewed_state='pending'); applying it (0.5 credits) folds it
 * into project intelligence.
 */
export default function ComparisonTable({ artifact, onAction, defaultCollapsed }: ComparisonTableProps) {
  const t = useT();
  const colTypes = artifact.column_types;
  const rejected = artifact.reviewed_state === 'rejected';

  // Column keys are positional, not the header text: two columns can legitimately
  // carry the same label ("2024" / "2024") and RecordsTable keys cells by column key.
  const columns: RecordColumn[] = [
    { key: '__label', label: t('ui.comparison.identity-column'), width: '160px' },
    ...artifact.columns.map((col, idx) => ({
      key: `c${idx}`,
      label: col,
      sortable: true,
    })),
  ];

  const rows: RecordRow[] = artifact.rows.map((row, rIdx) => ({
    id: `r${rIdx}`,
    label: row.label,
    cells: Object.fromEntries(
      row.values.map((value, idx) => [`c${idx}`, formatCell(value, colTypes?.[idx])]),
    ),
  }));

  return (
    <ArtifactCardShell
      typeLabel={t('card.type-comparison')}
      title={artifact.title || t('card.type-comparison')}
      sources={artifact.sources}
      provenance={artifact.provenance}
      exportArtifact={artifact}
      dimmed={rejected}
      defaultCollapsed={defaultCollapsed}
      className="overflow-x-auto"
      footer={
        <KnowledgeApplyControls
          artifactId={artifact.id}
          persistedId={artifact.persisted_id}
          state={artifact.reviewed_state}
          type="graph_node"
          onAction={onAction}
        />
      }
    >
      {/* selectable={false}: RecordsTable can select rows, but nothing here
          consumes a selection — Apply/Dismiss acts on the whole proposal — and a
          checkbox that does nothing is a lie about what the founder can do. */}
      <RecordsTable columns={columns} rows={rows} selectable={false} />
    </ArtifactCardShell>
  );
}

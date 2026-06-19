'use client';

import type { ComparisonTable as ComparisonTableType, ColumnType } from '@/types/artifacts';
import ArtifactCardShell from './ArtifactCardShell';
import KnowledgeApplyControls from './SavedHint';

interface ComparisonTableProps {
  artifact: ComparisonTableType;
  onAction?: (action: string, payload: Record<string, unknown>) => void | Promise<void>;
  /** Mount collapsed (older-turn artifacts on the canvas). */
  defaultCollapsed?: boolean;
}

/**
 * Format a cell value according to its column type.
 * Falls back to plain string rendering for unknown types or when
 * column_types is absent (backward compatibility).
 */
function formatCell(value: string | number, colType: ColumnType | undefined): React.ReactNode {
  const type = colType ?? 'text';

  switch (type) {
    case 'currency': {
      const num = typeof value === 'number' ? value : parseFloat(String(value));
      if (isNaN(num)) return String(value);
      if (Math.abs(num) >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(1)}B`;
      if (Math.abs(num) >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
      if (Math.abs(num) >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
      return `$${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    }
    case 'percentage': {
      const num = typeof value === 'number' ? value : parseFloat(String(value));
      if (isNaN(num)) return String(value);
      // If the value is already 0-100, display as-is. If 0-1, multiply by 100.
      const pct = Math.abs(num) <= 1 ? num * 100 : num;
      return (
        <span className={pct >= 0 ? 'text-moss' : 'text-clay'}>
          {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
        </span>
      );
    }
    case 'score': {
      const num = typeof value === 'number' ? value : parseFloat(String(value));
      if (isNaN(num)) return String(value);
      const clamped = Math.max(0, Math.min(10, num));
      const pctVal = (clamped / 10) * 100;
      const color = clamped >= 7 ? 'bg-moss' : clamped >= 4 ? 'bg-accent' : 'bg-clay';
      return (
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-paper-3 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${pctVal}%` }} />
          </div>
          <span className="text-xs font-mono">{num.toFixed(1)}</span>
        </div>
      );
    }
    case 'url': {
      const str = String(value);
      if (!str.startsWith('http')) return str;
      let display: string;
      try {
        display = new URL(str).hostname.replace(/^www\./, '');
      } catch {
        display = str.slice(0, 30);
      }
      return (
        <a
          href={str}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky hover:text-sky/80 underline underline-offset-2"
        >
          {display}
        </a>
      );
    }
    default:
      return String(value);
  }
}

/**
 * Comparison table — title + table + collapsed sources + Apply/Dismiss footer.
 * Founder directive (2026-06-11): the comparison persists as a PROPOSAL
 * (graph_nodes, reviewed_state='pending'); applying it (0.5 credits) folds it
 * into project intelligence.
 */
export default function ComparisonTable({ artifact, onAction, defaultCollapsed }: ComparisonTableProps) {
  const colTypes = artifact.column_types;
  const rejected = artifact.reviewed_state === 'rejected';

  return (
    <ArtifactCardShell
      typeLabel="Comparison"
      title={artifact.title || 'Comparison'}
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
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-paper-2">
            <th className="text-left px-3 py-2 text-ink-4 font-medium border border-line-2 rounded-tl-md">
              &nbsp;
            </th>
            {artifact.columns.map((col) => (
              <th
                key={col}
                className="text-left px-3 py-2 text-ink-4 font-medium border border-line-2"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {artifact.rows.map((row) => (
            <tr key={row.label} className="bg-paper hover:bg-paper-2/60 transition-colors">
              <td className="px-3 py-2 text-ink-2 font-medium border border-line-2">
                {row.label}
              </td>
              {row.values.map((value, idx) => (
                <td
                  key={`${row.label}-${artifact.columns[idx]}`}
                  className="px-3 py-2 text-ink-3 border border-line-2"
                >
                  {formatCell(value, colTypes?.[idx])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ArtifactCardShell>
  );
}

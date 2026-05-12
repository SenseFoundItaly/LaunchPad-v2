'use client';

import { useState } from 'react';
import type { ComparisonTable as ComparisonTableType, ColumnType, ReviewedState } from '@/types/artifacts';
import { usePersistedArtifact } from '@/hooks/usePersistedArtifact';
import SourcesFooter from './SourcesFooter';

interface ComparisonTableProps {
  artifact: ComparisonTableType;
  onAction?: (action: string, payload: Record<string, unknown>) => void;
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
        <span className={pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
          {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
        </span>
      );
    }
    case 'score': {
      const num = typeof value === 'number' ? value : parseFloat(String(value));
      if (isNaN(num)) return String(value);
      const clamped = Math.max(0, Math.min(10, num));
      const pct = (clamped / 10) * 100;
      const color = clamped >= 7 ? 'bg-emerald-500' : clamped >= 4 ? 'bg-amber-500' : 'bg-red-500';
      return (
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
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
          className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
        >
          {display}
        </a>
      );
    }
    default:
      return String(value);
  }
}

export default function ComparisonTable({ artifact, onAction }: ComparisonTableProps) {
  const colTypes = artifact.column_types;
  const hasReviewId = Boolean(artifact.review_id);
  const persisted = usePersistedArtifact(artifact.id, {
    persisted_id: artifact.persisted_id,
    reviewed_state: artifact.reviewed_state,
  });
  const [reviewState, setReviewState] = useState<ReviewedState>(
    artifact.reviewed_state ?? (hasReviewId ? 'pending' : 'approved'),
  );

  const persistedId = persisted?.persisted_id ?? artifact.persisted_id;

  function handleReview(state: 'approved' | 'rejected') {
    setReviewState(state);
    onAction?.('knowledge:approve', {
      item_id: artifact.review_id ?? persistedId ?? artifact.id,
      type: 'tabular_review',
      state,
    });
  }

  const isRejected = reviewState === 'rejected';
  const isPending = reviewState === 'pending';
  const isApproved = reviewState === 'approved';

  return (
    <div className={`my-3 overflow-x-auto transition-opacity ${isRejected ? 'opacity-40' : ''}`}>
      {artifact.title && (
        <h4 className="text-sm font-semibold text-zinc-100 mb-2">{artifact.title}</h4>
      )}
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-zinc-800">
            <th className="text-left px-3 py-2 text-zinc-400 font-medium border border-zinc-700 rounded-tl-md">
              &nbsp;
            </th>
            {artifact.columns.map((col) => (
              <th
                key={col}
                className="text-left px-3 py-2 text-zinc-400 font-medium border border-zinc-700"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {artifact.rows.map((row) => (
            <tr key={row.label} className="bg-zinc-900 hover:bg-zinc-800/60 transition-colors">
              <td className="px-3 py-2 text-zinc-200 font-medium border border-zinc-700">
                {row.label}
              </td>
              {row.values.map((value, idx) => (
                <td
                  key={`${row.label}-${artifact.columns[idx]}`}
                  className="px-3 py-2 text-zinc-300 border border-zinc-700"
                >
                  {formatCell(value, colTypes?.[idx])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <SourcesFooter sources={artifact.sources} />

      {/* Approve/reject footer for tabular reviews */}
      {hasReviewId && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-zinc-700/50">
          {isApproved && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Approved
            </span>
          )}
          {isRejected && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              Rejected
            </span>
          )}
          {isPending && (
            <>
              <button
                onClick={() => handleReview('approved')}
                className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors font-medium"
              >
                Approve
              </button>
              <button
                onClick={() => handleReview('rejected')}
                className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-700/50 text-zinc-500 hover:text-red-400 hover:bg-red-500/20 transition-colors font-medium"
              >
                Reject
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

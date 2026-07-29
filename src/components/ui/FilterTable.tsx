'use client';

import { useState, type CSSProperties } from 'react';
import { useT } from '@/components/providers/LocaleProvider';

/**
 * Filter table — status chips that filter the rows beneath them, with rows
 * collapsing/expanding rather than popping out of existence.
 *
 * Ported from the Beautiful UI "Filter Table" primitive. Deliberate changes:
 *
 *  1. De-hardcoded. The demo's five ice-cream tasks, its fixed
 *     Task/Date/Status/Advisor columns and — importantly — its hand-written
 *     chip COUNTS (`count: 2`, `count: 5`) are gone. Counts are now derived
 *     from the rows actually passed in, so a chip can never claim a number the
 *     table doesn't contain.
 *  2. The status pill palette came from a `filter-status-*` stylesheet that
 *     didn't ship. Pills are now driven by a `tone` on each filter option and
 *     resolved to SenseFound wash/ink pairs here.
 *  3. The filter selection itself is real interaction and is kept, including
 *     the grid-rows collapse transition. The `all` chip is synthesised from the
 *     row set rather than being one more hardcoded entry.
 */

export type FilterTone = 'moss' | 'clay' | 'cat-gold' | 'sky' | 'plum' | 'neutral';

export interface FilterOption {
  /** Matches `FilterRow.status`. */
  key: string;
  /** Chip + pill text. Caller-owned copy — translate it before passing it in. */
  label: string;
  /** Chip dot colour — a CSS colour or `var(--cat-teal)`. */
  dot?: string;
  /** Status-pill colouring. Default 'neutral'. */
  tone?: FilterTone;
}

export interface FilterColumn {
  key: string;
  /** Header text. Caller-owned copy. */
  label: string;
  /** CSS grid track, e.g. '1.3fr' or '90px'. Default '1fr'. */
  width?: string;
  /** Render this column's cell as the status pill instead of plain text. */
  status?: boolean;
}

export interface FilterRow {
  id: string;
  /** Key of the FilterOption this row belongs to. */
  status: string;
  /** Cell text by column key. The status column reads its label from the option. */
  cells: Record<string, string>;
}

interface Props {
  columns: FilterColumn[];
  rows: FilterRow[];
  options: FilterOption[];
  /** Notified when the founder changes the chip. */
  onFilterChange?: (key: string) => void;
  /** Minimum table width before horizontal scroll kicks in. Default 420. */
  minWidth?: number;
}

const TONE: Record<FilterTone, string> = {
  moss: 'bg-moss-wash text-moss',
  clay: 'bg-clay-wash text-clay',
  'cat-gold': 'bg-cat-gold-wash text-cat-gold',
  sky: 'bg-sky-wash text-sky',
  plum: 'bg-plum-wash text-plum',
  neutral: 'bg-paper-2 text-ink-2',
};

const ALL = '__all__';

export function FilterTable({ columns, rows, options, onFilterChange, minWidth = 420 }: Props) {
  const t = useT();
  const [filter, setFilter] = useState<string>(ALL);

  const grid: CSSProperties = {
    gridTemplateColumns: columns.map((c) => c.width ?? '1fr').join(' '),
  };

  const chips = [
    { key: ALL, label: t('ui.filter.all'), dot: undefined as string | undefined, count: rows.length },
    ...options.map((o) => ({
      key: o.key,
      label: o.label,
      dot: o.dot,
      count: rows.filter((r) => r.status === o.key).length,
    })),
  ];

  const pick = (key: string) => {
    setFilter(key);
    onFilterChange?.(key);
  };

  return (
    <div className="w-full max-w-105">
      {/* filter chips */}
      <div
        className="-mx-1 mb-1 flex items-center gap-1 overflow-x-auto px-1 py-1"
        style={{ scrollbarWidth: 'none' }}
      >
        {chips.map((c) => {
          const active = filter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={active}
              onClick={() => pick(c.key)}
              className={`flex h-6.5 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-[background-color,box-shadow,color] duration-200 ${
                active ? 'bg-surface text-ink' : 'text-ink-2 hover:bg-paper-2'
              }`}
              style={active ? { boxShadow: 'var(--shadow-card)' } : undefined}
            >
              {c.dot && <span className="size-1.5 rounded-full" style={{ background: c.dot }} />}
              {c.label}
              <span
                className={`rounded-[4px] px-1 text-[10.5px] tabular-nums ${
                  active ? 'bg-paper-2 text-ink-2' : 'text-ink-3'
                }`}
              >
                {c.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* table */}
      <div
        aria-label={t('ui.filter.table-label')}
        className="overflow-x-auto rounded-[var(--r-l)] bg-surface"
        role="region"
        tabIndex={0}
        style={{ scrollbarWidth: 'none', boxShadow: 'var(--shadow-card)' }}
      >
        <div style={{ minWidth }}>
          <div
            className="grid border-b border-line px-3 py-2 text-[11.5px] font-medium text-ink-3"
            style={grid}
          >
            {columns.map((c) => (
              <span key={c.key}>{c.label}</span>
            ))}
          </div>

          {rows.map((row) => {
            const shown = filter === ALL || row.status === filter;
            const option = options.find((o) => o.key === row.status);
            return (
              <div
                key={row.id}
                aria-hidden={!shown}
                className="grid transition-[grid-template-rows,opacity] duration-300"
                style={{
                  gridTemplateRows: shown ? '1fr' : '0fr',
                  opacity: shown ? 1 : 0,
                  transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
                }}
              >
                <div className="overflow-hidden">
                  <div
                    className="grid items-center border-b border-line px-3 py-2 text-[12px] transition-colors duration-100 last:border-0 hover:bg-paper-2"
                    style={grid}
                  >
                    {columns.map((c, ci) => {
                      if (c.status) {
                        return (
                          <span key={c.key}>
                            <span
                              className={`inline-flex h-5 items-center rounded-[5px] px-1.5 text-[11px] font-medium ${
                                TONE[option?.tone ?? 'neutral']
                              }`}
                            >
                              {option?.label ?? row.cells[c.key] ?? ''}
                            </span>
                          </span>
                        );
                      }
                      return (
                        <span
                          key={c.key}
                          className={`truncate ${ci === 0 ? 'font-medium text-ink' : 'text-ink-2 tabular-nums'}`}
                        >
                          {row.cells[c.key] ?? ''}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

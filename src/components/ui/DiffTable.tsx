'use client';

import { useT } from '@/components/providers/LocaleProvider';

/**
 * Diff table — a proposed change rendered as a table: rows that will be removed
 * are tinted clay and struck through, rows that will be added are tinted moss.
 *
 * Ported from the Beautiful UI "Diff Table" primitive and restyled onto the
 * SenseFound tokens. Two deliberate changes from the source:
 *
 *  1. The source ran a `useStage([800, 1000, 1000])` timer that faked the diff:
 *     the table sat plain for 0.8s, tinted the removed rows at 1.8s, then slid
 *     an added row in at 2.8s — pure showcase choreography with no relation to
 *     any real proposal. Gone. A row's `change` is whatever the caller passes,
 *     rendered immediately; added rows still get a `lp-rise` entrance so they
 *     read as new when the caller swaps them in.
 *  2. The ice-cream fixture and its fixed Flavor/Category/Supplier columns are
 *     replaced by `columns` + `rows` props. Column `kind` drives the cell
 *     treatment (leading strong cell / dotted chip / plain text), so the diff
 *     styling survives whatever columns the caller needs.
 *
 * This renders a PROPOSAL. It commits nothing — the accept/reject affordance
 * belongs to the caller, per the validation-gate invariant.
 */

export type DiffChange = 'added' | 'removed' | 'unchanged';

export interface DiffColumn {
  key: string;
  /** Header text. Caller-owned copy — translate it before passing it in. */
  label: string;
  /** strong = leading emphasised cell · chip = dot + pill · text = plain. */
  kind?: 'strong' | 'chip' | 'text';
  /** CSS column width, e.g. '34%'. Defaults to an even share. */
  width?: string;
}

export interface DiffRow {
  id: string;
  /** Defaults to 'unchanged'. */
  change?: DiffChange;
  /** Cell text by column key. */
  cells: Record<string, string>;
  /** Dot colour for `chip` cells — a CSS colour or `var(--cat-teal)`. */
  dotColor?: string;
}

interface Props {
  columns: DiffColumn[];
  rows: DiffRow[];
  /** Optional header bar caption. Caller-owned copy. */
  title?: string;
}

export function DiffTable({ columns, rows, title }: Props) {
  const t = useT();

  return (
    <div className="w-full max-w-95">
      <div
        className="relative overflow-hidden rounded-[var(--r-l)] bg-surface"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[12.5px] font-medium text-ink">{title}</span>
          </div>
        )}

        <table className="w-full table-fixed border-collapse text-left" aria-label={title ?? t('ui.diff.table-label')}>
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-line">
              {columns.map((c) => (
                <th key={c.key} className="px-3 py-2 text-[12px] font-medium text-ink-3">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const change = row.change ?? 'unchanged';
              const out = change === 'removed';
              const added = change === 'added';

              return (
                <tr
                  key={row.id}
                  className={`border-b border-line transition-colors duration-400 last:border-0 hover:bg-paper-2${
                    added ? ' lp-rise' : ''
                  }`}
                  style={{
                    background: out
                      ? 'var(--clay-wash)'
                      : added
                        ? 'var(--moss-wash)'
                        : undefined,
                  }}
                >
                  {columns.map((c, ci) => {
                    const value = row.cells[c.key] ?? '';
                    const kind = c.kind ?? (ci === 0 ? 'strong' : 'text');

                    // The tint is the only signal that a row is going away or
                    // coming in; give a screen reader the word for it.
                    const status = ci === 0 && change !== 'unchanged' && (
                      <span className="sr-only">
                        {added ? t('ui.diff.row-added') : t('ui.diff.row-removed')}{' '}
                      </span>
                    );

                    if (kind === 'chip') {
                      return (
                        <td key={c.key} className="px-3 py-2">
                          {status}
                          <span
                            className={`inline-flex h-5.5 items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium transition-opacity duration-400 ${
                              added ? 'bg-surface' : 'bg-surface-sunk'
                            }`}
                            style={{
                              opacity: out ? 0.55 : 1,
                              boxShadow: 'inset 0 0 0 1px var(--line)',
                            }}
                          >
                            <span
                              className="size-1.5 rounded-full"
                              style={{ background: added ? 'var(--moss)' : (row.dotColor ?? 'var(--ink-3)') }}
                            />
                            <span className="text-ink-2">{value}</span>
                          </span>
                        </td>
                      );
                    }

                    if (kind === 'strong') {
                      return (
                        <td
                          key={c.key}
                          className="px-3 py-2 text-[13px] font-medium tabular-nums transition-colors duration-400"
                          style={{ color: out ? 'var(--clay)' : added ? 'var(--moss)' : 'var(--ink)' }}
                        >
                          {status}
                          {value}
                        </td>
                      );
                    }

                    return (
                      <td
                        key={c.key}
                        className="px-3 py-2 text-[12.5px] whitespace-nowrap transition-colors duration-400"
                        style={{
                          color: out ? 'var(--clay)' : added ? 'var(--moss)' : 'var(--ink-2)',
                          textDecorationLine: out ? 'line-through' : 'none',
                          textDecorationColor: 'color-mix(in srgb, var(--clay) 50%, transparent)',
                        }}
                      >
                        {status}
                        {value}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

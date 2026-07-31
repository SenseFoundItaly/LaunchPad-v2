'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useT } from '@/components/providers/LocaleProvider';

/**
 * Records table — a dense CRM-style grid: explicit grid lines, a sticky first
 * column, row selection, click-to-sort headers, tag chips, and a footer
 * calculation row.
 *
 * Ported from the Beautiful UI "Records Table" primitive. Deliberate changes:
 *
 *  1. De-hardcoded. The source shipped 26 ice-cream suppliers, a fixed
 *     STRENGTH/TAG_COLORS palette and five hardcoded columns (Company /
 *     Categories / Last interaction / Connection strength / Links). All of that
 *     is now `columns` + `rows` props; a cell declares how it renders (`text`,
 *     `tags`, `dot`, `link`) and the caller owns every colour and label.
 *  2. The source leaned on a `records-*.css` sheet that did not ship with the
 *     component. Every one of those classes is re-expressed here in Tailwind on
 *     SenseFound tokens — same geometry (sticky column, hairline grid, 5.5-unit
 *     chips), no external stylesheet.
 *  3. Selection and sorting are genuine local state and are kept. Selection is
 *     also reported upward via `onSelectionChange` so the caller can act on it;
 *     the component itself never mutates anything.
 *
 * Sorting is opt-in per column and is string/number compare on `cell.sort`
 * (falling back to the cell's text) — deliberately dumb, because the caller
 * knows whether "3 weeks ago" should sort as a date and can pass a rank.
 */

export interface RecordTag {
  label: string;
  /** CSS colour or `var(--cat-teal)`. Defaults to a neutral grey. */
  color?: string;
}

export type RecordCell =
  | { kind?: 'text'; text: string; muted?: boolean; sort?: string | number }
  | { kind: 'tags'; tags: RecordTag[]; sort?: string | number }
  | { kind: 'dot'; text: string; color?: string; sort?: string | number }
  | { kind: 'link'; text: string; href: string; sort?: string | number };

export interface RecordColumn {
  key: string;
  /** Header text. Caller-owned copy — translate it before passing it in. */
  label: string;
  /** Small leading glyph, e.g. an inline <svg>. */
  icon?: ReactNode;
  /** CSS column width. Defaults to 200px (150px for the sticky first column). */
  width?: string;
  /** Enables the click-to-sort header button. */
  sortable?: boolean;
  /** Footer calculation-row content for this column. */
  summary?: ReactNode;
}

export interface RecordRow {
  id: string;
  /** Primary label, rendered in the sticky first column. */
  label: string;
  /** Makes the primary label a link. */
  href?: string;
  /** Cells by column key. The first column is rendered from `label`/`href`. */
  cells: Record<string, RecordCell>;
}

interface Props {
  /** columns[0] is the sticky identity column; its `key` is unused for cells. */
  columns: RecordColumn[];
  rows: RecordRow[];
  /** Show the leading checkboxes. Default true. */
  selectable?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  /** Renders the footer calculation row when set (or when a column has `summary`). */
  onAddCalculation?: () => void;
  /** Scroll viewport height. Default '26rem'. */
  maxHeight?: number | string;
}

type SortState = { key: string; dir: 1 | -1 };

function Icon({ children, size = 14, strokeWidth = 1.8 }: { children: ReactNode; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function Checkbox({ checked, mixed = false, onChange, label }: { checked: boolean; mixed?: boolean; onChange: () => void; label: string }) {
  const on = checked || mixed;
  return (
    <label className="flex shrink-0 cursor-pointer items-center" title={label}>
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="sr-only" />
      <span
        className={`flex size-4 items-center justify-center rounded-[5px] transition-colors duration-150 ${
          on ? 'bg-ink text-paper' : 'text-transparent'
        }`}
        style={on ? undefined : { boxShadow: 'inset 0 0 0 1.5px var(--line-2)' }}
      >
        {mixed ? (
          <span className="h-0.5 w-2 rounded-full bg-paper" />
        ) : checked ? (
          <Icon size={12} strokeWidth={3}><path d="m5 12 4 4L19 6" /></Icon>
        ) : null}
      </span>
    </label>
  );
}

function Tag({ tag }: { tag: RecordTag }) {
  const color = tag.color ?? 'var(--ink-3)';
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-1.5 text-[11px] font-medium"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 22%, transparent)`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {tag.label}
    </span>
  );
}

/** Sort key for a cell: explicit `sort`, else its text, else its tag labels. */
function cellSortValue(cell: RecordCell | undefined): string | number {
  if (!cell) return '';
  if (cell.sort !== undefined) return cell.sort;
  if (cell.kind === 'tags') return cell.tags.map((tg) => tg.label).join(' ');
  return cell.text;
}

export function RecordsTable({
  columns,
  rows,
  selectable = true,
  onSelectionChange,
  onAddCalculation,
  maxHeight = '26rem',
}: Props) {
  const t = useT();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState | null>(null);

  const [identity, ...dataColumns] = columns;

  const visibleRows = useMemo(() => {
    if (!sort) return rows;
    const key = sort.key;
    return [...rows].sort((a, b) => {
      const av = key === identity?.key ? a.label : cellSortValue(a.cells[key]);
      const bv = key === identity?.key ? b.label : cellSortValue(b.cells[key]);
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
      return cmp * sort.dir;
    });
  }, [rows, sort, identity?.key]);

  const allSelected = visibleRows.length > 0 && visibleRows.every((row) => selected.has(row.id));
  const partiallySelected = !allSelected && visibleRows.some((row) => selected.has(row.id));

  const commit = (next: Set<string>) => {
    setSelected(next);
    onSelectionChange?.([...next]);
  };

  const toggleSort = (key: string) =>
    setSort((current) =>
      current && current.key === key ? { key, dir: (current.dir * -1) as 1 | -1 } : { key, dir: 1 },
    );

  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    commit(next);
  };

  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) visibleRows.forEach((row) => next.delete(row.id));
    else visibleRows.forEach((row) => next.add(row.id));
    commit(next);
  };

  const showFooter = Boolean(onAddCalculation) || columns.some((c) => c.summary !== undefined);
  const cellBase = 'border-b border-r border-line px-2.5 py-2 text-[12.5px] align-middle last:border-r-0';
  const headBase = 'border-b border-r border-line bg-surface px-2.5 py-2 text-[11.5px] font-medium text-ink-3 last:border-r-0';

  if (!identity) return null;

  return (
    <div
      className="w-full overflow-hidden rounded-[var(--r-l)] bg-surface"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      <div
        className="lp-scroll overflow-auto"
        style={{ maxHeight }}
        tabIndex={0}
        role="region"
        aria-label={t('ui.records.table-label')}
      >
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            {columns.map((c, i) => (
              <col key={c.key} style={{ width: c.width ?? (i === 0 ? '150px' : '200px') }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={`${headBase} sticky top-0 left-0 z-30`}>
                <div className="flex items-center gap-2">
                  {selectable && (
                    <Checkbox
                      checked={allSelected}
                      mixed={partiallySelected}
                      onChange={toggleAll}
                      label={t('ui.records.select-all')}
                    />
                  )}
                  <span className="truncate">{identity.label}</span>
                </div>
              </th>
              {dataColumns.map((c) => (
                <th key={c.key} className={`${headBase} sticky top-0 z-20`}>
                  <button
                    type="button"
                    disabled={!c.sortable}
                    aria-label={c.sortable ? t('ui.records.sort-by', { column: c.label }) : undefined}
                    onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                    className="flex w-full items-center gap-1.5 text-left transition-colors duration-100 enabled:hover:text-ink-2 disabled:cursor-default"
                  >
                    {c.icon && <span className="flex shrink-0 text-ink-3">{c.icon}</span>}
                    <span className="truncate">{c.label}</span>
                    {c.sortable && (
                      <span
                        className="flex shrink-0 transition-[opacity,transform] duration-200"
                        style={{
                          opacity: sort?.key === c.key ? 1 : 0,
                          transform: sort?.key === c.key && sort.dir === -1 ? 'rotate(180deg)' : undefined,
                        }}
                      >
                        <Icon size={12}><path d="M12 5v14M5 12l7 7 7-7" /></Icon>
                      </span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {visibleRows.map((row) => {
              const isSelected = selected.has(row.id);
              const rowBg = isSelected ? 'bg-accent-wash' : 'bg-surface';
              return (
                <tr
                  key={row.id}
                  className={`group transition-colors duration-100 ${isSelected ? 'bg-accent-wash' : 'hover:bg-paper-2'}`}
                >
                  <td className={`${cellBase} sticky left-0 z-10 ${rowBg} ${isSelected ? '' : 'group-hover:bg-paper-2'}`}>
                    <div className="flex items-center gap-2">
                      {selectable && (
                        <Checkbox
                          checked={isSelected}
                          onChange={() => toggleRow(row.id)}
                          label={t('ui.records.select-row', { name: row.label })}
                        />
                      )}
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-[var(--r-s)] bg-paper-2 text-[10.5px] font-semibold text-ink-2">
                        {row.label.slice(0, 1).toUpperCase()}
                      </span>
                      {row.href ? (
                        <a
                          href={row.href}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 truncate font-medium text-ink hover:underline"
                        >
                          {row.label}
                        </a>
                      ) : (
                        <span className="min-w-0 truncate font-medium text-ink">{row.label}</span>
                      )}
                    </div>
                  </td>

                  {dataColumns.map((c) => {
                    const cell = row.cells[c.key];
                    if (!cell) {
                      return <td key={c.key} className={`${cellBase} text-ink-3`}>—</td>;
                    }
                    if (cell.kind === 'tags') {
                      return (
                        <td key={c.key} className={cellBase}>
                          <div className="flex items-center gap-1 overflow-hidden">
                            {cell.tags.slice(0, 4).map((tg) => <Tag key={tg.label} tag={tg} />)}
                            {cell.tags.length > 4 && (
                              <span className="shrink-0 text-[11px] text-ink-3 tabular-nums">+{cell.tags.length - 4}</span>
                            )}
                          </div>
                        </td>
                      );
                    }
                    if (cell.kind === 'dot') {
                      return (
                        <td key={c.key} className={cellBase}>
                          <span className="inline-flex items-center gap-1.5 truncate text-ink-2">
                            <span className="size-1.5 shrink-0 rounded-full" style={{ background: cell.color ?? 'var(--ink-3)' }} />
                            {cell.text}
                          </span>
                        </td>
                      );
                    }
                    if (cell.kind === 'link') {
                      return (
                        <td key={c.key} className={cellBase}>
                          <a
                            href={cell.href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 truncate text-accent-ink hover:underline"
                          >
                            {cell.text}
                            <Icon size={12}><path d="M14 5h5v5M19 5l-8 8" /></Icon>
                          </a>
                        </td>
                      );
                    }
                    return (
                      <td key={c.key} className={`${cellBase} ${cell.muted ? 'text-ink-3' : 'text-ink-2'}`}>
                        <span className="block truncate">{cell.text}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>

          {showFooter && (
            <tfoot>
              <tr className="bg-paper-2 text-[11.5px] text-ink-3">
                <td className={`${cellBase} sticky bottom-0 left-0 z-10 border-b-0 bg-paper-2`}>
                  <span className="font-semibold text-ink-2 tabular-nums">{rows.length}</span>{' '}
                  {t('ui.records.count')}
                </td>
                {dataColumns.map((c, i) => (
                  <td key={c.key} className={`${cellBase} sticky bottom-0 border-b-0 bg-paper-2`}>
                    {c.summary ??
                      (i === 0 && onAddCalculation ? (
                        <button
                          type="button"
                          onClick={onAddCalculation}
                          className="inline-flex items-center gap-1 rounded-[var(--r-s)] px-1 py-0.5 text-ink-3 transition-colors duration-100 hover:bg-paper-3 hover:text-ink-2"
                        >
                          <Icon size={14}><path d="M12 5v14M5 12h14" /></Icon>
                          {t('ui.records.add-calculation')}
                        </button>
                      ) : (
                        <span className="text-ink-3">—</span>
                      ))}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

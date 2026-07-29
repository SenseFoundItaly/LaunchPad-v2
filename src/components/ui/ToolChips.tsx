'use client';

import { useState } from 'react';
import { useT } from '@/components/providers/LocaleProvider';

/**
 * Tool chips — an agent run as compact rows: each tool call is a label plus an
 * inline chip (the argument it ran with), expandable to the lines it produced,
 * followed by file-diff chips summarising the edits.
 *
 * Ported from the Beautiful UI "Tool Chips" primitive onto the SenseFound
 * tokens. Deliberate changes from the source:
 *
 *  1. The scripted reveal is GONE. The original stepped a counter every 700ms
 *     (`STEP_MS`) and sliced the row list by it, so rows dripped in and the diff
 *     chips appeared once the timer had walked past the end — a fake run, not a
 *     real one. Rows and diffs render as soon as the caller has them.
 *  2. All content (rows, chips, detail lines, diffs, counts) is props; the
 *     ice-cream fixtures are gone.
 *  3. The `min-h-[220px]` showcase floor is dropped, and the hardcoded
 *     `text-[#43464c] dark:text-ink-2` chip colour is now just `text-ink-2`.
 *
 * Expand state (the run header and each row) is genuine local UI and stays.
 */

export type ToolIcon = 'think' | 'write' | 'run' | 'read';

const ICONS: Record<ToolIcon, React.ReactNode> = {
  think: <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />,
  write: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></g>,
  run: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l6-5-6-5M12 19h8" /></g>,
  read: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></g>,
};

export interface ToolDetailLine {
  text: string;
  /** 'add' tints the line moss (an added line in a diff). */
  tone?: 'add';
}

export interface ToolChipRow {
  id: string;
  label: string;
  icon?: ToolIcon;
  /** The inline argument chip: a filename, a command, a one-line summary. */
  chip?: string;
  /** Render the chip monospace. */
  mono?: boolean;
  /** Render the expanded detail lines monospace. */
  detailMono?: boolean;
  detail?: ToolDetailLine[];
}

export interface ToolDiff {
  file: string;
  add: number;
  del: number;
}

export interface ToolChipsProps {
  rows: ToolChipRow[];
  diffs?: ToolDiff[];
  /** Header count; defaults to `rows.length`. */
  toolCount?: number;
  /** Header count of assistant messages in the run. */
  messageCount?: number;
  /** Files changed but not listed as chips — renders a "+n more" affordance. */
  moreDiffCount?: number;
  onMoreDiffs?: () => void;
  onDiffClick?: (file: string) => void;
  /** Initial expanded state of the whole run. */
  defaultOpen?: boolean;
}

export function ToolChips({
  rows,
  diffs = [],
  toolCount,
  messageCount = 0,
  moreDiffCount = 0,
  onMoreDiffs,
  onDiffClick,
  defaultOpen = true,
}: ToolChipsProps) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});

  const toggleRow = (id: string) => setOpenRows((current) => ({ ...current, [id]: !current[id] }));

  return (
    <div className="w-full max-w-80 pb-1">
      {/* collapsed run header */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-[var(--r-s)] px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-paper-3"
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className="transition-transform duration-200"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="tabular-nums">
          {t('ui.tools.summary', { tools: toolCount ?? rows.length, messages: messageCount })}
        </span>
      </button>

      {/* tool call rows */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0 }}
      >
        {/* -mx-1 + px-1.5 keeps content at the same x while giving the
            row hover pills room inside this overflow-hidden clip box */}
        <div className="-mx-1 overflow-hidden px-1.5 pb-1">
          <div className="mt-1.5 flex flex-col gap-1">
            {rows.map((row) => {
              const rowOpen = openRows[row.id] ?? false;
              const hasDetail = (row.detail?.length ?? 0) > 0;
              return (
                <div key={row.id} className="lp-rise">
                  <button
                    type="button"
                    aria-expanded={hasDetail ? rowOpen : undefined}
                    disabled={!hasDetail}
                    onClick={() => toggleRow(row.id)}
                    className="group/row -mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-[var(--r-s)] px-[3px] text-left transition-colors duration-100 enabled:hover:bg-paper-3"
                  >
                    <span className="relative flex size-4 shrink-0 items-center justify-center text-ink-3">
                      <svg
                        width="13" height="13" viewBox="0 0 24 24"
                        fill={row.icon === 'think' ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        className={`transition-opacity duration-100 ${hasDetail ? 'group-hover/row:opacity-0' : ''} ${rowOpen ? 'opacity-0' : ''}`}
                      >
                        {ICONS[row.icon ?? 'run']}
                      </svg>
                      {hasDetail && (
                        <svg
                          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                          className={`absolute transition-[opacity,transform] duration-150 group-hover/row:opacity-100 ${rowOpen ? 'opacity-100' : 'opacity-0'}`}
                          style={{ transform: rowOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      )}
                    </span>
                    <span className="shrink-0 text-[12.5px] font-medium text-ink">{row.label}</span>
                    {row.chip && (
                      <span
                        className={`inline-flex h-5.5 min-w-0 flex-1 items-center truncate rounded-full bg-paper-2 px-1.5 text-[11.5px] text-ink-2 transition-colors duration-100 ${
                          row.mono ? 'font-mono' : ''
                        }`}
                        style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}
                      >
                        {row.chip}
                      </span>
                    )}
                  </button>

                  {/* expanded detail */}
                  {hasDetail && (
                    <div
                      className="grid transition-[grid-template-rows,opacity] duration-300"
                      style={{
                        gridTemplateRows: rowOpen ? '1fr' : '0fr',
                        opacity: rowOpen ? 1 : 0,
                        transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
                      }}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div className="mt-0.5 mb-1 ml-2 flex flex-col gap-0.5 border-l border-line py-0.5 pl-3.5">
                          {row.detail!.map((line) => (
                            <span
                              key={line.text}
                              className={`truncate text-[11.5px] leading-[1.6] ${row.detailMono ? 'font-mono' : ''} ${
                                line.tone === 'add' ? 'text-moss' : 'text-ink-2'
                              }`}
                            >
                              {line.text}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* file-diff chips */}
          {diffs.length > 0 && (
            <div className="mt-2.5 flex max-w-full flex-wrap gap-1.5 border-t border-line pt-2.5">
              {diffs.map((d, i) => (
                <button
                  key={d.file}
                  type="button"
                  onClick={() => onDiffClick?.(d.file)}
                  className="lp-pop-in inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-surface px-2 font-mono text-[11.5px] text-ink transition-colors duration-100 hover:bg-paper-2"
                  style={{ boxShadow: 'var(--shadow-card)', animationDelay: `${i * 80}ms` }}
                >
                  <span className="min-w-0 truncate">{d.file}</span>
                  <span className="shrink-0 text-moss tabular-nums">+{d.add}</span>
                  {d.del > 0 && <span className="shrink-0 text-clay tabular-nums">−{d.del}</span>}
                </button>
              ))}
              {moreDiffCount > 0 && (
                <button
                  type="button"
                  onClick={onMoreDiffs}
                  className="lp-fade-in inline-flex h-7 items-center rounded-full px-1.5 font-mono text-[11.5px] text-ink-3 underline decoration-transparent underline-offset-2 transition-colors duration-100 hover:text-ink-2 hover:decoration-current"
                  style={{ animationDelay: `${diffs.length * 80}ms` }}
                >
                  {t('ui.tools.more-files', { n: moreDiffCount })}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

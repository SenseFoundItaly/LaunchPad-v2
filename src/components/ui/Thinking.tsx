'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useT } from '@/components/providers/LocaleProvider';

/**
 * Thinking — an expandable agent trace, in four shapes:
 *
 *   steps      a checklist; the last row spins while `working`
 *   reasoning  prose reasoning, one paragraph per row
 *   search     query + the sources that were read (links)
 *   coding     tool calls: file read, edit with +/− counts, command run
 *
 * Ported from the Beautiful UI "Thinking" primitive onto the SenseFound tokens.
 * Deliberate changes from the source:
 *
 *  1. The scripted `useSequence(STAGES)` timeline is GONE. The original faked a
 *     run — rows appeared at 800/600/1800/2600ms, the header flipped from
 *     "Thinking" to "Thought for 4 seconds" at a fixed tick, and the panel
 *     auto-expanded then auto-collapsed on a timer. Nothing here is time-driven:
 *     `rows` and `working` are props, so the trace reflects the real turn.
 *  2. `label` is one caller-supplied (already localised) string rather than an
 *     active/done pair baked into a fixture table.
 *  3. The showcase `min-h-[176px]` is dropped — with real content it would just
 *     leave a hole under a short trace.
 *
 * Expand/collapse stays local state: it is genuine UI, not choreography.
 * `defaultExpanded` seeds it; once the founder clicks, their choice wins.
 */

export type ThinkingVariant = 'steps' | 'reasoning' | 'search' | 'coding';

export interface ThinkingRow {
  /** Stable key. Falls back to `primary` when omitted. */
  id?: string;
  primary: string;
  /** Right-aligned qualifier: a domain, a filename, a count. */
  secondary?: string;
  /** Render `secondary` monospace (filenames, commands). */
  mono?: boolean;
  /** Lines added / removed — shown together, `coding` variant. */
  add?: number;
  del?: number;
  /** `search` variant: makes the row a link. */
  href?: string;
}

export interface ThinkingProps {
  /** Header text, already localised, e.g. "Thought for 4s" / "Searching". */
  label: string;
  rows: ThinkingRow[];
  variant?: ThinkingVariant;
  /** True while the turn is still running — shimmers the label, spins the last step. */
  working?: boolean;
  /** `search` variant: the query that produced these rows. */
  query?: string;
  /** Sources found but not listed; renders "+n more" under the trace. */
  moreCount?: number;
  /** Initial expanded state. Founder clicks override it. */
  defaultExpanded?: boolean;
  /** `coding` variant: rows become buttons that report the selected tool. */
  onSelectRow?: (row: ThinkingRow) => void;
}

/** Per-source marker in the `search` trace — colour only, no meaning. */
function Dot({ tone }: { tone: string }) {
  return (
    <span className={`flex size-3.5 shrink-0 items-center justify-center rounded-full text-white ${tone}`}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="12" cy="12" r="9" />
        <path d="M3.5 12h17M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
    </span>
  );
}

const TONES = ['bg-accent', 'bg-cat-gold', 'bg-moss'];

export function Thinking({
  label,
  rows,
  variant = 'steps',
  working = false,
  query,
  moreCount = 0,
  defaultExpanded = false,
  onSelectRow,
}: ThinkingProps) {
  const t = useT();
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const expanded = manualExpanded ?? defaultExpanded;

  // The connector rail is drawn as an absolutely-positioned hairline, so it has
  // to be measured rather than stretched — grid rows animate, `height: 100%`
  // inside a 0fr track collapses.
  const traceRef = useRef<HTMLDivElement>(null);
  const [lineHeight, setLineHeight] = useState(0);
  useLayoutEffect(() => {
    if (traceRef.current) setLineHeight(traceRef.current.offsetHeight);
  }, [rows, expanded, variant, query, moreCount]);

  return (
    <div className="flex w-full max-w-95 flex-col">
      {/* header — shared across variants */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded((current) => !(current ?? defaultExpanded))}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-[var(--r-s)] px-1.5 py-1 transition-colors duration-100 hover:bg-paper-3"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill={working ? 'var(--ink-2)' : 'var(--ink-3)'}>
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        {working ? (
          <span className="lp-shimmer-text text-[13px] font-medium whitespace-nowrap">{label}</span>
        ) : (
          <span className="lp-fade-in text-[13px] font-medium whitespace-nowrap text-ink-2">{label}</span>
        )}
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className="transition-transform duration-300"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0)' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* expandable trace */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-400"
        style={{
          gridTemplateRows: expanded ? '1fr' : '0fr',
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        <div className="overflow-hidden">
          <div className="relative mt-1 ml-[5px] pl-4">
            <span
              aria-hidden
              className="absolute left-[3px] w-px bg-line"
              style={{
                top: -8,
                height: lineHeight ? lineHeight - 2 : 0,
                transition: 'height 500ms cubic-bezier(0.23,1,0.32,1)',
              }}
            />
            <div ref={traceRef} className="flex flex-col gap-1 py-1">
              {query && (
                <div className="lp-rise flex h-6 items-center gap-2 px-1.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" className="shrink-0">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.3-4.3" />
                  </svg>
                  <span className="text-[12.5px] text-ink-2">{query}</span>
                </div>
              )}

              {rows.map((row, i) => {
                const key = row.id ?? row.primary;
                const last = i === rows.length - 1;
                const content = (
                  <>
                    {variant === 'search' && <Dot tone={TONES[i % TONES.length]} />}
                    {variant === 'steps' &&
                      (!last || !working ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      ) : (
                        <span className="lp-spin size-3 shrink-0 rounded-full border-[1.5px] border-line-2 border-t-ink-2" />
                      ))}
                    <span
                      className={`min-w-0 truncate text-[12.5px] ${
                        variant === 'reasoning'
                          ? 'whitespace-normal leading-relaxed text-ink-2'
                          : 'font-medium text-ink'
                      } ${variant === 'search' ? 'hover:underline hover:underline-offset-2' : ''}`}
                    >
                      {row.primary}
                    </span>
                    {row.secondary && (
                      <span className={`shrink-0 text-[11.5px] text-ink-3 ${row.mono ? 'font-mono' : ''}`}>
                        {row.secondary}
                      </span>
                    )}
                    {row.add !== undefined && (
                      <span className="shrink-0 font-mono text-[11px] tabular-nums">
                        <span className="text-moss">+{row.add}</span>{' '}
                        {row.del !== undefined && <span className="text-clay">−{row.del}</span>}
                      </span>
                    )}
                  </>
                );

                const rowClass = 'flex min-h-7 w-full items-center gap-2 rounded-[var(--r-m)] px-1.5 py-0.5 text-left';
                // lp-rise carries the easing/duration; the delay staggers the rows.
                const stagger = { animationDelay: `${i * 120}ms` };

                if (variant === 'search' && row.href) {
                  return (
                    <a
                      key={key}
                      href={row.href}
                      target="_blank"
                      rel="noreferrer"
                      className={`lp-rise ${rowClass} transition-colors duration-150 hover:bg-paper-2`}
                      style={stagger}
                    >
                      {content}
                    </a>
                  );
                }

                if (variant === 'coding') {
                  const selected = selectedId === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setSelectedId(selected ? null : key);
                        onSelectRow?.(row);
                      }}
                      className={`lp-rise ${rowClass} transition-colors duration-150 ${
                        selected ? 'bg-surface-sunk' : 'hover:bg-paper-2'
                      }`}
                      style={stagger}
                    >
                      {content}
                    </button>
                  );
                }

                return (
                  <div key={key} className={`lp-rise ${rowClass}`} style={stagger}>
                    {content}
                  </div>
                );
              })}

              {moreCount > 0 && (
                <span className="lp-fade-in text-[12px] text-ink-3">
                  {t('ui.thinking.more', { n: moreCount })}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useT } from '@/components/providers/LocaleProvider';

/**
 * Task rows — a list of agent tasks with status, counts, and expandable steps.
 *
 * Ported from the Beautiful UI "Task Rows" primitive, restyled onto the
 * SenseFound tokens. The significant change from the source: the original was
 * driven by a scripted timer (`TICKS`) that faked a run — row 2 flipped to
 * Failed at 3.9s and resolved at 5.3s regardless of anything real. That is
 * showcase choreography, not product behaviour, so it is gone. Status here is
 * whatever the caller passes; the component renders it and nothing else.
 *
 * `running` rows show an indeterminate ring — deliberately not a percentage,
 * since the agent loop can't report meaningful progress mid-turn.
 */

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

export interface TaskStep {
  label: string;
  /** Right-aligned detail (counts, ratios, short state). Rendered monospace. */
  meta?: string;
}

export interface TaskRow {
  id: string;
  label: string;
  /** Agent-reported state. Omit in checklist mode, where the founder owns state. */
  status?: TaskStatus;
  /** Checklist mode only — whether the founder has ticked this row off. */
  checked?: boolean;
  /** Ordinal shown inside the ring for pending/running rows (defaults to position). */
  index?: number;
  /** Secondary count, e.g. "12 suppliers". */
  amount?: string;
  /** True while a failed task is being retried — spins the retry glyph. */
  retrying?: boolean;
  steps?: TaskStep[];
}

const CheckIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
);
const XIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
);
const RetryIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg>
);

function SpinnerRing({ active, children }: { active?: boolean; children?: React.ReactNode }) {
  const size = 24, stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className={`absolute inset-0${active ? ' lp-spin' : ''}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {active && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="var(--ink-3)" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${c * 0.28} ${c * 0.72}`}
          />
        )}
      </svg>
      <span className="relative text-[10.5px] font-semibold tabular-nums text-ink">{children}</span>
    </span>
  );
}

function Badge({ tone, children }: { tone: 'moss' | 'clay'; children: React.ReactNode }) {
  return (
    <span className={`lp-pop-in flex size-5.5 shrink-0 items-center justify-center rounded-full text-white ${tone === 'clay' ? 'bg-clay' : 'bg-moss'}`}>
      {children}
    </span>
  );
}

interface Props {
  rows: TaskRow[];
  /** 'list' = one bordered card; 'cards' = separate elevated rows. */
  variant?: 'list' | 'cards';
  /**
   * Checklist mode. When supplied, the leading glyph becomes a checkbox the
   * founder can tick and clicking a row toggles it instead of expanding.
   *
   * The distinction matters: without this, a row's state is something the AGENT
   * reports and the founder reads. With it, the state is the founder's own — so
   * the component must never render an agent status that could overwrite what
   * they ticked.
   */
  onToggle?: (id: string) => void;
  /** Compact density for checklist rows nested inside another card. */
  dense?: boolean;
}

export function TaskRows({ rows, variant = 'cards', onToggle, dense = false }: Props) {
  const t = useT();
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const list = variant === 'list';
  const checklist = typeof onToggle === 'function';

  return (
    <div
      className={`flex w-full max-w-110 flex-col ${
        list ? 'gap-0 self-start overflow-hidden rounded-[var(--r-l)] bg-surface' : 'gap-2'
      }`}
      style={list ? { boxShadow: 'var(--shadow-card)' } : undefined}
    >
      {rows.map((row, i) => {
        const open = openIds[row.id] ?? false;
        const n = row.index ?? i + 1;
        const hasSteps = (row.steps?.length ?? 0) > 0;

        const badge =
          row.status === 'done' ? <Badge tone="moss">{CheckIcon}</Badge>
          : row.status === 'failed' ? <Badge tone="clay">{XIcon}</Badge>
          : <SpinnerRing active={row.status === 'running'}>{n}</SpinnerRing>;

        const pill =
          row.status === 'done' ? (
            <span className="inline-flex h-5.5 items-center rounded-full bg-moss-wash px-2 text-[11.5px] font-medium text-moss">
              {t('tasks.status-done')}
            </span>
          ) : row.status === 'failed' ? (
            <span className="inline-flex h-5.5 items-center gap-1.5 rounded-full bg-clay-wash px-2 text-[11.5px] font-medium text-clay">
              {row.retrying ? t('tasks.retrying') : t('tasks.status-failed')}
              {row.retrying && <span className="lp-spin flex">{RetryIcon}</span>}
            </span>
          ) : null;

        return (
          <div
            key={row.id}
            className={`self-stretch overflow-hidden ${
              list ? 'border-b border-line last:border-0' : 'rounded-[var(--r-l)] bg-surface'
            }`}
            style={list ? undefined : { boxShadow: 'var(--shadow-card)' }}
          >
            <button
              type="button"
              aria-expanded={!checklist && hasSteps ? open : undefined}
              aria-pressed={checklist ? Boolean(row.checked) : undefined}
              aria-label={!checklist && hasSteps ? t('tasks.expand') : undefined}
              disabled={!checklist && !hasSteps}
              onClick={() =>
                checklist
                  ? onToggle!(row.id)
                  : setOpenIds((c) => ({ ...c, [row.id]: !open }))
              }
              className={`flex w-full items-center gap-2.5 px-2.5 text-left transition-colors duration-100 enabled:hover:bg-surface-sunk ${
                dense ? 'h-8' : 'h-11'
              }`}
            >
              {checklist ? (
                <span
                  aria-hidden="true"
                  className={`flex size-4 shrink-0 items-center justify-center rounded-[5px] transition-colors duration-200 ${
                    row.checked ? 'bg-ink text-paper' : 'text-transparent'
                  }`}
                  style={row.checked ? undefined : { boxShadow: 'inset 0 0 0 1.5px var(--line-2)' }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                </span>
              ) : (
                /* The ring/badge is the only status signal; give it text so a
                   screen reader gets the state, not just the ordinal. */
                <span
                  role="status"
                  aria-label={
                    row.status === 'done' ? t('tasks.status-done')
                    : row.status === 'failed' ? (row.retrying ? t('tasks.retrying') : t('tasks.status-failed'))
                    : t('tasks.status-running')
                  }
                  className="flex size-6 shrink-0 items-center justify-center"
                >
                  {badge}
                </span>
              )}
              <span
                className={`min-w-0 flex-1 truncate font-medium ${dense ? 'text-[12px]' : 'text-[13px]'} ${
                  checklist && row.checked ? 'text-ink-4 line-through' : 'text-ink'
                }`}
              >
                {row.label}
              </span>
              {row.amount && <span className="text-[12.5px] text-ink-2 tabular-nums">{row.amount}</span>}
              {!checklist && pill}
              {!checklist && hasSteps && (
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-3">
                  <svg
                    width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                    className="transition-transform duration-300"
                    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)' }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              )}
            </button>

            {hasSteps && (
              <div
                className="grid transition-[grid-template-rows,opacity] duration-300"
                style={{
                  gridTemplateRows: open ? '1fr' : '0fr',
                  opacity: open ? 1 : 0,
                  transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
                }}
              >
                <div className="overflow-hidden">
                  <div className="mb-2.5 grid grid-cols-[24px_1fr] gap-2.5 px-2.5">
                    <span aria-hidden className="mx-auto h-full w-px bg-line" />
                    <div className="flex flex-col gap-1.5">
                      {row.steps!.map((s) => (
                        <div key={s.label} className="flex items-center justify-between gap-3">
                          <span className="text-[12px] text-ink-2">{s.label}</span>
                          {s.meta && <span className="font-mono text-[11.5px] text-ink-3 tabular-nums">{s.meta}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useT } from '@/components/providers/LocaleProvider';

/**
 * Approval card — a founder gate that asks several questions in sequence.
 *
 * Ported from the Beautiful UI "Approval Card" primitive and restyled onto the
 * SenseFound tokens. Two deliberate changes from the source:
 *
 *  1. The questions are props, not a module constant. The original shipped a
 *     hardcoded fixture because it was a showcase; here the caller owns the
 *     content and the submit handler.
 *  2. Radii come from --r-l/--r-m rather than the source's much rounder pills —
 *     10px is the house card radius, and a 22px card next to the rest of the
 *     app reads as a foreign element.
 *
 * NOTE: this renders a question flow; it does NOT itself commit anything. The
 * validation-gate invariant (nothing goes green without an explicit founder
 * action) lives in the caller's onSubmit — keep it that way.
 */

export interface ApprovalQuestion {
  /** Stable id — returned in the answer map, so callers don't index by position. */
  id: string;
  question: string;
  /** radio = pick one (auto-advances); check = pick any. */
  type: 'radio' | 'check';
  options: string[];
}

/** Per-question answer: the chosen option strings, plus any free-text entry. */
export interface ApprovalAnswer {
  selected: string[];
  custom?: string;
}

/**
 * Build the submit payload from the raw selection/custom maps.
 *
 * Pure and exported so the auto-advance path can call it with values it just
 * computed rather than with component state — that state hasn't been committed
 * yet when a final radio pick submits, and reading it would drop the answer.
 * (The source component papered over this with a 480ms setTimeout.)
 */
export function collectAnswers(
  questions: ApprovalQuestion[],
  selected: Record<string, string[]>,
  custom: Record<string, string>,
): Record<string, ApprovalAnswer> {
  const out: Record<string, ApprovalAnswer> = {};
  for (const q of questions) {
    const sel = selected[q.id] ?? [];
    const free = custom[q.id]?.trim();
    // Skip untouched questions — an empty entry reads downstream as "answered
    // with nothing" rather than "not answered".
    if (sel.length === 0 && !free) continue;
    out[q.id] = free ? { selected: sel, custom: free } : { selected: sel };
  }
  return out;
}

interface Props {
  questions: ApprovalQuestion[];
  onSubmit: (answers: Record<string, ApprovalAnswer>) => void;
  onDismiss?: () => void;
  /** Hide the reopen affordance when the parent owns dismissal. */
  dismissible?: boolean;
}

export function ApprovalCard({ questions, onSubmit, onDismiss, dismissible = true }: Props) {
  const t = useT();
  const [qi, setQi] = useState(0);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const [open, setOpen] = useState(true);

  if (questions.length === 0) return null;

  const question = questions[qi];
  const last = qi === questions.length - 1;
  const picked = selected[question.id] ?? [];
  const hasAnswer = picked.length > 0 || Boolean(custom[question.id]?.trim());

  const submit = (answers: Record<string, ApprovalAnswer>) => {
    setSent(true);
    onSubmit(answers);
  };

  const toggle = (option: string) => {
    const isRadio = question.type === 'radio';
    const next = isRadio
      ? [option]
      : picked.includes(option)
        ? picked.filter((o) => o !== option)
        : [...picked, option];

    const nextSelected = { ...selected, [question.id]: next };
    setSelected(nextSelected);

    if (!isRadio) return;
    // Picking a radio option supersedes any free text for that question.
    const nextCustom = { ...custom, [question.id]: '' };
    setCustom(nextCustom);

    // Single-choice auto-advances. On the last question this submits, using the
    // values we just computed — state hasn't committed yet at this point.
    if (!last) {
      setQi((c) => Math.min(questions.length - 1, c + 1));
      return;
    }
    submit(collectAnswers(questions, nextSelected, nextCustom));
  };

  const reset = () => {
    setQi(0);
    setSelected({});
    setCustom({});
    setSent(false);
    setOpen(true);
  };

  if (!open) {
    if (!dismissible) return null;
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[var(--r-m)] bg-surface px-3 py-2 text-[12.5px] font-medium text-ink transition-colors duration-150 hover:bg-paper-2"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        {t('approval.reopen')}
      </button>
    );
  }

  return (
    <div className="flex w-full max-w-80 flex-col items-stretch">
      <div
        className="w-full self-start overflow-hidden rounded-[var(--r-l)] bg-surface"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        {sent ? (
          <div className="flex flex-col items-center justify-center gap-2 px-3 py-7">
            <span className="lp-pop-in flex size-6 items-center justify-center rounded-full bg-moss text-white">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            </span>
            <span className="lp-rise text-[13px] font-medium text-ink">{t('approval.sent')}</span>
            <button type="button" onClick={reset} className="text-[12px] font-medium text-accent-ink hover:underline">
              {t('approval.start-over')}
            </button>
          </div>
        ) : (
          <div key={question.id} className="lp-rise px-3 pt-3 pb-2">
            <div className="flex items-start justify-between gap-3">
              <span className="text-[13px] font-medium text-ink">{question.question}</span>
              {dismissible && (
                <button
                  type="button"
                  aria-label={t('approval.dismiss')}
                  onClick={() => { setOpen(false); onDismiss?.(); }}
                  className="flex size-6 shrink-0 items-center justify-center rounded-[var(--r-s)] text-ink-3 transition-colors duration-100 hover:bg-paper-2 hover:text-ink"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              )}
            </div>

            <div className="mt-2 flex flex-col gap-0.5">
              {question.options.map((option) => {
                const on = picked.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(option)}
                    className="-mx-1.5 flex items-center gap-2 rounded-[var(--r-s)] px-1.5 py-1 text-left transition-colors duration-100 hover:bg-paper-2"
                  >
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center transition-colors duration-200 ${
                        question.type === 'radio' ? 'rounded-full' : 'rounded-[5px]'
                      } ${on ? 'bg-ink text-paper' : 'text-transparent'}`}
                      style={on ? undefined : { boxShadow: 'inset 0 0 0 1.5px var(--line-2)' }}
                    >
                      {question.type === 'radio' ? (
                        <span
                          className="size-1.5 rounded-full bg-paper transition-transform duration-200"
                          style={{ transform: on ? 'scale(1)' : 'scale(0)' }}
                        />
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                      )}
                    </span>
                    <span className={`text-[13px] transition-colors duration-200 ${on ? 'text-ink' : 'text-ink-2'}`}>
                      {option}
                    </span>
                  </button>
                );
              })}

              <label className="-mx-1.5 flex items-center gap-2 rounded-[var(--r-s)] px-1.5 py-1 transition-colors duration-100 focus-within:bg-paper-2 hover:bg-paper-2">
                <span aria-hidden="true" className="size-4 shrink-0" />
                <input
                  value={custom[question.id] ?? ''}
                  onChange={(e) => {
                    setCustom((c) => ({ ...c, [question.id]: e.target.value }));
                    // Free text supersedes a radio pick, mirroring toggle().
                    if (question.type === 'radio') setSelected((c) => ({ ...c, [question.id]: [] }));
                  }}
                  placeholder={t('approval.custom-placeholder')}
                  aria-label={t('approval.custom-answer')}
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
                />
              </label>
            </div>
          </div>
        )}

        {/* footer — pager + submit */}
        <div className="flex items-center justify-between border-t border-line px-2.5 py-2">
          <span className="flex items-center gap-2">
            <button
              type="button"
              aria-label={t('approval.previous')}
              disabled={qi === 0 || sent}
              onClick={() => setQi((c) => Math.max(0, c - 1))}
              className="flex size-6 items-center justify-center rounded-[var(--r-s)] text-ink-3 transition-colors duration-100 enabled:hover:bg-paper-2 enabled:hover:text-ink-2 disabled:opacity-35"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>

            <span className="flex items-center gap-1">
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  type="button"
                  aria-label={t('approval.goto', { n: i + 1 })}
                  aria-current={i === qi && !sent ? 'step' : undefined}
                  disabled={sent}
                  onClick={() => setQi(i)}
                  className="rounded-full transition-all duration-300 disabled:cursor-default"
                  style={
                    i === qi && !sent
                      ? { width: 9, height: 9, border: '2.5px solid var(--ink)' }
                      : sent || i < qi
                        ? { width: 7, height: 7, background: 'var(--ink-3)' }
                        : { width: 7, height: 7, border: '1.5px solid var(--ink-3)' }
                  }
                />
              ))}
            </span>

            <button
              type="button"
              aria-label={t('approval.next')}
              disabled={last || sent}
              onClick={() => setQi((c) => Math.min(questions.length - 1, c + 1))}
              className="flex size-6 items-center justify-center rounded-[var(--r-s)] text-ink-3 transition-colors duration-100 enabled:hover:bg-paper-2 enabled:hover:text-ink-2 disabled:opacity-35"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </span>

          {!sent && (
            <button
              type="button"
              aria-label={last ? t('approval.send') : t('approval.next')}
              disabled={!hasAnswer}
              onClick={() => (last ? submit(collectAnswers(questions, selected, custom)) : setQi((c) => c + 1))}
              className="flex size-7 items-center justify-center rounded-[var(--r-m)] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.96]"
              style={{
                background: hasAnswer ? 'var(--ink)' : 'var(--paper-2)',
                color: hasAnswer ? 'var(--surface)' : 'var(--ink-3)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

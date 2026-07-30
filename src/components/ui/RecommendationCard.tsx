'use client';

import { useState } from 'react';
import { useT } from '@/components/providers/LocaleProvider';

/**
 * Recommendation card — one recommended option with a signal meter, a drawer of
 * alternatives, and a confirm action.
 *
 * Ported from the Beautiful UI "Recommendation Card" primitive and restyled onto
 * the SenseFound tokens. Deliberate changes from the source:
 *
 *  1. The three ice-cream restock options were a module constant; here the
 *     caller owns `options` and the accept handler. Nothing is hardcoded.
 *  2. The source faded the body in with a raw `fade-in` keyframe string; that is
 *     now the house `lp-fade-in` class, re-keyed on the active option.
 *  3. The accent CTA used `text-white`. White on the peach accent is ~2:1 here,
 *     so it renders with `--on-accent` (charcoal) instead — same fill, readable.
 *  4. The primary button's hand-rolled rgba shadow is replaced by the house
 *     `--shadow-card`, so it can't drift from the rest of the app.
 *
 * Accepting is a founder action: the component reports it via `onAccept` and
 * only paints the local "accepted" affordance. It commits nothing itself.
 */

/** Meter/label tone. `neutral` = no signal. */
export type RecommendationTone = 'moss' | 'gold' | 'clay' | 'neutral';

const TONE_VAR: Record<RecommendationTone, string> = {
  moss: 'var(--moss)',
  gold: 'var(--cat-gold)',
  clay: 'var(--clay)',
  neutral: 'var(--ink-3)',
};

export interface RecommendationOption {
  /** Stable id — handed back to onAccept, so callers don't index by position. */
  id: string;
  /** Full recommendation text. Rich node so callers can inline code/entities. */
  body: React.ReactNode;
  /** One-line form, shown in the alternatives drawer. */
  short: string;
  /** Filled meter bars, 0–3. */
  signal: number;
  /** Confidence wording, e.g. "High confidence". Caller's copy. */
  label: string;
  /** Primary action wording for this option, e.g. "Accept". */
  cta: string;
  tone?: RecommendationTone;
  /** `accent` paints the CTA with the peach fill; `ink` is the default dark button. */
  ctaVariant?: 'accent' | 'ink';
}

function Meter({ signal, tone }: { signal: number; tone: string }) {
  return (
    <span className="flex items-end gap-0.5">
      {[0, 1, 2].map((bar) => (
        <span
          key={bar}
          className="w-1 rounded-full transition-colors duration-300"
          style={{ height: 10, background: bar < signal ? tone : 'var(--line-2)' }}
        />
      ))}
    </span>
  );
}

interface Props {
  /** Card heading. Caller's copy. */
  title: string;
  options: RecommendationOption[];
  onAccept: (option: RecommendationOption) => void;
  /** Which option starts as the recommendation (defaults to the first). */
  defaultOptionId?: string;
  /** Force the accepted state when the parent owns the truth (e.g. after a save). */
  accepted?: boolean;
}

export function RecommendationCard({ title, options, onAccept, defaultOptionId, accepted }: Props) {
  const t = useT();
  const [selectedId, setSelectedId] = useState(defaultOptionId ?? options[0]?.id);
  const [acceptedId, setAcceptedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (options.length === 0) return null;

  const active = options.find((o) => o.id === selectedId) ?? options[0];
  const others = options.filter((o) => o.id !== active.id);
  const tone = TONE_VAR[active.tone ?? 'neutral'];
  const isAccepted = accepted ?? acceptedId === active.id;

  return (
    <div
      className="w-full max-w-95 overflow-hidden rounded-[var(--r-l)] bg-surface"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      <div className="px-3 py-3">
        <span className="text-[13px] font-semibold text-ink">{title}</span>
        <p key={active.id} className="lp-fade-in mt-1.5 min-h-12 text-[13px] leading-relaxed text-ink-2">
          {active.body}
        </p>
      </div>

      {/* alternatives drawer — a distinctly new section of the card */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: open ? '1fr' : '0fr',
          opacity: open ? 1 : 0,
          transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-line bg-surface-sunk px-2 py-2">
            <p className="px-1.5 pb-1 text-[11px] font-medium text-ink-3">{t('ui.recommendation.other-options')}</p>
            {others.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setSelectedId(o.id);
                  setAcceptedId(null);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-[var(--r-s)] px-1.5 py-1.5 text-left transition-colors duration-100 hover:bg-paper-2"
              >
                <Meter signal={o.signal} tone={TONE_VAR[o.tone ?? 'neutral']} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{o.short}</span>
                <span className="shrink-0 text-[11px] text-ink-3">{o.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-sunk px-2.5 py-2">
        <span className="flex items-center gap-2">
          <Meter signal={active.signal} tone={tone} />
          <span className="text-[12.5px] font-medium text-ink-2">{active.label}</span>
        </span>

        <span className="flex items-center gap-2">
          <button
            type="button"
            aria-expanded={open}
            disabled={others.length === 0}
            onClick={() => setOpen((current) => !current)}
            className={`h-7 rounded-[var(--r-s)] px-2.5 text-[12.5px] font-medium transition-[background-color,transform] duration-100 active:scale-[0.96] disabled:opacity-40 ${
              open ? 'bg-paper-2 text-ink' : 'bg-surface text-ink enabled:hover:bg-paper-2'
            }`}
            style={{ boxShadow: 'var(--shadow-card)' }}
          >
            {t('ui.recommendation.alternatives')}
          </button>
          <button
            type="button"
            onClick={() => {
              setAcceptedId(active.id);
              onAccept(active);
            }}
            className={`h-7 rounded-[var(--r-s)] px-3 text-[12.5px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
              isAccepted
                ? 'bg-moss text-white'
                : active.ctaVariant === 'accent'
                  ? 'bg-accent text-[var(--on-accent)]'
                  : 'bg-ink text-paper'
            }`}
            style={{ boxShadow: 'var(--shadow-card)' }}
          >
            {isAccepted ? t('ui.recommendation.accepted') : active.cta}
          </button>
        </span>
      </div>
    </div>
  );
}

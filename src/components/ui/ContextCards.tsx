'use client';

import { useT } from '@/components/providers/LocaleProvider';

/**
 * Context cards — retrieved chunks with their source attribution.
 *
 * Ported from the Beautiful UI "Context Cards" primitive, restyled onto the
 * SenseFound tokens. Deliberate changes from the source:
 *
 *  1. The two ice-cream chunks were a module constant and the header count was
 *     the literal "32". Both are props now — a chunk list the caller retrieved,
 *     and a total it actually knows.
 *  2. The source chips were hidden for 700ms by a `setTimeout`, then faded in to
 *     fake retrieval latency. A source is known the moment its chunk is, so the
 *     chip renders with the card. Only the per-card mount stagger survives.
 *  3. `shadow-hairline` has no equivalent here; the count pill and the source
 *     chip use a real `border-line` hairline instead.
 *
 * The source chip is a link when the caller passes `href`, a button when it
 * passes `onOpenSource`, and inert otherwise — it never pretends to be clickable.
 */

/** Badge tint for the source type marker. */
export type ContextSourceTone = 'clay' | 'moss' | 'sky' | 'gold' | 'plum';

const TONE_BG: Record<ContextSourceTone, string> = {
  clay: 'bg-clay',
  moss: 'bg-moss',
  sky: 'bg-sky',
  gold: 'bg-cat-gold',
  plum: 'bg-plum',
};

export interface ContextSource {
  /** Filename or document title, e.g. "Dairy Onboarding SOP.pdf". */
  label: string;
  /** 2–4 character type marker, e.g. "PDF". */
  badge: string;
  tone?: ContextSourceTone;
  /** Renders the chip as a link when set. */
  href?: string;
}

export interface ContextChunk {
  id: string;
  title: string;
  /** Right-aligned size/meta, e.g. "290 characters". Rendered tabular. */
  meta?: string;
  /** The retrieved text itself. */
  body: string;
  source?: ContextSource;
}

interface Props {
  /** Section heading, e.g. "All chunks". Caller's copy. */
  heading: string;
  chunks: ContextChunk[];
  /** Total available chunks — defaults to the number rendered. */
  total?: number;
  /** When set (and the source has no href), the chip becomes a button. */
  onOpenSource?: (chunk: ContextChunk) => void;
}

const RowsIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
);
const OutIcon = (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M7 7h10v10" /></svg>
);

const CHIP_CLASS =
  'inline-flex h-6 items-center gap-1.5 rounded-full border border-line bg-surface-sunk px-2 text-[12px] font-medium text-ink-2 transition-colors duration-300';
/** Only the interactive variants get a hover tint — an inert chip shouldn't lie. */
const CHIP_INTERACTIVE = `${CHIP_CLASS} hover:bg-paper-2`;

export function ContextCards({ heading, chunks, total, onOpenSource }: Props) {
  const t = useT();

  return (
    <div className="flex w-full max-w-95 flex-col gap-2">
      <div className="lp-fade-in flex items-center gap-2 px-0.5">
        <span className="text-[13px] font-semibold text-ink">{heading}</span>
        <span className="inline-flex h-5 items-center rounded-[var(--r-m)] border border-line bg-surface-sunk px-1.5 text-[11.5px] font-medium text-ink-2 tabular-nums">
          {total ?? chunks.length}
        </span>
      </div>

      {chunks.map((chunk, i) => {
        const source = chunk.source;
        const chipBody = source ? (
          <>
            <span
              className={`flex size-3.5 items-center justify-center rounded-[4px] text-[7px] font-bold text-white ${TONE_BG[source.tone ?? 'moss']}`}
            >
              {source.badge}
            </span>
            {source.label}
            {OutIcon}
          </>
        ) : null;

        return (
          <div
            key={chunk.id}
            className="lp-rise overflow-hidden rounded-[var(--r-l)] bg-surface"
            style={{ boxShadow: 'var(--shadow-card)', animationDelay: `${i * 70}ms` }}
          >
            <div className="flex items-center gap-2.5 border-b border-line px-3 py-2">
              <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-ink">
                {RowsIcon}
                <span className="truncate">{chunk.title}</span>
              </span>
              {chunk.meta && (
                <span className="ml-auto shrink-0 text-[12px] text-ink-3 tabular-nums">{chunk.meta}</span>
              )}
            </div>
            <p className="px-3 pt-2 pb-1 text-[12.5px] leading-relaxed text-ink-2">{chunk.body}</p>
            {source && (
              <div className="px-3 pb-3">
                {source.href ? (
                  <a
                    href={source.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t('ui.context.open-source')}
                    className={CHIP_INTERACTIVE}
                  >
                    {chipBody}
                  </a>
                ) : onOpenSource ? (
                  <button
                    type="button"
                    onClick={() => onOpenSource(chunk)}
                    aria-label={t('ui.context.open-source')}
                    className={CHIP_INTERACTIVE}
                  >
                    {chipBody}
                  </button>
                ) : (
                  <span className={CHIP_CLASS}>{chipBody}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

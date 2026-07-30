'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useT } from '@/components/providers/LocaleProvider';

/**
 * Streaming text — an agent answer that resolves word by word, with inline
 * source citations, a message action row, an expandable source list, and
 * follow-up prompts.
 *
 * Ported from the Beautiful UI "Streaming Text" primitive onto the SenseFound
 * tokens. Deliberate changes from the source:
 *
 *  1. The hardcoded ice-cream paragraph is GONE, and so is the infinite loop
 *     that replayed it forever (`setCount(c => c >= TOKENS.length ? 0 : c + 1)`
 *     with a 3.4s hold). The component renders the caller's `text`.
 *  2. The typewriter is OPT-IN (`typewriter`) and animates over the `text`
 *     prop, resetting whenever that text changes. Left off — the default — every
 *     word is painted immediately, which is what you want when the parent is
 *     already streaming tokens in from the model.
 *  3. Sources, follow-ups and citations are props; the action buttons render
 *     only when the caller passes the matching handler.
 *
 * `streaming` (parent still receiving tokens) is separate from the typewriter:
 * either one keeps the caret up and holds back the actions and follow-ups,
 * because offering "retry" or a follow-up mid-answer invites a double send.
 */

export interface StreamingSource {
  id: string;
  /** Display name, e.g. the publication. */
  name: string;
  /** Shown monospace next to the name, e.g. "example.com". */
  domain: string;
  href?: string;
  /** Small square avatar. Falls back to the initial when absent. */
  iconUrl?: string;
}

/** A citation chip rendered inline, immediately after word `afterWord`. */
export interface StreamingCitation {
  afterWord: number;
  source: StreamingSource;
}

export interface StreamingFollowUp {
  id: string;
  text: string;
}

export interface StreamingTextProps {
  /** The answer. Required — this component never invents content. */
  text: string;
  /** Parent is still receiving tokens: keeps the caret, hides the action row. */
  streaming?: boolean;
  /** Animate `text` in word by word. Off by default. */
  /**
   * Render the visible text yourself — e.g. through a markdown renderer.
   *
   * Without this the component splits on whitespace and emits one span per
   * word, which silently destroys markdown: a host app whose assistant replies
   * contain headings, lists and bold would render them as literal asterisks.
   * Supplying `renderText` hands that job back to the caller.
   *
   * Trade-off: per-word citation anchoring needs the word spans, so `citations`
   * is ignored when `renderText` is set. Sources still render in the footer.
   */
  renderText?: (visibleText: string) => React.ReactNode;
  /**
   * Root classes. Defaults to the showcase width (`w-full max-w-95`); pass
   * `w-full` when the host already constrains the column, as a chat transcript
   * does — otherwise every message is clamped to 380px.
   */
  className?: string;
  typewriter?: boolean;
  /** Typewriter cadence in ms per word. */
  wordMs?: number;
  citations?: StreamingCitation[];
  sources?: StreamingSource[];
  /** Total sources consulted, when more than `sources` are listed. */
  sourceCount?: number;
  followUps?: StreamingFollowUp[];
  onFollowUp?: (id: string) => void;
  onCopy?: () => void;
  onRetry?: () => void;
  onFeedback?: (vote: 'up' | 'down') => void;
}

function SourceAvatar({ source, className }: { source: StreamingSource; className: string }) {
  if (source.iconUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- source favicons are arbitrary remote/data URLs, not app assets
    return <img src={source.iconUrl} alt="" className={className} />;
  }
  return (
    <span
      aria-hidden
      className={`flex items-center justify-center bg-paper-3 text-[8px] font-semibold text-ink-3 uppercase ${className}`}
    >
      {source.name.slice(0, 1)}
    </span>
  );
}

function CitationChip({ source }: { source: StreamingSource }) {
  const className =
    'lp-pop-in mr-1 inline-flex h-4.5 translate-y-[-1px] items-center gap-1 rounded-[var(--r-s)] bg-surface-sunk pr-1.5 pl-[3px] align-middle font-mono text-[10.5px] text-ink-2 transition-colors duration-150 hover:bg-paper-2 hover:text-ink';
  const style = { boxShadow: 'inset 0 0 0 1px var(--line)' };
  const inner = (
    <>
      <SourceAvatar source={source} className="size-3 rounded-[3px]" />
      <span>{source.domain}</span>
    </>
  );
  if (!source.href) {
    return <span className={className} style={style}>{inner}</span>;
  }
  return (
    <a href={source.href} target="_blank" rel="noreferrer" className={className} style={style}>
      {inner}
    </a>
  );
}

const COPY_ICON = (
  <g><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></g>
);
const RETRY_ICON = <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />;
const UP_ICON = (
  <path d="M7 10v12M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z" />
);
const DOWN_ICON = (
  <path d="M17 14V2M9 18.12L10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88z" />
);

function ActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded-[var(--r-m)] text-ink-3 transition-colors duration-100 hover:bg-paper-3 hover:text-ink-2"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {icon}
      </svg>
    </button>
  );
}

export function StreamingText({
  text,
  streaming = false,
  renderText,
  className = 'w-full max-w-95',
  typewriter = false,
  wordMs = 80,
  citations = [],
  sources = [],
  sourceCount,
  followUps = [],
  onFollowUp,
  onCopy,
  onRetry,
  onFeedback,
}: StreamingTextProps) {
  const t = useT();
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  const [shown, setShown] = useState(typewriter ? 0 : words.length);

  // Typewriter over the CALLER'S text: restarts whenever the text changes, then
  // stops. It never loops and never invents words the caller didn't send.
  useEffect(() => {
    if (!typewriter) {
      setShown(words.length);
      return;
    }
    setShown(0);
    if (words.length === 0) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= words.length) clearInterval(id);
    }, wordMs);
    return () => clearInterval(id);
  }, [typewriter, words, wordMs]);

  const complete = shown >= words.length;
  const busy = streaming || !complete;
  const done = !busy;

  const citeAfter = useMemo(() => {
    const map = new Map<number, StreamingSource[]>();
    for (const c of citations) {
      const list = map.get(c.afterWord) ?? [];
      list.push(c.source);
      map.set(c.afterWord, list);
    }
    return map;
  }, [citations]);

  const hasActions = Boolean(onCopy || onRetry || onFeedback) || sources.length > 0;

  return (
    <div className={className}>
      <div className="text-[13px] leading-relaxed text-ink">
        {renderText ? (
          // Caller owns rendering (markdown, MDX, whatever). Feed it only the
          // revealed prefix so an opt-in typewriter still works.
          renderText(typewriter ? words.slice(0, shown).join(' ') : text)
        ) : (
          words.slice(0, shown).map((word, i) => (
            <Fragment key={i}>
              <span className="lp-fade-in inline">{word} </span>
              {citeAfter.get(i)?.map((source) => <CitationChip key={source.id} source={source} />)}
            </Fragment>
          ))
        )}
        {busy && (
          <span className="lp-fade-in ml-0.5 inline-block h-3 w-0.5 translate-y-0.5 rounded-full bg-ink" />
        )}
      </div>

      {hasActions && (
        <div
          className="mt-2 flex items-center gap-0.5 transition-opacity duration-400"
          style={{ opacity: done ? 1 : 0, pointerEvents: done ? 'auto' : 'none' }}
        >
          {onCopy && <ActionButton label={t('ui.streaming.copy')} icon={COPY_ICON} onClick={onCopy} />}
          {onRetry && <ActionButton label={t('ui.streaming.retry')} icon={RETRY_ICON} onClick={onRetry} />}
          {onFeedback && (
            <>
              <ActionButton label={t('ui.streaming.helpful')} icon={UP_ICON} onClick={() => onFeedback('up')} />
              <ActionButton label={t('ui.streaming.not-helpful')} icon={DOWN_ICON} onClick={() => onFeedback('down')} />
            </>
          )}

          {sources.length > 0 && (
            <button
              type="button"
              aria-expanded={sourcesOpen}
              onClick={() => setSourcesOpen((current) => !current)}
              className="ml-1.5 flex items-center gap-1.5 rounded-[var(--r-m)] px-1 py-0.5 text-left transition-colors duration-150 hover:bg-paper-2"
            >
              <span className="flex -space-x-1">
                {sources.map((source) => (
                  <SourceAvatar
                    key={source.id}
                    source={source}
                    className="size-3.5 rounded-full bg-surface shadow-[0_0_0_1.5px_var(--paper)]"
                  />
                ))}
              </span>
              <span className="text-[12px] text-ink-2">
                {t('ui.streaming.sources', { n: sourceCount ?? sources.length })}
              </span>
            </button>
          )}
        </div>
      )}

      {sources.length > 0 && (
        <div
          className="grid transition-[grid-template-rows,opacity] duration-300"
          style={{
            gridTemplateRows: done && sourcesOpen ? '1fr' : '0fr',
            opacity: done && sourcesOpen ? 1 : 0,
            transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
          }}
        >
          <div className="overflow-hidden">
            <div
              className="mt-1.5 flex flex-col rounded-[var(--r-s)] bg-surface-sunk p-1"
              style={{ boxShadow: 'inset 0 0 0 1px var(--line)' }}
            >
              {sources.map((source) => (
                <a
                  key={source.id}
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-[var(--r-m)] px-1.5 py-1 text-[12px] text-ink-2 transition-colors duration-150 hover:bg-paper-2 hover:text-ink"
                >
                  <SourceAvatar source={source} className="size-4 rounded-[4px]" />
                  <span className="hover:underline hover:underline-offset-2">{source.name}</span>
                  <span className="ml-auto font-mono text-[10.5px] text-ink-3">{source.domain}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {followUps.length > 0 && (
        <div
          className="mt-2.5 transition-opacity duration-400"
          style={{ opacity: done ? 1 : 0, pointerEvents: done ? 'auto' : 'none' }}
        >
          <p className="text-[12px] font-medium text-ink-2">{t('ui.streaming.follow-ups')}</p>
          <div className="mt-0.5 flex flex-col">
            {followUps.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onFollowUp?.(item.id)}
                className={`-mx-1.5 flex items-center gap-2 rounded-[var(--r-s)] border-b border-line px-1.5 py-1.5 text-left text-[12.5px] text-ink transition-colors duration-100 last:border-0 hover:bg-paper-3 ${
                  done ? 'lp-rise' : ''
                }`}
                style={done ? { animationDelay: `${i * 90}ms` } : { opacity: 0 }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M9 10l-5 5 5 5" />
                  <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                </svg>
                {item.text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

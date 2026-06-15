'use client';

/**
 * SourcesFooter — renders the `sources` array of a factual artifact as a
 * single muted "Sources (N)" toggle, CLOSED by default (zero-chips rule:
 * a canvas card = title + content + collapsed sources line). Expanded, each
 * source is one plain-text line:
 *   N. plain-word type — title (linked when a URL/internal ref exists)
 * The old numbered colored chips with USR/INT/INF/WEB/SKL code tags were
 * founder-facing jargon and were removed in the 2026-06 canvas
 * simplification. The `[N]` index survives as a plain "N." prefix so inline
 * `[N]` prose markers still resolve.
 *
 * Used across InsightCard, EntityCard, MetricGrid, ComparisonTable, etc.
 * The component is deliberately standalone — a card passes its sources
 * prop and we take it from there. No context needed.
 */

import { useState } from 'react';
import type { Source } from '@/types/artifacts';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey, TranslateVars } from '@/lib/i18n/messages';

type TFn = (key: MessageKey, vars?: TranslateVars) => string;

interface SourcesFooterProps {
  sources: Source[] | undefined;
  /** Heading for the toggle. Defaults to "Sources". */
  label?: string;
  /** Smaller text (dense cards like risks). */
  compact?: boolean;
  /**
   * When true, the artifact's sources were repaired from the response's
   * trailing <CITATIONS> block rather than emitted per-card (Sonnet 4.6
   * quirk). Shown as a plain note inside the expanded list — this used to
   * be a header chip on the card shell.
   */
  inferredFromResponse?: boolean;
}

/** Founder-facing plain words instead of USR/INT/INF/WEB/SKL code tags. */
const TYPE_WORD_KEY: Record<Source['type'], MessageKey> = {
  web: 'art.sources.type.web',
  skill: 'art.sources.type.skill',
  internal: 'art.sources.type.internal',
  user: 'art.sources.type.user',
  inference: 'art.sources.type.inference',
};

/**
 * Build a tooltip text for a source. Includes type, quote if available,
 * and reasoning for inference sources.
 */
function tooltipFor(src: Source, t: TFn): string {
  const parts: string[] = [t('art.sources.tooltip.type', { type: src.type })];
  if (src.type === 'web') {
    parts.push(t('art.sources.tooltip.url', { url: src.url }));
    if (src.accessed_at) parts.push(t('art.sources.tooltip.accessed', { date: src.accessed_at }));
    if (src.quote) parts.push(t('art.sources.tooltip.quote', { quote: src.quote }));
  } else if (src.type === 'skill') {
    parts.push(t('art.sources.tooltip.skill', { skill: `${src.skill_id}${src.run_id ? ` (run ${src.run_id})` : ''}` }));
    if (src.quote) parts.push(t('art.sources.tooltip.output', { output: src.quote }));
  } else if (src.type === 'internal') {
    parts.push(t('art.sources.tooltip.reference', { ref: src.ref, refId: src.ref_id }));
    if (src.quote) parts.push(t('art.sources.tooltip.quote', { quote: src.quote }));
  } else if (src.type === 'user') {
    parts.push(t('art.sources.tooltip.founder-quote', { quote: src.quote }));
    if (src.chat_turn_id) parts.push(t('art.sources.tooltip.chat-turn', { turn: src.chat_turn_id }));
  } else if (src.type === 'inference') {
    parts.push(t('art.sources.tooltip.reasoning', { reasoning: src.reasoning }));
    parts.push(t('art.sources.tooltip.derived-from', { count: src.based_on.length }));
  }
  return parts.join('\n');
}

/**
 * Resolve a source to an href. Web → the URL; internal → an in-app link
 * to the appropriate view; skill/user/inference → no navigation (tooltip only).
 */
function hrefFor(src: Source): string | undefined {
  if (src.type === 'web') return src.url;
  if (src.type === 'internal') {
    switch (src.ref) {
      case 'graph_node': return `/project?ref=graph_node&id=${src.ref_id}`;
      case 'score':      return `/project?ref=score&id=${src.ref_id}`;
      case 'research':   return `/project?ref=research&id=${src.ref_id}`;
      case 'memory_fact':return `/project?ref=memory_fact&id=${src.ref_id}`;
      case 'chat_turn':  return `/project?ref=chat_turn&id=${src.ref_id}`;
      default:           return undefined;
    }
  }
  return undefined;
}

export default function SourcesFooter({
  sources,
  label,
  compact = false,
  inferredFromResponse = false,
}: SourcesFooterProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const visibleSources = Array.isArray(sources) ? sources : [];
  if (visibleSources.length === 0) return null;

  const heading = label ?? t('art.sources.label');
  const textSize = compact ? 'text-[10px]' : 'text-[11px]';

  return (
    <div className="mt-3 pt-2 border-t border-line-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${textSize} text-ink-5 hover:text-ink-3 transition-colors`}
        aria-expanded={open}
      >
        {heading} ({visibleSources.length}) {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1">
          {inferredFromResponse && (
            <span className={`${textSize} text-ink-5 italic`}>
              {t('art.sources.inferred-note')}
            </span>
          )}
          {visibleSources.map((src, idx) => {
            const href = hrefFor(src);
            const tooltip = tooltipFor(src, t);
            const line = (
              <>
                <span className="font-mono text-ink-5 shrink-0">{idx + 1}.</span>{' '}
                <span className="text-ink-5 shrink-0">{t(TYPE_WORD_KEY[src.type])}</span>
                <span className="text-ink-5"> — </span>
                <span className="text-ink-4 truncate">{src.title}</span>
              </>
            );
            return href ? (
              <a
                key={`${idx}-${src.title}`}
                href={href}
                target={src.type === 'web' ? '_blank' : undefined}
                rel={src.type === 'web' ? 'noopener noreferrer' : undefined}
                title={tooltip}
                data-source-index={idx + 1}
                className={`${textSize} flex items-baseline gap-1 hover:underline min-w-0`}
              >
                {line}
              </a>
            ) : (
              <span
                key={`${idx}-${src.title}`}
                title={tooltip}
                data-source-index={idx + 1}
                className={`${textSize} flex items-baseline gap-1 min-w-0`}
              >
                {line}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

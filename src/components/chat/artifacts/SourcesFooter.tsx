'use client';

/**
 * SourcesFooter — renders the `sources` array of a factual artifact as a
 * row of numbered chips at the bottom of the card. Each chip shows:
 *   - An `[N]` index matching inline `[N]` prose markers
 *   - A type icon (globe, skill, data, quote, sparkle-for-inference)
 *   - The source title, truncated
 *   - On click: opens the URL (web) or navigates to the internal ref
 *   - On hover: tooltip with the quote/reasoning (when present)
 *
 * Used across InsightCard, EntityCard, MetricGrid, ComparisonTable, etc.
 * The component is deliberately standalone — a card passes its sources
 * prop and we take it from there. No context needed.
 *
 * Part of Phase E of the mandatory-sources plan. See
 * src/types/artifacts.ts for the Source union.
 */

import type { Source } from '@/types/artifacts';

interface SourcesFooterProps {
  sources: Source[] | undefined;
  /** Heading to show before the chips. Defaults to "Sources" (capitalized). */
  label?: string;
  /** When true, render smaller chips (for use inside dense cards like risks). */
  compact?: boolean;
}

const TYPE_ICONS: Record<Source['type'], string> = {
  // ASCII fallback-friendly. We avoid emojis intentionally (see
  // ARTIFACT_INSTRUCTIONS: "NEVER use emojis in any text output").
  web: 'WEB',
  skill: 'SKL',
  internal: 'INT',
  user: 'USR',
  inference: 'INF',
};

const TYPE_COLORS: Record<Source['type'], string> = {
  web: 'bg-sky/15 text-sky border-sky/30',
  skill: 'bg-plum/15 text-plum border-plum/30',
  internal: 'bg-moss/15 text-moss border-moss/30',
  user: 'bg-accent/15 text-accent border-accent/30',
  inference: 'bg-ink-5/15 text-ink-3 border-ink-5/30',
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Build a tooltip text for a source. Includes type, quote if available,
 * and reasoning for inference sources (with a recursive hint about nested
 * base sources).
 */
function tooltipFor(src: Source): string {
  const parts: string[] = [`Type: ${src.type}`];
  if (src.type === 'web') {
    parts.push(`URL: ${src.url}`);
    if (src.accessed_at) parts.push(`Accessed: ${src.accessed_at}`);
    if (src.quote) parts.push(`Quote: "${src.quote}"`);
  } else if (src.type === 'skill') {
    parts.push(`Skill: ${src.skill_id}${src.run_id ? ` (run ${src.run_id})` : ''}`);
    if (src.quote) parts.push(`Output: "${src.quote}"`);
  } else if (src.type === 'internal') {
    parts.push(`Reference: ${src.ref} (${src.ref_id})`);
    if (src.quote) parts.push(`Quote: "${src.quote}"`);
  } else if (src.type === 'user') {
    parts.push(`Founder quote: "${src.quote}"`);
    if (src.chat_turn_id) parts.push(`Chat turn: ${src.chat_turn_id}`);
  } else if (src.type === 'inference') {
    parts.push(`Reasoning: ${src.reasoning}`);
    parts.push(`Derived from ${src.based_on.length} base source(s)`);
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
    // Stub routes — the in-app "jump to source" views aren't built yet for
    // all refs. Graph-node view exists; others will 404 for now. Acceptable
    // for v1 — the chip still tooltips the reference id so the founder can
    // investigate manually.
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
  label = 'Sources',
  compact = false,
}: SourcesFooterProps) {
  const visibleSources = Array.isArray(sources) ? sources : [];
  if (visibleSources.length === 0) return null;

  const chipBase = compact
    ? 'text-[10px] px-1.5 py-0.5 gap-1'
    : 'text-[11px] px-2 py-0.5 gap-1.5';

  return (
    <div className="mt-3 pt-2 border-t border-line-2">
      <div className="flex items-center flex-wrap gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-ink-5 mr-1">
          {label}
        </span>
        {visibleSources.map((src, idx) => {
          const href = hrefFor(src);
          const title = truncate(src.title, compact ? 28 : 48);
          const tooltip = tooltipFor(src);
          // Index tag — this is what prose `[N]` markers reference.
          const indexTag = `[${idx + 1}]`;
          const typeTag = TYPE_ICONS[src.type];
          const colors = TYPE_COLORS[src.type];

          const chipClasses = `inline-flex items-center rounded-full border ${colors} ${chipBase} hover:brightness-125 transition`;

          const content = (
            <>
              <span className="font-mono text-ink-5">{indexTag}</span>
              <span className="opacity-60 font-mono text-[9px]">{typeTag}</span>
              <span className="truncate max-w-[180px]">{title}</span>
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
              className={chipClasses}
            >
              {content}
            </a>
          ) : (
            <span
              key={`${idx}-${src.title}`}
              title={tooltip}
              data-source-index={idx + 1}
              className={chipClasses}
            >
              {content}
            </span>
          );
        })}
      </div>
    </div>
  );
}

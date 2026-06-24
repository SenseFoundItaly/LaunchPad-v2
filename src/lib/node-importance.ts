/**
 * Maps a knowledge node_type (or an inbox action_type) to a short "why this
 * matters / what merging it adds to the project" rationale i18n key. Used by the
 * graph NodeDetailPanel and the Intel inbox detail so the founder understands
 * WHY an item is worth applying — not just what it says.
 *
 * Pure; returns a MessageKey so callers resolve it via t() in the active locale.
 */
import type { MessageKey } from '@/lib/i18n/messages';

export function nodeImportanceKey(kind: string | null | undefined): MessageKey {
  switch (String(kind || '').toLowerCase()) {
    case 'market':
    case 'market_size':
    case 'market_sizing':
    case 'market_size_fact':
      return 'knowledge.why-market';
    case 'competitor':
      return 'knowledge.why-competitor';
    case 'benchmark':
    case 'metric':
      return 'knowledge.why-benchmark';
    case 'assumption':
    case 'assumption_review':
      return 'knowledge.why-assumption';
    case 'risk':
      return 'knowledge.why-risk';
    case 'customer_segment':
    case 'segment':
      return 'knowledge.why-segment';
    case 'regulation':
    case 'regulatory':
      return 'knowledge.why-regulation';
    case 'partner':
    case 'partnership':
      return 'knowledge.why-partner';
    default:
      return 'knowledge.why-default';
  }
}

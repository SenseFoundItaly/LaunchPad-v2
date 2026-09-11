/**
 * Pure metadata for chat-artifact retrievability (gap C) — shared by the
 * server capture path (src/lib/chat-artifacts.ts) and the client Data Room
 * panel. NO db / server imports here: the panel is a client component.
 */
import type { Artifact } from '@/types/artifacts';

/**
 * Types NOT worth persisting as retrievable deliverables:
 *   - navigation / ephemeral proposals (surfaced live, not a deliverable)
 *   - already stored elsewhere the Data Room reads (document/html-preview →
 *     build_artifacts; fact → memory_facts; workflow-card → workflows)
 * Everything else (comparison-table, metric-grid, risk-matrix, persona-card,
 * tam-sam-som, entity-card, insight-card, charts, score-card, weekly-update,
 * investor-pipeline, idea-canvas) is a retrievable card.
 */
export const NON_RETRIEVABLE_TYPES = new Set<string>([
  'option-set', 'skill-suggestion', 'knowledge-suggestion', 'monitor-proposal',
  'budget-proposal', 'validation-proposal', 'action-suggestion', 'solve-progress',
  'score-badge', 'sensitivity-slider', 'document', 'html-preview', 'fact',
  'workflow-card', 'task', // task → pending_actions/Inbox, not a Data Room deliverable
]);

export function isRetrievableArtifact(type: string): boolean {
  return !NON_RETRIEVABLE_TYPES.has(type);
}

/** Friendly fallback titles when an artifact carries no `title`. */
export const TYPE_LABELS: Record<string, string> = {
  'comparison-table': 'Comparison', 'metric-grid': 'Metrics', 'risk-matrix': 'Risk matrix',
  'persona-card': 'Persona', 'tam-sam-som': 'Market sizing (TAM/SAM/SOM)', 'entity-card': 'Entity',
  'insight-card': 'Insight', 'bar-chart': 'Chart', 'pie-chart': 'Chart', 'gauge-chart': 'Gauge',
  'radar-chart': 'Radar', 'score-card': 'Score', 'weekly-update': 'Weekly update',
  'investor-pipeline': 'Investor pipeline', 'idea-canvas': 'Idea Canvas',
};

export function deriveTitle(artifact: Artifact): string {
  const t = (artifact as unknown as { title?: unknown }).title;
  if (typeof t === 'string' && t.trim()) return t.trim().slice(0, 200);
  return TYPE_LABELS[artifact.type] ?? artifact.type;
}

/**
 * True when a stored title is just the generic per-type fallback (the card
 * carried no real title). Generic-titled cards must NOT version-group: two
 * DIFFERENT untitled comparisons would otherwise false-merge under
 * "Comparison". Case-insensitive; also treats the bare type id as generic.
 */
export function isGenericTitle(kind: string, title: string | null | undefined): boolean {
  if (!title || !title.trim()) return true;
  const t = title.trim().toLowerCase();
  return t === (TYPE_LABELS[kind] ?? '').toLowerCase() || t === kind.toLowerCase();
}

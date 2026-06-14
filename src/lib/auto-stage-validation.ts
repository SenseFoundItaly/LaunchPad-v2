/**
 * Deterministic validation capture from evidence artifacts.
 *
 * The chat agent reliably EMITS evidence artifacts (idea-canvas, tam-sam-som)
 * but — per the founder-sim 2026-06-14 — almost never calls `propose_validation`
 * to stage them, and those artifacts are "view-only" (persist nothing). Net: the
 * spine never advances from conversation. This closes that gap deterministically:
 * when such an artifact is persisted, we auto-stage a `validation_proposal`
 * pending_action (the SAME shape the propose_validation tool produces, consumed
 * by the applyValidationProposal executor), so the founder gets an approve-to-
 * green card in the Inbox WITHOUT relying on the model to call the tool.
 *
 * Gate-respecting: this only PROPOSES (pending) — nothing greens without the
 * founder's approval. Item shape mirrors stageValidationProposal in
 * project-tools.ts (kept in sync via the shared validation-targets mapping).
 */

import { query } from '@/lib/db';
import { createPendingAction } from '@/lib/pending-actions';
import { validationTargetsFor, validationLabel, type ValidationItemKind } from '@/lib/journey/validation-targets';
import { KNOWLEDGE_APPLY_CREDITS } from '@/lib/credits';
import type { Artifact, IdeaCanvasArtifact, TamSamSomArtifact, Source } from '@/types/artifacts';

// Mirror of project-tools.ts CANVAS_FIELD_LABELS / itemDisplayLabel / itemCredits.
const CANVAS_FIELD_LABELS: Record<string, string> = {
  problem: 'Problem', solution: 'Solution', target_market: 'Target market',
  value_proposition: 'Value proposition', business_model: 'Business model',
  competitive_advantage: 'Competitive edge',
};
const CANVAS_FIELDS = ['problem', 'solution', 'target_market', 'value_proposition', 'competitive_advantage', 'business_model'] as const;

interface RawItem { kind: ValidationItemKind; field?: string; name?: string; value: string; sources?: Source[]; }

function buildItems(raw: RawItem[]) {
  return raw
    .map((r) => ({ ...r, value: (r.value ?? '').trim().slice(0, 1600) }))
    .filter((r) => r.value.length > 0)
    .map((r, i) => {
      const targets = validationTargetsFor(r.kind, r.field);
      return {
        id: `item_${i}`,
        kind: r.kind,
        field: r.field,
        name: r.name,
        label: r.kind === 'canvas_field' ? (CANVAS_FIELD_LABELS[r.field ?? ''] ?? 'Idea Canvas') : r.kind === 'competitor' ? 'Competitor' : 'Market size',
        value: r.value,
        validates: validationLabel(targets),
        targets,
        credits: r.kind === 'canvas_field' ? 0 : KNOWLEDGE_APPLY_CREDITS,
        sources: Array.isArray(r.sources) ? r.sources : [],
      };
    });
}

/** Map a supported evidence artifact to raw validation items. Returns [] for
 *  artifact types we don't auto-capture (competitors already persist pending
 *  via persistComparisonTable; everything else is genuinely view-only). */
function rawItemsFor(artifact: Artifact): RawItem[] {
  if (artifact.type === 'idea-canvas') {
    const a = artifact as IdeaCanvasArtifact;
    const items: RawItem[] = [];
    for (const f of CANVAS_FIELDS) {
      const v = (a as unknown as Record<string, unknown>)[f];
      if (typeof v === 'string' && v.trim()) items.push({ kind: 'canvas_field', field: f, value: v, sources: a.sources });
    }
    return items;
  }
  if (artifact.type === 'tam-sam-som') {
    const a = artifact as TamSamSomArtifact;
    const parts = [a.tam?.value && `TAM ${a.tam.value}`, a.sam?.value && `SAM ${a.sam.value}`, a.som?.value && `SOM ${a.som.value}`].filter(Boolean);
    if (parts.length === 0) return [];
    const value = `Market size — ${parts.join(' · ')}${a.timeframe ? ` (${a.timeframe})` : ''}`;
    return [{ kind: 'market_size_fact', value, sources: a.sources }];
  }
  return [];
}

/**
 * Auto-stage a validation_proposal from an evidence artifact. Deduped: at most
 * ONE open auto-staged proposal per project at a time (avoids one-card-per-turn
 * flood — the founder clears the open one, then the next artifact can stage).
 * Returns {staged:false} for unsupported artifacts, empty evidence, items that
 * map to no gate, or when an open proposal already exists. Never throws.
 */
export async function autoStageValidationFromArtifact(
  projectId: string,
  artifact: Artifact,
): Promise<{ staged: boolean; pendingActionId?: string; itemCount?: number }> {
  try {
    const raw = rawItemsFor(artifact);
    if (raw.length === 0) return { staged: false };

    const items = buildItems(raw).filter((it) => it.targets.length > 0);
    if (items.length === 0) return { staged: false };

    // Dedup — one open auto proposal at a time.
    const open = await query<{ id: string }>(
      "SELECT id FROM pending_actions WHERE project_id = ? AND action_type = 'validation_proposal' AND status IN ('pending','edited') LIMIT 1",
      projectId,
    ).catch(() => [] as { id: string }[]);
    if (open.length > 0) return { staged: false };

    const pa = await createPendingAction({
      project_id: projectId,
      action_type: 'validation_proposal',
      title: `Validation evidence — ${items.length} item(s) (auto-captured)`,
      rationale: `Auto-staged from ${artifact.type} artifact — founder approval gate. ${items.map((it) => it.validates ?? it.label).join('; ')}`.slice(0, 400),
      payload: { origin: 'auto', items },
      estimated_impact: 'medium',
    });
    return { staged: true, pendingActionId: pa.id, itemCount: items.length };
  } catch {
    return { staged: false };
  }
}

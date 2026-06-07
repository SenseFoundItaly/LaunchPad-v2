/**
 * Direction engine — the single source of truth for "what should the founder
 * do next?".
 *
 * Iteration-2 / WS-B. Direction was already COMPUTED deterministically
 * (`getStageReadiness().next_recommended_skill`, `activeStage()`), but only
 * reachable by the chat via a tool the model might forget to call — so
 * proactivity was left to the LLM re-deriving it each turn ("feels passive").
 *
 * This module CONSOLIDATES those existing primitives into one struct and is
 * INJECTED into every chat turn (WS-A) and the /today StageCard (WS2-UI,
 * deferred). It invents no scoring — it reads what the journey + readiness
 * layers already produce.
 */

import { query } from '@/lib/db';
import { buildProjectSnapshot, evaluateAllStages, activeStage } from '@/lib/journey';
import type { ProjectSnapshot } from '@/lib/journey/types';
import { getStageReadiness } from '@/lib/stage-readiness';

export interface FreshSignal {
  headline: string;
  created_at: string;
}

export interface NextBestAction {
  /** True for n=0 projects (no idea captured). The opener must branch on this
   *  instead of firing "you're at Stage N, gap X" on an empty project. */
  cold_start: boolean;
  stage_number: number;
  stage_label: string;
  /** passed / total checks on the active stage. */
  progress: { passed: number; total: number };
  /** Founder-facing label of the first unmet check on the active stage. */
  top_gap: string | null;
  /** Where that gap's evidence lives (e.g. "interviews", "competitor_profiles"). */
  top_gap_source: string | null;
  /** The skill the founder should run next, from getStageReadiness(). */
  recommended_skill: { id: string; label: string; kickoff: string; stage_number: number } | null;
  /** Short CTA string the prompt + UI render verbatim. */
  action: string;
  /** One line explaining why this is the next move. */
  rationale: string;
  /** ecosystem_alerts newer than the last chat message — the "what changed
   *  since last time" line. Empty on first session (no prior message). */
  fresh_signals: FreshSignal[];
}

function isColdStart(idea: { problem: string | null; solution: string | null } | null): boolean {
  if (!idea) return true;
  const has = (s: string | null) => !!s && s.trim().length > 0;
  return !has(idea.problem) && !has(idea.solution);
}

/**
 * Fetch ecosystem_alerts created after `since` — the proof-of-life "what
 * changed" feed. Mirrors the freshness definition the chat opener uses
 * (route.ts:143: alerts whose created_at is newer than the last chat message).
 * Returns [] when `since` is null (first session — nothing to compare against).
 */
async function freshSignals(projectId: string, since: string | Date | null | undefined): Promise<FreshSignal[]> {
  if (!since) return [];
  try {
    const rows = await query<{ headline: string; created_at: string }>(
      `SELECT headline, created_at FROM ecosystem_alerts
        WHERE project_id = ? AND created_at > ?
        ORDER BY created_at DESC LIMIT 5`,
      projectId,
      since instanceof Date ? since.toISOString() : since,
    );
    return rows.map((r) => ({ headline: r.headline, created_at: String(r.created_at) }));
  } catch {
    // ecosystem_alerts may be absent on a stale DB — degrade to no signals
    // rather than failing the whole opener.
    return [];
  }
}

export interface ComputeOpts {
  /** Timestamp of the founder's previous chat message — drives fresh_signals. */
  lastChatAt?: string | Date | null;
  /** Pre-built snapshot to reuse. The chat route already builds one per turn
   *  for stage context; passing it here avoids a second 16-query snapshot. */
  snapshot?: ProjectSnapshot;
}

export async function computeNextBestAction(projectId: string, opts: ComputeOpts = {}): Promise<NextBestAction> {
  const snapshot = opts.snapshot ?? await buildProjectSnapshot(projectId);
  const evaluations = evaluateAllStages(snapshot);
  const active = activeStage(evaluations);
  const readiness = await getStageReadiness(projectId);
  const fresh = await freshSignals(projectId, opts.lastChatAt);

  const cold_start = isColdStart(snapshot.idea_canvas);

  const firstGap = active.results.find((r) => !r.result.passed);
  const top_gap = firstGap?.check.label ?? null;
  const top_gap_source = firstGap?.check.source ?? null;

  const rec = readiness.next_recommended_skill;
  const recommended_skill = rec
    ? { id: rec.id, label: rec.label, kickoff: rec.kickoff, stage_number: rec.stage_number }
    : null;

  let action: string;
  let rationale: string;
  if (cold_start) {
    action = 'Tell me about your idea so I can structure it into a canvas';
    rationale = 'New project — no idea captured yet. Start at Spark.';
  } else if (recommended_skill) {
    action = recommended_skill.kickoff;
    rationale = `Stage ${active.stage.number} (${active.stage.label}) — ${active.passed}/${active.total} checks passed`
      + (top_gap ? `; next gap: ${top_gap}.` : '.');
  } else if (top_gap) {
    action = `Close the gap: ${top_gap}`;
    rationale = `Stage ${active.stage.number} (${active.stage.label}) — ${active.passed}/${active.total} checks passed; next gap: ${top_gap}.`;
  } else {
    action = 'Every stage is GO — keep the loops compounding';
    rationale = 'All stages clear. Focus shifts from validation to growth.';
  }

  return {
    cold_start,
    stage_number: active.stage.number,
    stage_label: active.stage.label,
    progress: { passed: active.passed, total: active.total },
    top_gap,
    top_gap_source,
    recommended_skill,
    action,
    rationale,
    fresh_signals: fresh,
  };
}

/**
 * Render the engine output as the chat opener's injected context block. WS-A
 * consumes this verbatim inside the system prompt so the model stops
 * re-deriving direction. Kept here (not in the prompt) so chat + UI share one
 * rendering.
 */
export function renderDirectionForPrompt(nba: NextBestAction): string {
  const lines: string[] = ['[DIRECTION ENGINE — your computed next move; lead with this]'];
  if (nba.cold_start) {
    lines.push('This is a brand-new project with no idea captured. Open by inviting the');
    lines.push(`founder to describe their idea. Next action: ${nba.action}`);
  } else {
    lines.push(`Active stage: ${nba.stage_number} — ${nba.stage_label} (${nba.progress.passed}/${nba.progress.total} checks passed).`);
    if (nba.top_gap) lines.push(`Top gap to close: ${nba.top_gap}${nba.top_gap_source ? ` [evidence: ${nba.top_gap_source}]` : ''}.`);
    if (nba.recommended_skill) lines.push(`Recommended next skill: ${nba.recommended_skill.label} — kickoff: "${nba.recommended_skill.kickoff}"`);
    lines.push(`Lead CTA: ${nba.action}`);
  }
  if (nba.fresh_signals.length > 0) {
    lines.push('Since the last conversation, these signals fired (open with the most relevant):');
    for (const s of nba.fresh_signals) lines.push(`  - ${s.headline}`);
  }
  return lines.join('\n');
}

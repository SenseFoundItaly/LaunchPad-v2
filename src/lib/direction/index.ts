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
import type { ProjectSnapshot, StageEvaluation } from '@/lib/journey/types';
import { getStageReadiness } from '@/lib/stage-readiness';
import { canvasRunPrereqs } from '@/lib/skill-prereqs';
import { SKILL_KICKOFFS } from '@/lib/stages';

export interface FreshSignal {
  headline: string;
  created_at: string;
}

/** Unreviewed watcher signals awaiting founder review — the "a signal is ONE
 *  thing" simplification: every watcher finding lands as a signal_alert ticket
 *  and, until the founder acts on it, gets re-surfaced in chat EVERY turn
 *  (unlike fresh_signals, which is windowed by the last chat message and
 *  silently expires). */
export interface PendingSignalsSummary {
  /** Total unreviewed ecosystem_alerts for the project. */
  total: number;
  /** Top 3 by relevance_score — the headlines the chat reminder lists. */
  top: FreshSignal[];
}

/** Adversarial-spine override emitted by `detectRiskOverrides` (iteration 3).
 *  When non-empty, the opener must surface the override as a visible artifact
 *  BEFORE advancing the founder. Iteration 3 ships only the `thin_evidence`
 *  severity; the others are scaffolded for iteration 4+ per design doc OQ.
 *
 *  See: mikececconello-launchpad-v2-project-design-20260607-222823.md WS-S. */
export interface RiskOverride {
  stage_number: number;
  severity: 'thin_evidence' | 'unresolved_assumption' | 'downstream_contradiction';
  /** Founder-facing label naming what's thin (e.g. "only 1 interview behind
   *  the Persona check; gate prefers ≥3 for real validation"). */
  gap_label: string;
  /** Short CTA the prompt + UI render verbatim as the rollback option
   *  (e.g. "Run skill_scientific_validation with 3+ interview targets"). */
  rollback_action: string;
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
  /** Unreviewed signals (reviewed_state NULL/pending) regardless of recency —
   *  surfaced every turn until the founder acts in Inbox → Signals.
   *  Degrades to { total: 0, top: [] } when the query fails. */
  pending_signals: PendingSignalsSummary;
  /** Adversarial-spine overrides. Non-empty when a completed stage looks GO
   *  on paper but evidence is thin. Iteration 3 ships only `thin_evidence`. */
  risk_overrides: RiskOverride[];
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

/**
 * Fetch the unreviewed-signal backlog: ecosystem_alerts the founder hasn't
 * acted on yet (reviewed_state NULL or 'pending'), top 3 by relevance plus a
 * total count (COUNT(*) OVER () — one query, no second round-trip). Unlike
 * freshSignals() this is NOT windowed by the last chat message: pending
 * signals stay in the chat context every turn until the founder accepts or
 * dismisses them in Inbox → Signals ("if nothing is done they are surfaced
 * in the chat as pending"). Same degradation contract as freshSignals():
 * non-fatal, returns the empty summary on any query failure.
 */
async function pendingSignals(projectId: string): Promise<PendingSignalsSummary> {
  try {
    const rows = await query<{ headline: string; created_at: string; total: string | number }>(
      `SELECT headline, created_at, COUNT(*) OVER () AS total
         FROM ecosystem_alerts
        WHERE project_id = ? AND (reviewed_state IS NULL OR reviewed_state = 'pending')
        ORDER BY relevance_score DESC
        LIMIT 3`,
      projectId,
    );
    return {
      total: rows.length > 0 ? Number(rows[0].total) || rows.length : 0,
      top: rows.map((r) => ({ headline: r.headline, created_at: String(r.created_at) })),
    };
  } catch {
    return { total: 0, top: [] };
  }
}

/**
 * Detect risk overrides — the adversarial spine. Iteration 3 ships ONLY
 * detector (a) thin_evidence; (b) unresolved_assumption and (c)
 * downstream_contradiction are deferred to iteration 4 per design doc.
 *
 * Detector (a) — thin_evidence: a stage marked `done` (all journey checks
 * passed) but the evidence behind the passing checks is sparse — e.g. one
 * interview when the founder needs 3+ for real validation. The journey layer
 * is binary (passed/not), so "thin" is heuristic on the snapshot inputs
 * each check examined.
 *
 * **Cold-start handling:** if NO stages are `done`, return [] explicitly.
 * Detector emits no overrides on incomplete projects — the direction engine's
 * existing cold-start branch handles those.
 *
 * **Iteration-3 first cut:** the detector returns [] because the per-check
 * evidence-count surface needed for accurate detection lives in each
 * stage-N module and isn't exposed on `CheckResult` yet. The shape is
 * landed; the inputs need stage-module work tracked as iteration 3.5 OQ.
 * Logging a clear TODO so an implementer can wire it in without re-reading
 * this design.
 *
 * TODO(iter-3.5): extend `CheckResult` with optional `evidence: { count: number; threshold: number }`
 * metadata so this detector can compare. Sample fire condition:
 *   for each evaluation.status === 'done':
 *     thin = evaluation.results.filter(r => r.result.evidence?.count != null && r.result.evidence.count <= r.result.evidence.threshold)
 *     if thin.length >= 1 → emit one override per stage with the most-thin check's label.
 */
export function detectRiskOverrides(evaluations: StageEvaluation[]): RiskOverride[] {
  const done = evaluations.filter((e) => e.status === 'done');
  if (done.length === 0) return [];
  // Iteration-3 scaffold — see TODO above. Returning [] here is the honest
  // state until CheckResult exposes evidence metadata. The integration glue
  // (computeNextBestAction wiring + renderDirectionForPrompt block + chat
  // prompt branch) is ALREADY in place, so when CheckResult gains the field
  // the only edit needed is in this function body.
  return [];
}

/**
 * L2 Phase 0 — true when the canvas core (solution + value proposition) is
 * applied but the project has NO baseline score yet. State-driven, so it's
 * idempotent and covers both seed paths (chat commit + create-from-documents):
 * the moment a `scores` row lands the override disappears. Shared by the
 * direction engine and the project-brief option-set. Never throws — degrades
 * to false so direction falls back to the readiness recommendation.
 */
export async function needsPhase0Scoring(projectId: string): Promise<boolean> {
  try {
    const scored = await query<{ project_id: string }>(
      'SELECT project_id FROM scores WHERE project_id = ? LIMIT 1',
      projectId,
    );
    if (scored.length > 0) return false;
    const prereqs = await canvasRunPrereqs(projectId, 'startup-scoring');
    return prereqs.blocking.length === 0;
  } catch {
    return false;
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
  // Independent queries, both individually non-fatal — fetch in parallel.
  const [fresh, pending] = await Promise.all([
    freshSignals(projectId, opts.lastChatAt),
    pendingSignals(projectId),
  ]);

  const cold_start = isColdStart(snapshot.idea_canvas);

  const firstGap = active.results.find((r) => !r.result.passed);
  const top_gap = firstGap?.check.label ?? null;
  const top_gap_source = firstGap?.check.source ?? null;

  const rec = readiness.next_recommended_skill;
  let recommended_skill = rec
    ? { id: rec.id, label: rec.label, kickoff: rec.kickoff, stage_number: rec.stage_number }
    : null;

  // L2 Phase 0 — the readiness engine recommends missing_skills[0] and skips
  // scoring once the spine greens, so a project with a completed canvas core
  // but no baseline score never gets pointed at startup-scoring. Override it.
  const phase0Scoring = !cold_start && await needsPhase0Scoring(projectId);
  if (phase0Scoring) {
    recommended_skill = {
      id: 'startup-scoring',
      label: 'Startup Score',
      kickoff: SKILL_KICKOFFS['startup-scoring'],
      stage_number: 1,
    };
  }

  let action: string;
  let rationale: string;
  if (cold_start) {
    action = 'Tell me about your idea so I can structure it into a canvas';
    rationale = 'New project — no idea captured yet. Start at Idea Canvas.';
  } else if (phase0Scoring && recommended_skill) {
    action = recommended_skill.kickoff;
    rationale = 'Phase 0: get the initial score before validating.';
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

  const risk_overrides = detectRiskOverrides(evaluations);

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
    pending_signals: pending,
    risk_overrides,
  };
}

/**
 * Render the engine output as the chat opener's injected context block. WS-A
 * consumes this verbatim inside the system prompt so the model stops
 * re-deriving direction. Kept here (not in the prompt) so chat + UI share one
 * rendering.
 */
export function renderDirectionForPrompt(nba: NextBestAction): string {
  const lines: string[] = [];
  // Adversarial spine — when any risk overrides fired, surface them FIRST so
  // the prompt knows to push back before advancing. Choice locked per design
  // doc Premise 5: insight-card for single override, risk-matrix for 2+.
  if (nba.risk_overrides.length > 0) {
    const artifactType = nba.risk_overrides.length >= 2 ? 'risk-matrix' : 'insight-card';
    lines.push('[ADVERSARIAL SPINE — surface this BEFORE advancing the founder]');
    for (const ro of nba.risk_overrides) {
      lines.push(`  - Stage ${ro.stage_number} is at GO but evidence is thin: ${ro.gap_label}.`);
      lines.push(`    Rollback: ${ro.rollback_action}`);
    }
    lines.push(`Emit a ${artifactType} artifact citing the override(s). Include the rollback as an option in the trailing option-set. Do NOT advance past the flagged stage in prose.`);
    lines.push('');
  }
  lines.push('[DIRECTION ENGINE — your computed next move; lead with this]');
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
  // Unreviewed-signal backlog — unlike fresh_signals this repeats EVERY turn
  // until the founder acts on the signals in Inbox → Signals (product
  // decision: pending signals never silently expire from chat).
  if (nba.pending_signals.total > 0) {
    const n = nba.pending_signals.total;
    lines.push(`PENDING SIGNALS AWAITING REVIEW (${n}): the founder has ${n} watcher signal${n === 1 ? '' : 's'} waiting in the Inbox → Signals tab. Briefly remind them once per conversation (one sentence, not pushy) and offer to summarize.`);
    for (const s of nba.pending_signals.top) lines.push(`  - ${s.headline}`);
  }
  return lines.join('\n');
}

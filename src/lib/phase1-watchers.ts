/**
 * Phase-1 watcher activation — when a project completes Stage 1 (Idea Canvas)
 * and enters the Validation Gate with ZERO active watchers, auto-PROPOSE a
 * small set of L1 watchers into the review inbox.
 *
 * Approve-first by design (honors the 17/06 "no preset watchers on create"
 * decision): this module only creates `configure_monitor` /
 * `configure_watch_source` pending_actions — nothing activates until the
 * founder applies one (Watchers tab "Proposed" rows / inbox card).
 *
 * Idempotency (both must clear before the LLM call):
 *   1. memory_events marker `phase1_watchers_proposed` — recorded once,
 *      only when ≥1 proposal was actually created.
 *   2. ANY-status pending_action with payload->>'origin'='phase1_auto' —
 *      a rejected/dismissed proposal must stick; the founder said no once.
 *
 * First real caller of watcher-proposer.ts (previously dead code).
 */

import { query } from '@/lib/db';
import { buildProjectSnapshot, evaluateAllStages } from '@/lib/journey';
import type { ProjectSnapshot } from '@/lib/journey';
import { proposeWatchers, type ProposedWatcher } from '@/lib/watcher-proposer';
import { createPendingAction } from '@/lib/pending-actions';
import { recordEvent, lastEventOfType } from '@/lib/memory/events';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import type { WatcherTopic } from '@/lib/watchers';
import type { WatchSourceCategory } from '@/types';

/** payload.origin marker on every phase-1 auto-proposed pending_action. */
export const PHASE1_WATCHER_ORIGIN = 'phase1_auto';

/**
 * Pure predicate: propose exactly when the founder has just COMPLETED the
 * Validation Gate (Stage 2 done) with no signal coverage yet.
 *
 * Founder decision (2026-07): watchers are proposed AFTER Stage 2 completes,
 * not at its start — by then the market, competitors and technical validation
 * are done, so the auto-proposed watchers are far more accurate. (The founder
 * can always configure a watcher directly via chat before then; that path is
 * ungated.) This replaces the old "Stage 2 active" trigger.
 */
export function shouldProposePhase1Watchers(snapshot: ProjectSnapshot): boolean {
  const evals = evaluateAllStages(snapshot);
  const gateDone = evals.find((e) => e.stage.id === 'market_validation')?.status === 'done';
  const activeWatchers =
    snapshot.monitors.filter((m) => m.status === 'active').length +
    snapshot.watch_sources.filter((w) => w.status === 'active').length;
  return !!gateDone && activeWatchers === 0;
}

// Watcher-proposer topics → monitor `kind` (VALID_MONITOR_KINDS taxonomy).
const TOPIC_TO_MONITOR_KIND: Record<WatcherTopic, string> = {
  competitors: 'competitor',
  ip: 'technology',
  trends: 'market',
  partnerships: 'partner',
  hiring: 'custom',
  sentiment: 'custom',
  funding: 'funding',
  regulatory: 'regulation',
  pricing: 'competitor',
  // 'risk' rides the black-swan taxonomy (kind='black_swan' monitors); the
  // phase-1 proposer doesn't emit it, but the topic union requires totality.
  risk: 'black_swan',
  custom: 'custom',
};

// Watcher-proposer topics → watch_source category (diff proposals).
const TOPIC_TO_WS_CATEGORY: Record<WatcherTopic, WatchSourceCategory> = {
  competitors: 'competitor_product',
  ip: 'patent_database',
  trends: 'news',
  partnerships: 'news',
  hiring: 'careers_page',
  sentiment: 'review_site',
  funding: 'news',
  regulatory: 'regulatory',
  pricing: 'competitor_pricing',
  risk: 'news',
  custom: 'custom',
};

/**
 * Orchestrator — never throws, never blocks the caller (both trigger sites
 * fire-and-forget it). Builds the snapshot when the caller doesn't pass one.
 */
export async function maybeProposePhase1Watchers(
  projectId: string,
  snapshot?: ProjectSnapshot,
): Promise<void> {
  try {
    const snap = snapshot ?? (await buildProjectSnapshot(projectId));
    if (!shouldProposePhase1Watchers(snap)) return;

    const proj = (
      await query<{ name: string; owner_user_id: string | null }>(
        'SELECT name, owner_user_id FROM projects WHERE id = ?',
        projectId,
      )
    )[0];
    const ownerUserId = proj?.owner_user_id || '';
    if (!ownerUserId) return; // the marker event needs a user to scope to

    // Idempotency 1 — the marker means we already proposed for this project.
    if (await lastEventOfType(ownerUserId, projectId, 'phase1_watchers_proposed')) return;

    // Idempotency 2 — ANY-status phase1_auto pending_action (belt-and-braces
    // for pre-marker crashes AND for rejected proposals, which must stick).
    const prior = await query<{ id: string }>(
      "SELECT id FROM pending_actions WHERE project_id = ? AND payload->>'origin' = ? LIMIT 1",
      projectId,
      PHASE1_WATCHER_ORIGIN,
    );
    if (prior.length > 0) return;

    // Existing watcher names (any status) so the proposer doesn't duplicate.
    const existingNames = await query<{ name: string }>(
      `SELECT name FROM monitors WHERE project_id = ?
       UNION ALL
       SELECT label AS name FROM watch_sources WHERE project_id = ?`,
      projectId,
      projectId,
    ).catch(() => [] as Array<{ name: string }>);

    const locale = await resolveLocale(ownerUserId, projectId);
    const result = await proposeWatchers({
      projectId,
      projectName: proj?.name ?? 'this project',
      idea: snap.idea_canvas
        ? {
            problem: snap.idea_canvas.problem ?? undefined,
            solution: snap.idea_canvas.solution ?? undefined,
            target_market: snap.idea_canvas.target_market ?? undefined,
            value_proposition: snap.idea_canvas.value_proposition ?? undefined,
          }
        : null,
      knownCompetitors: snap.competitors.map((c) => c.name).filter(Boolean).slice(0, 10),
      keywords: [],
      existingWatcherNames: existingNames.map((r) => r.name).filter(Boolean),
      locale,
    });

    // Re-check idempotency 2 AFTER the multi-second LLM call (TOCTOU): the two
    // trigger sites (chat turn + proposal approval) can overlap inside the
    // proposeWatchers window and both pass the pre-checks. This shrinks the
    // duplicate window from ~seconds to ~ms; a leaked duplicate is still just
    // a founder-gated proposal, so no advisory lock needed at alpha scale.
    const priorAfterLlm = await query<{ id: string }>(
      "SELECT id FROM pending_actions WHERE project_id = ? AND payload->>'origin' = ? LIMIT 1",
      projectId,
      PHASE1_WATCHER_ORIGIN,
    );
    if (priorAfterLlm.length > 0) return;

    const createdIds: string[] = [];
    for (const proposal of result.proposed) {
      const id = await persistProposal(projectId, proposal, locale);
      if (id) createdIds.push(id);
    }

    // Marker only when ≥1 proposal actually landed — a thin-context/LLM-failure
    // run leaves no marker, so the next qualifying turn can retry.
    if (createdIds.length > 0) {
      await recordEvent({
        userId: ownerUserId,
        projectId,
        eventType: 'phase1_watchers_proposed',
        payload: {
          origin: PHASE1_WATCHER_ORIGIN,
          pending_action_ids: createdIds,
          count: createdIds.length,
        },
      });
      console.info(`[phase1-watchers] proposed ${createdIds.length} watcher(s) for ${projectId}`);
    }
  } catch (err) {
    console.warn('[phase1-watchers] maybeProposePhase1Watchers failed (non-fatal):', (err as Error).message);
  }
}

/**
 * One accepted proposal → one pending_action. Payloads mirror the
 * propose_monitor / propose_watch_source pending-action shapes so the existing
 * configureMonitor / configureWatchSource executors apply them unchanged.
 * NO prompt field — configureMonitor builds the real scan prompt on apply.
 */
async function persistProposal(
  projectId: string,
  p: ProposedWatcher,
  locale: 'en' | 'it',
): Promise<string | null> {
  try {
    if (p.kind === 'diff') {
      const url = p.inputs.urls?.[0];
      if (!url) return null;
      const action = await createPendingAction({
        project_id: projectId,
        action_type: 'configure_watch_source',
        title: locale === 'it' ? `Traccia URL: ${p.name}` : `Track URL: ${p.name}`,
        rationale: p.rationale || undefined,
        payload: {
          url,
          label: p.name,
          category: TOPIC_TO_WS_CATEGORY[p.topic] ?? 'custom',
          // watch_sources have no 'monthly' schedule — weekly is the floor.
          schedule: p.cadence === 'daily' ? 'daily' : 'weekly',
          rationale: p.rationale,
          origin: PHASE1_WATCHER_ORIGIN,
        },
        estimated_impact: 'medium',
      });
      return action.id;
    }

    // 'hybrid' (validator vetoes bare 'scan') → topic monitor.
    // linked_risk_id 'ad_hoc' = the sentinel bucket exempt from the
    // one-per-(risk,kind) dedup rule, so sibling phase-1 monitors of the
    // same kind can all be applied.
    const action = await createPendingAction({
      project_id: projectId,
      action_type: 'configure_monitor',
      title: locale === 'it' ? `Configura monitor: ${p.name}` : `Configure monitor: ${p.name}`,
      rationale: p.rationale || undefined,
      payload: {
        name: p.name,
        objective: p.rationale,
        kind: TOPIC_TO_MONITOR_KIND[p.topic] ?? 'custom',
        schedule: p.cadence === 'daily' ? 'daily' : 'weekly',
        query: p.inputs.keywords?.length ? p.inputs.keywords.join(' ') : undefined,
        urls_to_track: p.inputs.urls ?? [],
        alert_threshold: p.rationale || `Material change relevant to ${p.name}`,
        linked_risk_id: 'ad_hoc',
        // Carried into the scan prompt on apply (buildMonitorScanPrompt topic
        // steering) so the monitor emits the alert_types that feed its category.
        topic: p.topic,
        origin: PHASE1_WATCHER_ORIGIN,
      },
      estimated_impact: 'medium',
    });
    return action.id;
  } catch (err) {
    console.warn('[phase1-watchers] proposal persist failed (non-fatal):', (err as Error).message);
    return null;
  }
}

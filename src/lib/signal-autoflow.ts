/**
 * Signal autoflow — Phase 2 of signal-routing (docs/plans/signal-routing.md).
 *
 * When SIGNAL_AUTOFLOW=1, freshly-persisted watcher signals route straight into
 * Knowledge at ingest instead of waiting in the Intel inbox:
 *
 *   relevance < 0.5                     → auto_dropped   (junk floor; soft-delete, reason logged)
 *   entity matches a REJECTED node      → auto_dropped   (tombstone — the founder said no; never resurrect)
 *   entity matches an existing node     → enrich         (timeline append via the accept path; no inbox item)
 *   no match + relevance ≥ 0.8          → new_entity     (node created via the accept path; no inbox item)
 *   no resolvable entity, or mid-conf   → inbox          (today's behavior — the exception queue)
 *
 * Every decision is DETERMINISTIC SQL — no LLM call anywhere in this module.
 * The scan/cron path must never fan out model calls per signal (the documented
 * serverless wall-clock killer); ambiguous signals fall back to the inbox where
 * a human decides. On ANY error the signal falls back to the inbox path too —
 * autoflow may only ever REDUCE founder workload, never lose a signal.
 *
 * Suppression mechanism: routing sets reviewed_state to 'accepted'/'auto_dropped',
 * and BOTH inbox producers only touch pending alerts (the parser auto-queue is
 * skipped via the routed-set; materialize-on-read filters reviewed_state='pending')
 * — so a routed signal never becomes an inbox ticket, by construction.
 */

import { get } from '@/lib/db';
import { logSignalActivity } from '@/lib/signal-activity-log';

export type AutoflowVerdict = 'drop' | 'enrich' | 'new_entity' | 'inbox';

export interface AutoflowDecision {
  verdict: AutoflowVerdict;
  reason: string;
  /** The matched node id (enrich only). */
  nodeId?: string;
}

/** Junk floor: below this relevance a signal is dropped outright. */
export const AUTOFLOW_JUNK_FLOOR = 0.5;
/** A brand-new entity needs at least this relevance to auto-create a node. */
export const AUTOFLOW_NEW_ENTITY_MIN = 0.8;

export function isAutoflowEnabled(): boolean {
  return process.env.SIGNAL_AUTOFLOW === '1';
}

/**
 * Pure routing decision — unit-testable, no I/O.
 *
 * `match` is the graph node whose LOWER(name) equals the alert's entity (or
 * null). A 'rejected' match is a TOMBSTONE: the founder dismissed this entity
 * from Knowledge, so autoflow must neither enrich nor re-create it. (A founder
 * accepting the same entity MANUALLY from the inbox still resurrects it —
 * that's an explicit human decision; this gate only binds the automatic path.)
 */
export function decideAutoflowRoute(
  alert: { relevance_score: number; entity: string | null },
  match: { id: string; reviewed_state: string | null } | null,
): AutoflowDecision {
  if (alert.relevance_score < AUTOFLOW_JUNK_FLOOR) {
    return { verdict: 'drop', reason: `relevance ${alert.relevance_score.toFixed(2)} below ${AUTOFLOW_JUNK_FLOOR} floor` };
  }
  if (!alert.entity || !alert.entity.trim()) {
    return { verdict: 'inbox', reason: 'no resolvable entity — needs human attribution' };
  }
  if (match && match.reviewed_state === 'rejected') {
    return { verdict: 'drop', reason: `entity "${alert.entity}" was rejected by the founder (tombstone)` };
  }
  if (match && match.reviewed_state === 'pending') {
    // A PENDING node is an unreviewed proposal (usually chat-born). Enriching
    // it would flip it to 'applied' without the founder ever approving it — a
    // validation-gate bypass. Route to the inbox so a human decides both.
    return { verdict: 'inbox', reason: `entity "${alert.entity}" matches a PENDING proposal — founder review first` };
  }
  if (match) {
    return { verdict: 'enrich', reason: `entity "${alert.entity}" matches existing node`, nodeId: match.id };
  }
  if (alert.relevance_score >= AUTOFLOW_NEW_ENTITY_MIN) {
    return { verdict: 'new_entity', reason: `new entity "${alert.entity}" at relevance ${alert.relevance_score.toFixed(2)}` };
  }
  return { verdict: 'inbox', reason: `new entity below ${AUTOFLOW_NEW_ENTITY_MIN} auto-create bar — needs human review` };
}

/**
 * Route ONE freshly-persisted alert. Returns the verdict actually applied, or
 * 'inbox' on any failure (fail-safe: the legacy queue path picks it up).
 *
 * Reads the DB row (not the in-memory parse) as truth: the insert may have
 * deduped ON CONFLICT into an older row whose entity/relevance/reviewed_state
 * differ. An already-reviewed row (re-scanned duplicate) is left untouched but
 * reported as routed so the caller doesn't queue a second inbox ticket for it.
 */
export async function routeAlertAutoflow(
  projectId: string,
  alertId: string,
): Promise<AutoflowVerdict> {
  try {
    const row = await get<{
      reviewed_state: string | null;
      relevance_score: number;
      entity: string | null;
      node_id: string | null;
      node_state: string | null;
    }>(
      `SELECT ea.reviewed_state, ea.relevance_score, ea.entity,
              gn.id AS node_id, gn.reviewed_state AS node_state
         FROM ecosystem_alerts ea
         LEFT JOIN graph_nodes gn
           ON gn.project_id = ea.project_id AND LOWER(gn.name) = LOWER(ea.entity)
        WHERE ea.id = ?`,
      alertId,
    );
    if (!row) return 'inbox';
    // Idempotency: route once. A dedup-upserted alert that was already accepted
    // or dropped keeps its state; report non-inbox so no ticket gets queued.
    if (row.reviewed_state && row.reviewed_state !== 'pending') {
      return row.reviewed_state === 'accepted' ? 'enrich' : 'drop';
    }

    const decision = decideAutoflowRoute(
      { relevance_score: row.relevance_score, entity: row.entity },
      row.node_id ? { id: row.node_id, reviewed_state: row.node_state } : null,
    );

    if (decision.verdict === 'drop') {
      // Soft-delete, never gone: the row stays queryable (with the reason in the
      // activity log) — this is both the audit trail and the labeled data for
      // tuning the thresholds later.
      const { run } = await import('@/lib/db');
      await run(
        `UPDATE ecosystem_alerts
            SET reviewed_state = 'auto_dropped',
                reviewed_at = CURRENT_TIMESTAMP,
                founder_action_taken = 'autoflow'
          WHERE id = ? AND (reviewed_state IS NULL OR reviewed_state = 'pending')`,
        alertId,
      );
      logSignalActivity({
        project_id: projectId,
        event_type: 'signal_auto_dropped',
        entity_id: alertId,
        entity_type: 'ecosystem_alert',
        headline: `Autoflow dropped: ${decision.reason}`,
        metadata: { reason: decision.reason },
      }).catch(() => {});
      return 'drop';
    }

    if (decision.verdict === 'enrich' || decision.verdict === 'new_entity') {
      // Reuse the EXACT accept path the inbox Apply uses (accepted + node upsert
      // with timeline append + back-link + memory_fact) — one write path, no
      // drift. Dynamic import breaks the static cycle parser → autoflow →
      // action-executors → parser (all uses are call-time, but keep module init
      // acyclic).
      const { acceptAlertIntoKnowledge } = await import('@/lib/action-executors');
      const nodeId = await acceptAlertIntoKnowledge(
        { project_id: projectId, ecosystem_alert_id: alertId },
        { founderAction: 'autoflow' },
      );
      if (!nodeId) {
        // The node write failed (accept marks the alert BEFORE the upsert, and
        // upsert errors are non-fatal). Without this revert the signal would be
        // 'accepted' yet appear NOWHERE — not in the graph, not in the feed,
        // not in the inbox: a silent drop dressed as success. Compensate back
        // to pending and let the inbox path pick it up.
        const { run } = await import('@/lib/db');
        await run(
          `UPDATE ecosystem_alerts
              SET reviewed_state = 'pending', reviewed_at = NULL, founder_action_taken = NULL
            WHERE id = ? AND reviewed_state = 'accepted' AND graph_node_id IS NULL`,
          alertId,
        );
        return 'inbox';
      }
      logSignalActivity({
        project_id: projectId,
        event_type: 'signal_autoflowed',
        entity_id: alertId,
        entity_type: 'ecosystem_alert',
        headline: `Autoflow ${decision.verdict === 'enrich' ? 'enriched' : 'created'} knowledge: ${decision.reason}`,
        metadata: { verdict: decision.verdict, reason: decision.reason, graph_node_id: nodeId },
      }).catch(() => {});
      return decision.verdict;
    }

    return 'inbox';
  } catch (err) {
    // Fail-safe: any error → inbox path (the signal is never silently lost).
    console.warn('[signal-autoflow] routing failed, falling back to inbox:', (err as Error).message);
    return 'inbox';
  }
}

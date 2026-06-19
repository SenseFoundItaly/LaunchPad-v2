/**
 * Pending Actions — the review inbox state machine.
 *
 * Every autonomous draft produced by the AI co-founder (outreach email,
 * LinkedIn post, proposed hypothesis, etc.) lands here as `status='pending'`.
 * The founder reviews in the inbox UI and either applies, edits, or rejects.
 * Applying triggers execution (via Composio once PR #6 lands, local outbox
 * until then).
 *
 * This file owns the state machine — API routes call these functions rather
 * than touching the DB directly, so the transitions are centralized.
 */

import { query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import type {
  PendingAction,
  PendingActionStatus,
  PendingActionType,
} from '@/types';

// =============================================================================
// Lane derivation — Phase 1 (Bucket Reorganization)
// =============================================================================

export {
  ACTION_LANE,
  laneFor,
  typesForLane,
  type ActionLane,
} from '@/lib/action-lanes';

// =============================================================================
// Row <-> domain conversion
// =============================================================================

interface PendingActionRow {
  id: string;
  project_id: string;
  monitor_run_id: string | null;
  ecosystem_alert_id: string | null;
  action_type: string;
  title: string;
  rationale: string | null;
  payload: Record<string, unknown>;
  estimated_impact: string | null;
  status: string;
  edited_payload: Record<string, unknown> | null;
  execution_target: string | null;
  executed_at: string | null;
  execution_result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function rowToAction(row: PendingActionRow): PendingAction {
  return {
    id: row.id,
    project_id: row.project_id,
    monitor_run_id: row.monitor_run_id,
    ecosystem_alert_id: row.ecosystem_alert_id,
    action_type: row.action_type as PendingActionType,
    title: row.title,
    rationale: row.rationale,
    payload: row.payload || {},
    estimated_impact: row.estimated_impact as PendingAction['estimated_impact'],
    status: row.status as PendingActionStatus,
    edited_payload: row.edited_payload,
    execution_target: row.execution_target,
    executed_at: row.executed_at,
    execution_result: row.execution_result,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// =============================================================================
// State machine
// =============================================================================

const TRANSITIONS: Record<PendingActionStatus, PendingActionStatus[]> = {
  pending: ['applied', 'edited', 'rejected'],
  edited: ['applied', 'edited', 'rejected'],
  applied: ['sent', 'failed'],
  rejected: [],
  sent: [],
  failed: ['applied'],
};

export function canTransition(from: PendingActionStatus, to: PendingActionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// =============================================================================
// Creation
// =============================================================================

export interface CreatePendingActionInput {
  project_id: string;
  action_type: PendingActionType;
  title: string;
  payload: Record<string, unknown>;
  rationale?: string;
  estimated_impact?: 'low' | 'medium' | 'high';
  monitor_run_id?: string;
  ecosystem_alert_id?: string;
  execution_target?: string;
  sources?: unknown[];
  priority?: 'critical' | 'high' | 'medium' | 'low';
}

export async function createPendingAction(input: CreatePendingActionInput): Promise<PendingAction> {
  const id = generateId('pa');
  const now = new Date().toISOString();
  // postgres.js + `unsafe()` auto-serializes JS objects/arrays to JSONB.
  // Pre-stringifying with JSON.stringify() makes postgres store the JSON
  // *string* as a JSONB string value — broken double-encoding. Pass the
  // raw value. (Verified empirically — see commit history.)
  const sourcesValue =
    Array.isArray(input.sources) && input.sources.length > 0
      ? input.sources
      : null;
  await run(
    `INSERT INTO pending_actions
       (id, project_id, monitor_run_id, ecosystem_alert_id, action_type, title, rationale,
        payload, estimated_impact, status, execution_target, sources, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    id,
    input.project_id,
    input.monitor_run_id || null,
    input.ecosystem_alert_id || null,
    input.action_type,
    input.title,
    input.rationale || null,
    input.payload,
    input.estimated_impact || null,
    input.execution_target || null,
    sourcesValue,
    input.priority || null,
    now,
    now,
  );
  const result = await getPendingAction(id);
  if (!result) throw new Error(`Failed to read back pending action ${id} after write`);
  return result;
}

// =============================================================================
// Reads
// =============================================================================

export async function getPendingAction(id: string): Promise<PendingAction | null> {
  const rows = await query<PendingActionRow>(
    'SELECT * FROM pending_actions WHERE id = ?',
    id,
  );
  return rows[0] ? rowToAction(rows[0]) : null;
}

export interface ListPendingActionsOptions {
  project_id: string;
  status?: PendingActionStatus | PendingActionStatus[];
  limit?: number;
  /**
   * Skip the read-time materialization that pulls ecosystem_alerts +
   * intelligence_briefs + assumptions into the inbox as synthetic pending
   * actions. Default true. Set false for internal/cron callers that just
   * want the raw `pending_actions` table contents.
   */
  materialize?: boolean;
}

export async function listPendingActions(opts: ListPendingActionsOptions): Promise<PendingAction[]> {
  // Inbox-unification (Phase 1 — read-time materialization). Surfaces open
  // ecosystem_alerts + intelligence_briefs as pending_actions so /actions is
  // the single proposal queue. Idempotent: a row is only created once per
  // source via ecosystem_alert_id FK (alerts) or payload.brief_id check
  // (briefs). Safe to call repeatedly. Skipped when caller passes
  // `materialize: false` (cron/internal callers).
  if (opts.materialize !== false) {
    try { await materializeProposalsFromSources(opts.project_id); }
    catch (err) { console.warn('[listPendingActions] materialize skipped:', (err as Error).message); }
  }

  const statuses = opts.status
    ? (Array.isArray(opts.status) ? opts.status : [opts.status])
    : null;
  let sql = 'SELECT * FROM pending_actions WHERE project_id = ?';
  const params: unknown[] = [opts.project_id];
  if (statuses) {
    sql += ` AND status IN (${statuses.map(() => '?').join(',')})`;
    params.push(...statuses);
  }
  // Open rows first (pending/edited — the founder still owes a decision),
  // terminal rows after; newest-first within each group. Pure created_at DESC
  // interleaved Done/Dismissed rows between Waiting ones in the inbox.
  sql += ` ORDER BY CASE WHEN status IN ('pending', 'edited') THEN 0 ELSE 1 END, created_at DESC`;
  if (opts.limit) { sql += ` LIMIT ${Math.max(1, Math.min(500, opts.limit))}`; }
  const rows = await query<PendingActionRow>(sql, ...params);
  return rows.map(rowToAction);
}

// =============================================================================
// Materialize-on-read: pulls open ecosystem_alerts + intelligence_briefs into
// pending_actions so the inbox is the single review surface. Idempotent via
// existing ecosystem_alert_id FK and via payload.brief_id JSONB extraction.
// =============================================================================
async function materializeProposalsFromSources(projectId: string): Promise<void> {
  // ── 1. ecosystem_alerts → pending_actions(action_type='signal_alert') ────
  // Uses the ecosystem_alert_id FK column to dedupe.
  const newAlerts = await query<{
    id: string; alert_type: string; headline: string; body: string | null;
    relevance_score: number; source: string | null; source_url: string | null;
  }>(
    `SELECT ea.id, ea.alert_type, ea.headline, ea.body, ea.relevance_score,
            ea.source, ea.source_url
       FROM ecosystem_alerts ea
      WHERE ea.project_id = ?
        AND (ea.reviewed_state IS NULL OR ea.reviewed_state = 'pending')
        AND NOT EXISTS (
          SELECT 1 FROM pending_actions pa WHERE pa.ecosystem_alert_id = ea.id
        )`,
    projectId,
  );
  for (const a of newAlerts) {
    const id = generateId('pa');
    const now = new Date().toISOString();
    const priority = a.relevance_score >= 0.85 ? 'critical'
                   : a.relevance_score >= 0.7  ? 'high'
                   : a.relevance_score >= 0.5  ? 'medium' : 'low';
    const payload = {
      alert_type: a.alert_type,
      source: a.source,
      source_url: a.source_url,
      body: a.body,
      relevance_score: a.relevance_score,
    };
    const sources = a.source_url
      ? [{ type: 'web', title: a.source, url: a.source_url }]
      : null;
    await run(
      `INSERT INTO pending_actions
         (id, project_id, ecosystem_alert_id, action_type, title, rationale,
          payload, status, priority, sources, created_at, updated_at)
       VALUES (?, ?, ?, 'signal_alert', ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      id, projectId, a.id,
      a.headline,
      a.body?.slice(0, 500) ?? null,
      payload,
      priority,
      sources,
      now, now,
    );
  }

  // ── 2. intelligence_briefs → pending_actions(action_type='intelligence_brief') ──
  // No FK column — dedupe on payload.brief_id (JSONB ->> text).
  const newBriefs = await query<{
    id: string; entity_name: string | null; title: string; narrative: string | null;
    temporal_prediction: string | null; confidence: number | null;
    recommended_actions: unknown; signal_count: number | null;
  }>(
    `SELECT ib.id, ib.entity_name, ib.title, ib.narrative,
            ib.temporal_prediction, ib.confidence,
            ib.recommended_actions, ib.signal_count
       FROM intelligence_briefs ib
      WHERE ib.project_id = ?
        AND (ib.status IS NULL OR ib.status = 'active')
        AND NOT EXISTS (
          SELECT 1 FROM pending_actions pa
           WHERE pa.project_id = ib.project_id
             AND pa.action_type = 'intelligence_brief'
             AND (pa.payload->>'brief_id') = ib.id
        )`,
    projectId,
  );
  for (const b of newBriefs) {
    const id = generateId('pa');
    const now = new Date().toISOString();
    const conf = b.confidence ?? 0;
    const priority = conf >= 0.85 ? 'high' : conf >= 0.65 ? 'medium' : 'low';
    const payload = {
      brief_id: b.id,
      entity: b.entity_name,
      narrative: b.narrative,
      prediction: b.temporal_prediction,
      confidence: conf,
      signal_count: b.signal_count,
      recommended_actions: b.recommended_actions,
    };
    await run(
      `INSERT INTO pending_actions
         (id, project_id, action_type, title, rationale, payload, status,
          priority, created_at, updated_at)
       VALUES (?, ?, 'intelligence_brief', ?, ?, ?, 'pending', ?, ?, ?)`,
      id, projectId,
      b.title,
      b.narrative?.slice(0, 500) ?? null,
      payload,
      priority,
      now, now,
    );
  }

  // ── 3. assumptions → pending_actions(action_type='assumption_review') ────
  // The assumptions table exists (migration 016) and this materialization is
  // live — open assumptions are pulled into the inbox here. The try/catch
  // below stays as a defensive guard for any DB that hasn't applied 016 yet.
  try {
    const newAssumptions = await query<{
      id: string; number: number; category: string; text: string;
      criticality: string;
    }>(
      `SELECT a.id, a.number, a.category, a.text, a.criticality
         FROM assumptions a
        WHERE a.project_id = ?
          AND a.status = 'open'
          AND NOT EXISTS (
            SELECT 1 FROM pending_actions pa
             WHERE pa.project_id = a.project_id
               AND pa.action_type = 'assumption_review'
               AND (pa.payload->>'assumption_id') = a.id
          )`,
      projectId,
    );
    for (const a of newAssumptions) {
      const id = generateId('pa');
      const now = new Date().toISOString();
      const priority = a.criticality === 'high' ? 'high'
                     : a.criticality === 'medium' ? 'medium' : 'low';
      const payload = {
        assumption_id: a.id,
        number: a.number,
        category: a.category,
      };
      await run(
        `INSERT INTO pending_actions
           (id, project_id, action_type, title, rationale, payload, status,
            priority, created_at, updated_at)
         VALUES (?, ?, 'assumption_review', ?, ?, ?, 'pending', ?, ?, ?)`,
        id, projectId,
        `#${a.number} (${a.category}) — ${a.text.slice(0, 90)}`,
        a.text,
        payload,
        priority,
        now, now,
      );
    }
  } catch (err) {
    const msg = (err as Error).message;
    // The assumptions table is live as of migration 016; this branch only
    // trips on a DB that hasn't applied 016 — silently skip then, since the
    // rest of the inbox still works. Any other error is surfaced.
    if (!/assumptions.*does not exist/i.test(msg)) {
      console.warn('[materialize] assumption_review skipped:', msg);
    }
  }

  // ── 4. pending chat knowledge → pending_actions(action_type='proposed_graph_update') ──
  // Founder directive 2026-06-11: chat-surfaced knowledge (insight/entity/
  // comparison/metric) no longer auto-applies — it persists 'pending' in
  // graph_nodes / memory_facts and must ALSO appear in the Inbox so the founder
  // can apply (0.5 credits) or dismiss it from there, not just on the chat card.
  //
  // We materialize each pending knowledge row as a synthetic
  // 'proposed_graph_update' (the Inbox allow-list shows this type). The payload
  // carries knowledge_source={table,id} so the apply executor + dismiss path
  // flip THAT existing row instead of creating a new node. Idempotent via
  // NOT EXISTS on payload.knowledge_source->>'id' (and we skip rows already
  // terminal — only pending knowledge becomes an open inbox row). Best-effort.
  try {
    // 4a. pending graph_nodes (entity-card / comparison-table / metric-grid).
    const pendingNodes = await query<{
      id: string; name: string; node_type: string | null; summary: string | null;
    }>(
      // Exclude DOCUMENT-UPLOAD entities (sources marked "Extracted from <file>"
      // by knowledge/upload). They arrive as a batch and are reviewed in the
      // Know graph (dashed nodes, click-to-review) + the create-time populating
      // view — materializing them here too floods the Inbox with the founder's
      // own doc contents (e.g. their product's internal features). The Inbox
      // stays for chat-proposed knowledge (no other surface) + watcher findings.
      `SELECT gn.id, gn.name, gn.node_type, gn.summary
         FROM graph_nodes gn
        WHERE gn.project_id = ?
          AND gn.reviewed_state = 'pending'
          AND gn.sources::text NOT LIKE '%Extracted from %'
          -- Competitors (item 14): reviewed in the Knowledge graph + the textual
          -- Competitors matryoshka, NOT the Inbox — which stays for watcher
          -- findings + to-dos. (competitor_set is the summary node; same rule.)
          AND gn.node_type NOT IN ('competitor', 'competitor_set')
          AND NOT EXISTS (
            SELECT 1 FROM pending_actions pa
             WHERE pa.project_id = gn.project_id
               AND pa.action_type = 'proposed_graph_update'
               AND (pa.payload->'knowledge_source'->>'id') = gn.id
          )`,
      projectId,
    );
    for (const n of pendingNodes) {
      const id = generateId('pa');
      const now = new Date().toISOString();
      const payload = {
        knowledge_source: { table: 'graph_nodes', id: n.id },
        node_type: n.node_type,
      };
      await run(
        `INSERT INTO pending_actions
           (id, project_id, action_type, title, rationale, payload, status,
            estimated_impact, priority, created_at, updated_at)
         VALUES (?, ?, 'proposed_graph_update', ?, ?, ?, 'pending', 'medium', 'medium', ?, ?)`,
        id, projectId,
        n.name?.slice(0, 120) || 'Knowledge proposal',
        (n.summary ?? '').slice(0, 500) || null,
        payload,
        now, now,
      );
    }

    // 4b. pending memory_facts (insight-card / chat fact). source_type='chat'
    // scopes this to chat-origin proposals (monitor/skill/manual facts default
    // to 'applied' and never reach here).
    const pendingFacts = await query<{ id: string; fact: string }>(
      `SELECT mf.id, mf.fact
         FROM memory_facts mf
        WHERE mf.project_id = ?
          AND mf.reviewed_state = 'pending'
          AND mf.source_type = 'chat'
          AND NOT EXISTS (
            SELECT 1 FROM pending_actions pa
             WHERE pa.project_id = mf.project_id
               AND pa.action_type = 'proposed_graph_update'
               AND (pa.payload->'knowledge_source'->>'id') = mf.id
          )`,
      projectId,
    );
    for (const f of pendingFacts) {
      const id = generateId('pa');
      const now = new Date().toISOString();
      const payload = {
        knowledge_source: { table: 'memory_facts', id: f.id },
      };
      await run(
        `INSERT INTO pending_actions
           (id, project_id, action_type, title, rationale, payload, status,
            estimated_impact, priority, created_at, updated_at)
         VALUES (?, ?, 'proposed_graph_update', ?, ?, ?, 'pending', 'medium', 'medium', ?, ?)`,
        id, projectId,
        f.fact.slice(0, 120),
        f.fact.slice(0, 500),
        payload,
        now, now,
      );
    }
  } catch (err) {
    console.warn('[materialize] chat-knowledge proposals skipped:', (err as Error).message);
  }
}

// =============================================================================
// Transitions
// =============================================================================

export class InvalidTransitionError extends Error {
  constructor(from: PendingActionStatus, to: PendingActionStatus) {
    super(`Invalid transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

async function applyTransition(
  id: string,
  to: PendingActionStatus,
  extraUpdates: { key: string; value: unknown }[] = [],
): Promise<PendingAction> {
  const action = await getPendingAction(id);
  if (!action) throw new Error(`Pending action not found: ${id}`);
  if (!canTransition(action.status, to)) {
    throw new InvalidTransitionError(action.status, to);
  }
  const now = new Date().toISOString();
  const sets = ['status = ?', 'updated_at = ?', ...extraUpdates.map(u => `${u.key} = ?`)];
  const params: unknown[] = [to, now, ...extraUpdates.map(u => u.value), id];
  await run(`UPDATE pending_actions SET ${sets.join(', ')} WHERE id = ?`, ...params);
  const result = await getPendingAction(id);
  if (!result) throw new Error(`Failed to read back pending action ${id} after write`);
  return result;
}

export async function applyPendingAction(id: string): Promise<PendingAction> {
  return applyTransition(id, 'applied');
}

export async function editPendingAction(id: string, editedPayload: Record<string, unknown>): Promise<PendingAction> {
  return applyTransition(id, 'edited', [
    // Pass the OBJECT, not JSON.stringify(...). edited_payload is a JSONB column
    // (and applyTransition binds it with no ::jsonb cast), so postgres.js
    // serializes an object correctly — exactly like the original `payload`
    // insert. Stringifying stored a double-encoded JSON *string* scalar, which
    // read back as a string; effectivePayload then saw no fields and executors
    // no-op'd ("No items to apply." → validation applies silently did nothing).
    { key: 'edited_payload', value: editedPayload },
  ]);
}

export async function rejectPendingAction(id: string, reason?: string): Promise<PendingAction> {
  const extras: { key: string; value: unknown }[] = [];
  if (reason) {
    extras.push({
      // Object, not JSON.stringify — execution_result is JSONB. Stringifying
      // double-encodes it into a string scalar; readers (actions page narrative,
      // unified.ts graph-node extraction) expect an object and get undefined.
      key: 'execution_result',
      value: { rejected_reason: reason },
    });
  }
  return applyTransition(id, 'rejected', extras);
}

export interface ExecutionResult {
  target?: string;
  external_id?: string;
  response?: unknown;
  error?: string;
}

export async function markActionSent(id: string, result: ExecutionResult): Promise<PendingAction> {
  return applyTransition(id, 'sent', [
    // Object, not JSON.stringify — execution_result is JSONB (see rejectPendingAction).
    { key: 'execution_result', value: result },
    { key: 'executed_at', value: new Date().toISOString() },
  ]);
}

export async function markActionFailed(id: string, error: string): Promise<PendingAction> {
  return applyTransition(id, 'failed', [
    { key: 'execution_result', value: { error } },
    { key: 'executed_at', value: new Date().toISOString() },
  ]);
}

// =============================================================================
// Inbox summary
// =============================================================================

export interface InboxSummary {
  pending: number;
  edited: number;
  applied_awaiting_send: number;
  sent_last_7d: number;
  rejected_last_7d: number;
}

export async function inboxSummary(projectId: string): Promise<InboxSummary> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const counts = await query<{ status: string; c: number }>(
    `SELECT status, COUNT(*) as c FROM pending_actions WHERE project_id = ? GROUP BY status`,
    projectId,
  );
  const byStatus: Record<string, number> = {};
  for (const row of counts) byStatus[row.status] = row.c;

  const recent = await query<{ status: string; c: number }>(
    `SELECT status, COUNT(*) as c FROM pending_actions
     WHERE project_id = ? AND updated_at >= ? AND status IN ('sent', 'rejected')
     GROUP BY status`,
    projectId, sevenDaysAgo,
  );
  const recentByStatus: Record<string, number> = {};
  for (const row of recent) recentByStatus[row.status] = row.c;

  return {
    pending: byStatus.pending || 0,
    edited: byStatus.edited || 0,
    applied_awaiting_send: byStatus.applied || 0,
    sent_last_7d: recentByStatus.sent || 0,
    rejected_last_7d: recentByStatus.rejected || 0,
  };
}

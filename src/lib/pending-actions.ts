/**
 * Pending Actions — the approval inbox state machine.
 *
 * Every autonomous draft produced by the AI co-founder (outreach email,
 * LinkedIn post, proposed hypothesis, etc.) lands here as `status='pending'`.
 * The founder reviews in the inbox UI and either approves, edits, or rejects.
 * Approval triggers execution (via Composio once PR #6 lands, local outbox
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
  payload: string;
  estimated_impact: string | null;
  status: string;
  edited_payload: string | null;
  execution_target: string | null;
  executed_at: string | null;
  execution_result: string | null;
  created_at: string;
  updated_at: string;
}

function safeParseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
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
    payload: safeParseJson<Record<string, unknown>>(row.payload) || {},
    estimated_impact: row.estimated_impact as PendingAction['estimated_impact'],
    status: row.status as PendingActionStatus,
    edited_payload: safeParseJson<Record<string, unknown>>(row.edited_payload),
    execution_target: row.execution_target,
    executed_at: row.executed_at,
    execution_result: safeParseJson<Record<string, unknown>>(row.execution_result),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// =============================================================================
// State machine
// Valid transitions:
//   pending -> approved | edited | rejected
//   edited  -> approved | rejected   (can iterate edits)
//   approved -> sent | failed        (after execution attempt)
//   rejected / sent / failed are terminal
// =============================================================================

const TRANSITIONS: Record<PendingActionStatus, PendingActionStatus[]> = {
  pending: ['approved', 'edited', 'rejected'],
  edited: ['approved', 'edited', 'rejected'],
  approved: ['sent', 'failed'],
  rejected: [],
  sent: [],
  failed: ['approved'],
};

export function canTransition(from: PendingActionStatus, to: PendingActionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// =============================================================================
// Creation — called by the ecosystem-monitor run handler and by skills that
// propose drafts. Always starts in `pending`.
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
  // Optional Source[] JSON from the originating artifact (Phase D of the
  // mandatory-sources plan). Kept as `unknown[]` at this layer so we don't
  // pull in the full Source union — callers pass whatever the parser/artifact
  // emitted. Persisted as JSON to pending_actions.sources.
  sources?: unknown[];
}

export function createPendingAction(input: CreatePendingActionInput): PendingAction {
  const id = generateId('pa');
  const now = new Date().toISOString();
  const sourcesJson =
    Array.isArray(input.sources) && input.sources.length > 0
      ? JSON.stringify(input.sources)
      : null;
  run(
    `INSERT INTO pending_actions
       (id, project_id, monitor_run_id, ecosystem_alert_id, action_type, title, rationale,
        payload, estimated_impact, status, execution_target, sources, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    id,
    input.project_id,
    input.monitor_run_id || null,
    input.ecosystem_alert_id || null,
    input.action_type,
    input.title,
    input.rationale || null,
    JSON.stringify(input.payload),
    input.estimated_impact || null,
    input.execution_target || null,
    sourcesJson,
    now,
    now,
  );
  return getPendingAction(id)!;
}

// =============================================================================
// Reads
// =============================================================================

export function getPendingAction(id: string): PendingAction | null {
  const rows = query<PendingActionRow>(
    'SELECT * FROM pending_actions WHERE id = ?',
    id,
  );
  return rows[0] ? rowToAction(rows[0]) : null;
}

export interface ListPendingActionsOptions {
  project_id: string;
  status?: PendingActionStatus | PendingActionStatus[];
  limit?: number;
}

export function listPendingActions(opts: ListPendingActionsOptions): PendingAction[] {
  const statuses = opts.status
    ? (Array.isArray(opts.status) ? opts.status : [opts.status])
    : null;
  let sql = 'SELECT * FROM pending_actions WHERE project_id = ?';
  const params: unknown[] = [opts.project_id];
  if (statuses) {
    sql += ` AND status IN (${statuses.map(() => '?').join(',')})`;
    params.push(...statuses);
  }
  sql += ' ORDER BY created_at DESC';
  if (opts.limit) { sql += ` LIMIT ${Math.max(1, Math.min(500, opts.limit))}`; }
  const rows = query<PendingActionRow>(sql, ...params);
  return rows.map(rowToAction);
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

function applyTransition(
  id: string,
  to: PendingActionStatus,
  extraUpdates: { key: string; value: unknown }[] = [],
): PendingAction {
  const action = getPendingAction(id);
  if (!action) throw new Error(`Pending action not found: ${id}`);
  if (!canTransition(action.status, to)) {
    throw new InvalidTransitionError(action.status, to);
  }
  const now = new Date().toISOString();
  const sets = ['status = ?', 'updated_at = ?', ...extraUpdates.map(u => `${u.key} = ?`)];
  const params: unknown[] = [to, now, ...extraUpdates.map(u => u.value), id];
  run(`UPDATE pending_actions SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return getPendingAction(id)!;
}

export function approvePendingAction(id: string): PendingAction {
  return applyTransition(id, 'approved');
}

export function editPendingAction(id: string, editedPayload: Record<string, unknown>): PendingAction {
  return applyTransition(id, 'edited', [
    { key: 'edited_payload', value: JSON.stringify(editedPayload) },
  ]);
}

export function rejectPendingAction(id: string, reason?: string): PendingAction {
  const extras: { key: string; value: unknown }[] = [];
  if (reason) {
    extras.push({
      key: 'execution_result',
      value: JSON.stringify({ rejected_reason: reason }),
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

export function markActionSent(id: string, result: ExecutionResult): PendingAction {
  return applyTransition(id, 'sent', [
    { key: 'execution_result', value: JSON.stringify(result) },
    { key: 'executed_at', value: new Date().toISOString() },
  ]);
}

export function markActionFailed(id: string, error: string): PendingAction {
  return applyTransition(id, 'failed', [
    { key: 'execution_result', value: JSON.stringify({ error }) },
    { key: 'executed_at', value: new Date().toISOString() },
  ]);
}

// =============================================================================
// Inbox summary — powers the dashboard badge and Monday Brief digest
// =============================================================================

export interface InboxSummary {
  pending: number;
  edited: number;
  approved_awaiting_send: number;
  sent_last_7d: number;
  rejected_last_7d: number;
}

export function inboxSummary(projectId: string): InboxSummary {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const counts = query<{ status: string; c: number }>(
    `SELECT status, COUNT(*) as c FROM pending_actions WHERE project_id = ? GROUP BY status`,
    projectId,
  );
  const byStatus: Record<string, number> = {};
  for (const row of counts) byStatus[row.status] = row.c;

  const recent = query<{ status: string; c: number }>(
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
    approved_awaiting_send: byStatus.approved || 0,
    sent_last_7d: recentByStatus.sent || 0,
    rejected_last_7d: recentByStatus.rejected || 0,
  };
}

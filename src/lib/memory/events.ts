import crypto from 'crypto';
import { get, query, run } from '@/lib/db';

/**
 * memory_events is the append-only timeline of everything the agent and user
 * did on a project. It feeds:
 *   - buildMemoryContext() (chronological "what happened recently" signal)
 *   - Forge rolling metrics (1.6) — activation, completion, dropout points
 *   - Preference learning (3a) — dismissals feed back as preference facts
 *
 * No update-in-place. New state -> new row.
 */

export type EventType =
  | 'chat_turn'
  | 'skill_completed'
  | 'skill_invoked'
  | 'monitor_alert'
  | 'milestone_complete'
  | 'manual_note'
  | 'fact_recorded'
  | 'fact_dismissed'
  | 'heartbeat_reflection'
  | 'action_approved'
  | 'action_rejected'
  | 'action_dismissed'
  | 'workflow_proposed'
  // Emitted when the daily heartbeat proposes a founder task (action_type='task').
  // Payload: { pending_action_id, title, priority }. Powers the Activity feed
  // [CEO] line and lets the founder audit which heartbeat-proposed tasks landed.
  | 'task_proposed'
  // Emitted by the chat route when the parser rejects an artifact for
  // failing source-requirement validation. Payload contains the artifact
  // type and the failure reason — feeds a "how often is sourcing failing"
  // dashboard so we can tune prompts.
  | 'artifact_rejected_no_sources'
  // Emitted by configure_monitor executor when a founder approves a
  // monitor-proposal and it becomes an active row. Payload carries the
  // monitor_id, linked_risk_id, kind, schedule, and whether the agent
  // bypassed L2 semantic dedup. Feeds the HEARTBEAT monitor portfolio
  // review (v3) + founder's audit timeline.
  | 'monitor_approved'
  // Emitted by configure_budget executor when a founder approves a
  // budget-proposal. Payload: { prev_cap_usd, new_cap_usd, period_month, reason }.
  // Feeds the audit timeline + lets future heartbeats see "founder bumped
  // cap last week" so they don't re-suggest the same change.
  | 'budget_changed'
  // Emitted by the task-expand endpoint when a founder clicks Expand on a
  // TaskCard and the model returns a plan. Payload:
  //   { client_artifact_id, pending_action_id, subtask_count, estimated_effort }.
  // Used for dashboards ("how often do founders expand tasks?") and to prevent
  // the memory timeline from looking like a graveyard of unexpanded TODOs.
  | 'task_expanded';

export interface MemoryEvent {
  id: string;
  user_id: string;
  project_id: string;
  event_type: EventType;
  payload: unknown;
  created_at: string;
}

export interface RecordEventInput {
  userId: string;
  projectId: string;
  eventType: EventType;
  payload?: unknown;
}

/**
 * Append a new memory event. Returns the event id.
 * Non-throwing: logs and returns empty string on failure so a broken write
 * never blocks the caller's primary action.
 */
export function recordEvent(input: RecordEventInput): string {
  try {
    const id = crypto.randomUUID();
    const payloadJson = input.payload === undefined ? null : JSON.stringify(input.payload);
    run(
      `INSERT INTO memory_events (id, user_id, project_id, event_type, payload)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      input.userId,
      input.projectId,
      input.eventType,
      payloadJson,
    );
    return id;
  } catch (err) {
    console.warn('[memory/events] recordEvent failed:', err);
    return '';
  }
}

export interface ListEventsOpts {
  limit?: number;
  since?: string; // ISO timestamp
  eventTypes?: EventType[];
}

export function listEvents(
  userId: string,
  projectId: string,
  opts: ListEventsOpts = {},
): MemoryEvent[] {
  const { limit = 20, since, eventTypes } = opts;
  const clauses: string[] = ['user_id = ?', 'project_id = ?'];
  const params: unknown[] = [userId, projectId];
  if (since) {
    clauses.push('created_at >= ?');
    params.push(since);
  }
  if (eventTypes && eventTypes.length > 0) {
    clauses.push(`event_type IN (${eventTypes.map(() => '?').join(',')})`);
    params.push(...eventTypes);
  }
  const sql = `SELECT id, user_id, project_id, event_type, payload, created_at
               FROM memory_events
               WHERE ${clauses.join(' AND ')}
               ORDER BY created_at DESC
               LIMIT ?`;
  params.push(limit);
  const rows = query<{
    id: string;
    user_id: string;
    project_id: string;
    event_type: EventType;
    payload: string | null;
    created_at: string;
  }>(sql, ...params);

  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    project_id: r.project_id,
    event_type: r.event_type,
    payload: r.payload ? safeParse(r.payload) : null,
    created_at: r.created_at,
  }));
}

/** Last event of a specific type for (user, project) — useful for "was there a heartbeat today?". */
export function lastEventOfType(
  userId: string,
  projectId: string,
  eventType: EventType,
): MemoryEvent | null {
  const row = get<{
    id: string;
    user_id: string;
    project_id: string;
    event_type: EventType;
    payload: string | null;
    created_at: string;
  }>(
    `SELECT id, user_id, project_id, event_type, payload, created_at
     FROM memory_events
     WHERE user_id = ? AND project_id = ? AND event_type = ?
     ORDER BY created_at DESC LIMIT 1`,
    userId,
    projectId,
    eventType,
  );
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    project_id: row.project_id,
    event_type: row.event_type,
    payload: row.payload ? safeParse(row.payload) : null,
    created_at: row.created_at,
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

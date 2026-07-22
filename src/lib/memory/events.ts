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
  | 'fact_applied'
  | 'fact_rejected'
  | 'knowledge_applied'
  | 'knowledge_rejected'
  | 'knowledge_reverted'
  | 'heartbeat_reflection'
  | 'action_applied'
  | 'action_rejected'
  | 'action_dismissed'
  | 'workflow_proposed'
  | 'task_proposed'
  | 'knowledge_proposed'      // gap 1: a knowledge-suggestion was emitted in chat (proposal trace)
  | 'option_selected'         // gap 3: founder clicked a non-skill option-set choice (decision trace)
  | 'document_digested'       // brownfield digest: an upload was digested into staged prefill
  | 'artifact_rejected_no_sources'
  | 'artifact_rescued_by_fallback_citations'
  | 'monitor_applied'
  | 'phase1_watchers_proposed'
  | 'score_review_offered'
  | 'budget_changed'
  | 'task_expanded'
  | 'alert_acknowledged'
  | 'alert_dismissed'
  | 'alert_promoted'
  | 'alert_reverted'
  | 'loop1_review_proposed'   // Loop 1 (PSF Review) auto-trigger fired (WTP<30%)
  | 'loop1_override'          // founder ignored the auto-trigger, with motivation
  | 'loop1_verdict'           // escalation cap reached → founder picked GO/PIVOT/STOP
  | 'loop2_review_proposed'   // Loop 2 (BM Stress Test) auto-trigger fired (LTV/CAC<3×)
  | 'loop2_override'          // founder ignored the auto-trigger, with motivation
  | 'loop2_verdict';          // escalation cap reached → founder picked GO/PIVOT/STOP

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
 * Append a new memory event.
 * Non-throwing: logs and returns empty string on failure so a broken write
 * never blocks the caller's primary action.
 *
 * @returns UUID on success, '' on failure.
 */
export async function recordEvent(input: RecordEventInput): Promise<string> {
  try {
    const id = crypto.randomUUID();
    // Bind the raw object — payload is a JSONB column; JSON.stringify would
    // double-encode it to a string scalar (every payload->>'field' read → null).
    const payloadJson = input.payload === undefined ? null : input.payload;
    await run(
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

export async function listEvents(
  userId: string,
  projectId: string,
  opts: ListEventsOpts = {},
): Promise<MemoryEvent[]> {
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
  const rows = await query<{
    id: string;
    user_id: string;
    project_id: string;
    event_type: EventType;
    payload: unknown;
    created_at: string;
  }>(sql, ...params);

  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    project_id: r.project_id,
    event_type: r.event_type,
    payload: r.payload,
    created_at: r.created_at,
  }));
}

/**
 * An agent skill proposal that has NOT yet been fulfilled by a run.
 *
 * PR-A: skill_* chat tools are ephemeral by founder directive (no Inbox row) —
 * but the PROPOSAL is recorded as a skill_invoked event, and the RUN (if it
 * happens) as a skill_completed event carrying the proposal_id. This surfaces
 * the still-open ones so the agent's turn context knows what it already
 * suggested, WITHOUT them ever expiring out of the 15-event recent-activity
 * window. Collapsed by skill_id (re-proposing the same skill = one line + count).
 */
export interface OpenProposal {
  skill_id: string;
  /** ISO timestamp of the most recent still-open proposal for this skill. */
  proposed_at: string;
  /** How many founder chat turns have elapsed since that proposal. */
  turns_since: number;
  /** How many still-open (unfulfilled) proposals of this skill exist. */
  times_proposed: number;
  /** True once the founder has sent ≥2 messages since without running it. */
  lapsed: boolean;
}

/**
 * Agent skill proposals with no matching run yet, newest-first, collapsed by
 * skill_id. A proposal is "fulfilled" by a skill_completed event for the same
 * skill_id at-or-after the proposal time (covers re-proposal after an earlier
 * completion: the later proposal has no completion after it → still open).
 * Non-throwing: returns [] on any failure (never blocks context assembly).
 */
export async function openProposals(
  userId: string,
  projectId: string,
  opts: { limit?: number; lapseAfterTurns?: number } = {},
): Promise<OpenProposal[]> {
  const { limit = 8, lapseAfterTurns = 2 } = opts;
  try {
    const [proposals, turns] = await Promise.all([
      query<{ skill_id: string; created_at: string }>(
        `SELECT pi.payload->>'skill_id' AS skill_id, pi.created_at
           FROM memory_events pi
          WHERE pi.user_id = ? AND pi.project_id = ?
            AND pi.event_type = 'skill_invoked'
            AND pi.payload->>'invoker' = 'agent'
            AND pi.payload->>'skill_id' IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM memory_events c
               WHERE c.project_id = pi.project_id
                 AND c.event_type = 'skill_completed'
                 AND c.payload->>'skill_id' = pi.payload->>'skill_id'
                 AND c.created_at >= pi.created_at
            )
          ORDER BY pi.created_at DESC`,
        userId,
        projectId,
      ),
      query<{ created_at: string }>(
        `SELECT created_at FROM memory_events
          WHERE user_id = ? AND project_id = ? AND event_type = 'chat_turn'
          ORDER BY created_at DESC LIMIT 200`,
        userId,
        projectId,
      ),
    ]);

    // Collapse by skill_id: newest proposal wins, count the rest.
    const bySkill = new Map<string, { proposed_at: string; count: number }>();
    for (const p of proposals) {
      if (!p.skill_id) continue;
      const existing = bySkill.get(p.skill_id);
      if (existing) {
        existing.count += 1;
        // proposals are DESC, so the first seen is already the newest.
      } else {
        bySkill.set(p.skill_id, { proposed_at: p.created_at, count: 1 });
      }
    }

    const turnTimes = turns.map((t) => t.created_at);
    const out: OpenProposal[] = [];
    for (const [skill_id, { proposed_at, count }] of bySkill) {
      // turns_since = founder chat turns strictly after the proposal.
      const turns_since = turnTimes.filter((ct) => ct > proposed_at).length;
      out.push({
        skill_id,
        proposed_at,
        turns_since,
        times_proposed: count,
        lapsed: turns_since >= lapseAfterTurns,
      });
    }
    out.sort((a, b) => (a.proposed_at < b.proposed_at ? 1 : -1));
    return out.slice(0, limit);
  } catch (err) {
    console.warn('[memory/events] openProposals failed:', (err as Error).message);
    return [];
  }
}

/**
 * Stable hash of a knowledge fact's text, used to correlate a knowledge
 * proposal (chat knowledge-suggestion) with its later apply (gap 1). The
 * proposal records hash(fact); the apply records hash(title) — the
 * knowledge-suggestion's `fact` IS what the apply POST sends as `title`, so the
 * same normalization on both sides makes them match. Normalization: lowercase,
 * collapse whitespace, drop trailing punctuation — so trivial rewording of
 * casing/spacing still correlates.
 */
export function factHash(text: string): string {
  const norm = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!?]+$/, '');
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

/** Same shape as OpenProposal but for knowledge-suggestion facts (gap 1). */
export interface OpenKnowledgeProposal {
  fact_preview: string;
  fact_hash: string;
  proposed_at: string;
  turns_since: number;
  lapsed: boolean;
}

/**
 * Knowledge facts the agent proposed in chat that the founder has NOT applied
 * yet. A proposal is fulfilled by a knowledge_applied event carrying the same
 * fact_hash at-or-after the proposal. Non-throwing; newest-first; deduped by
 * fact_hash. Mirrors openProposals (skills) so the agent stops re-proposing a
 * fact it already surfaced and can honestly say "I suggested saving this".
 */
export async function openKnowledgeProposals(
  userId: string,
  projectId: string,
  opts: { limit?: number; lapseAfterTurns?: number } = {},
): Promise<OpenKnowledgeProposal[]> {
  const { limit = 6, lapseAfterTurns = 2 } = opts;
  try {
    const [proposals, turns] = await Promise.all([
      query<{ fact_hash: string; fact_preview: string; created_at: string }>(
        `SELECT pi.payload->>'fact_hash' AS fact_hash,
                pi.payload->>'preview'   AS fact_preview,
                pi.created_at
           FROM memory_events pi
          WHERE pi.user_id = ? AND pi.project_id = ?
            AND pi.event_type = 'knowledge_proposed'
            AND pi.payload->>'fact_hash' IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM memory_events c
               WHERE c.project_id = pi.project_id
                 AND c.event_type = 'knowledge_applied'
                 AND c.payload->>'fact_hash' = pi.payload->>'fact_hash'
                 AND c.created_at >= pi.created_at
            )
          ORDER BY pi.created_at DESC`,
        userId,
        projectId,
      ),
      query<{ created_at: string }>(
        `SELECT created_at FROM memory_events
          WHERE user_id = ? AND project_id = ? AND event_type = 'chat_turn'
          ORDER BY created_at DESC LIMIT 200`,
        userId,
        projectId,
      ),
    ]);

    const seen = new Set<string>();
    const turnTimes = turns.map((t) => t.created_at);
    const out: OpenKnowledgeProposal[] = [];
    for (const p of proposals) {
      if (!p.fact_hash || seen.has(p.fact_hash)) continue; // newest wins
      seen.add(p.fact_hash);
      const turns_since = turnTimes.filter((ct) => ct > p.created_at).length;
      out.push({
        fact_hash: p.fact_hash,
        fact_preview: p.fact_preview || '(fact)',
        proposed_at: p.created_at,
        turns_since,
        lapsed: turns_since >= lapseAfterTurns,
      });
    }
    return out.slice(0, limit);
  } catch (err) {
    console.warn('[memory/events] openKnowledgeProposals failed:', (err as Error).message);
    return [];
  }
}

/** Last event of a specific type for (user, project) — useful for "was there a heartbeat today?". */
export async function lastEventOfType(
  userId: string,
  projectId: string,
  eventType: EventType,
): Promise<MemoryEvent | null> {
  const row = await get<{
    id: string;
    user_id: string;
    project_id: string;
    event_type: EventType;
    payload: unknown;
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
    payload: row.payload,
    created_at: row.created_at,
  };
}

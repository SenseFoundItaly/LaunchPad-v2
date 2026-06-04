import crypto from 'crypto';
import { get, query, run } from '@/lib/db';
import { recordEvent } from './events';
import type { Source, ReviewedState } from '@/types/artifacts';

/**
 * memory_facts is the durable knowledge base per (user, project). Facts are
 * curated signals the agent (or user) wants preserved across sessions:
 * decisions, commitments, named entities, preferences, observed patterns.
 */

export type FactKind = 'fact' | 'decision' | 'observation' | 'note' | 'preference';
export type FactSourceType = 'chat' | 'skill' | 'monitor' | 'manual' | 'approval_inbox' | 'heartbeat';

export interface MemoryFact {
  id: string;
  user_id: string;
  project_id: string;
  fact: string;
  kind: FactKind;
  source_type: FactSourceType | null;
  source_id: string | null;
  reviewed_state: ReviewedState;
  created_at: string;
  updated_at: string;
  sources?: unknown[] | null;
}

export interface RecordFactInput {
  userId: string;
  projectId: string;
  fact: string;
  kind?: FactKind;
  sourceType?: FactSourceType;
  sourceId?: string;
  /** @deprecated confidence column dropped; accepted but ignored for back-compat. */
  confidence?: number;
  sources?: Source[];
}

/**
 * Record a new fact. If an identical fact string already exists for the same
 * (user, project, kind), bumps updated_at + confidence instead of inserting
 * a duplicate. Also writes a memory_event(type='fact_recorded').
 *
 * Facts insert as reviewed_state='applied' — the prior pending-review gate
 * was removed when the chat-driven extraction proved reliable enough to skip
 * founder approval. Founders can still delete/edit from the Knowledge page.
 *
 * @returns UUID on success, '' on failure.
 */
export async function recordFact(input: RecordFactInput): Promise<string> {
  try {
    const kind = input.kind || 'fact';

    // Dedup: same fact text (case-insensitive, trimmed) within (user,project,kind).
    // Excluded: rejected facts (founder explicitly rejected — allow re-submission).
    const trimmed = input.fact.trim();
    const existing = await get<{ id: string }>(
      `SELECT id FROM memory_facts
       WHERE user_id = ? AND project_id = ? AND kind = ?
         AND LOWER(fact) = LOWER(?) AND reviewed_state != 'rejected'`,
      input.userId,
      input.projectId,
      kind,
      trimmed,
    );

    const sourcesJson =
      input.sources && input.sources.length > 0 ? JSON.stringify(input.sources) : null;

    let id: string;
    if (existing) {
      await run(
        `UPDATE memory_facts
         SET updated_at = CURRENT_TIMESTAMP, sources = COALESCE(?, sources)
         WHERE id = ?`,
        sourcesJson,
        existing.id,
      );
      id = existing.id;
    } else {
      id = crypto.randomUUID();
      await run(
        `INSERT INTO memory_facts
           (id, user_id, project_id, fact, kind, source_type, source_id, reviewed_state, sources)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', ?)`,
        id,
        input.userId,
        input.projectId,
        trimmed,
        kind,
        input.sourceType ?? null,
        input.sourceId ?? null,
        sourcesJson,
      );
    }

    await recordEvent({
      userId: input.userId,
      projectId: input.projectId,
      eventType: 'fact_recorded',
      payload: { factId: id, kind, preview: trimmed.slice(0, 120) },
    });

    return id;
  } catch (err) {
    console.warn('[memory/facts] recordFact failed:', err);
    return '';
  }
}

export interface ListFactsOpts {
  limit?: number;
  /** Filter by reviewed states. Defaults to ['applied'] for agent context. */
  states?: ReviewedState[];
  kinds?: FactKind[];
  /** @deprecated confidence column dropped; accepted but ignored for back-compat. */
  minConfidence?: number;
  /** When true, include the sources JSONB column in results. */
  includeSources?: boolean;
}

export async function listFacts(
  userId: string,
  projectId: string,
  opts: ListFactsOpts = {},
): Promise<MemoryFact[]> {
  const { limit = 20, states = ['applied'], kinds, includeSources } = opts;
  const clauses: string[] = ['user_id = ?', 'project_id = ?'];
  const params: unknown[] = [userId, projectId];
  if (states.length > 0) {
    clauses.push(`reviewed_state IN (${states.map(() => '?').join(',')})`);
    params.push(...states);
  }
  if (kinds && kinds.length > 0) {
    clauses.push(`kind IN (${kinds.map(() => '?').join(',')})`);
    params.push(...kinds);
  }
  const sourcesCol = includeSources ? ', sources' : '';
  const sql = `SELECT id, user_id, project_id, fact, kind, source_type, source_id,
                      reviewed_state, created_at, updated_at${sourcesCol}
               FROM memory_facts
               WHERE ${clauses.join(' AND ')}
               ORDER BY updated_at DESC
               LIMIT ?`;
  params.push(limit);
  const rows = await query<MemoryFact>(sql, ...params);
  return rows;
}

/**
 * Transition a fact's reviewed_state. Replaces the old dismissFact().
 * Used by the knowledge review endpoint.
 */
export async function reviewFact(
  factId: string,
  userId: string,
  state: 'applied' | 'rejected',
): Promise<boolean> {
  try {
    const fact = await get<{ project_id: string; fact: string }>(
      'SELECT project_id, fact FROM memory_facts WHERE id = ? AND user_id = ?',
      factId,
      userId,
    );
    if (!fact) return false;

    await run(
      'UPDATE memory_facts SET reviewed_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      state,
      factId,
    );
    await recordEvent({
      userId,
      projectId: fact.project_id,
      eventType: state === 'applied' ? 'fact_applied' : 'fact_rejected',
      payload: { factId, preview: fact.fact.slice(0, 120) },
    });
    return true;
  } catch (err) {
    console.warn('[memory/facts] reviewFact failed:', err);
    return false;
  }
}

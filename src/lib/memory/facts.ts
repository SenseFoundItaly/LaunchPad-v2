import crypto from 'crypto';
import { get, query, run } from '@/lib/db';
import { recordEvent } from './events';
import type { Source } from '@/types/artifacts';

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
  confidence: number;
  dismissed: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecordFactInput {
  userId: string;
  projectId: string;
  fact: string;
  kind?: FactKind;
  sourceType?: FactSourceType;
  sourceId?: string;
  confidence?: number;
  sources?: Source[];
}

/**
 * Record a new fact. If an identical fact string already exists for the same
 * (user, project, kind), bumps updated_at + confidence instead of inserting
 * a duplicate. Also writes a memory_event(type='fact_recorded').
 *
 * Returns the fact id. Non-throwing (warns + returns '' on failure).
 */
export async function recordFact(input: RecordFactInput): Promise<string> {
  try {
    const kind = input.kind || 'fact';
    const confidence = input.confidence ?? 0.8;

    // Dedup: same fact text (case-insensitive, trimmed) within (user,project,kind)
    const trimmed = input.fact.trim();
    const existing = await get<{ id: string; confidence: number }>(
      `SELECT id, confidence FROM memory_facts
       WHERE user_id = ? AND project_id = ? AND kind = ?
         AND LOWER(fact) = LOWER(?) AND dismissed = false`,
      input.userId,
      input.projectId,
      kind,
      trimmed,
    );

    const sourcesJson =
      input.sources && input.sources.length > 0 ? JSON.stringify(input.sources) : null;

    let id: string;
    if (existing) {
      const newConf = Math.max(existing.confidence, confidence);
      await run(
        `UPDATE memory_facts
         SET updated_at = CURRENT_TIMESTAMP, confidence = ?, sources = COALESCE(?, sources)
         WHERE id = ?`,
        newConf,
        sourcesJson,
        existing.id,
      );
      id = existing.id;
    } else {
      id = crypto.randomUUID();
      await run(
        `INSERT INTO memory_facts
           (id, user_id, project_id, fact, kind, source_type, source_id, confidence, sources)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.userId,
        input.projectId,
        trimmed,
        kind,
        input.sourceType ?? null,
        input.sourceId ?? null,
        confidence,
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
  includeDismissed?: boolean;
  kinds?: FactKind[];
  minConfidence?: number;
}

export async function listFacts(
  userId: string,
  projectId: string,
  opts: ListFactsOpts = {},
): Promise<MemoryFact[]> {
  const { limit = 20, includeDismissed = false, kinds, minConfidence } = opts;
  const clauses: string[] = ['user_id = ?', 'project_id = ?'];
  const params: unknown[] = [userId, projectId];
  if (!includeDismissed) clauses.push('dismissed = false');
  if (kinds && kinds.length > 0) {
    clauses.push(`kind IN (${kinds.map(() => '?').join(',')})`);
    params.push(...kinds);
  }
  if (minConfidence !== undefined) {
    clauses.push('confidence >= ?');
    params.push(minConfidence);
  }
  const sql = `SELECT id, user_id, project_id, fact, kind, source_type, source_id,
                      confidence, dismissed, created_at, updated_at
               FROM memory_facts
               WHERE ${clauses.join(' AND ')}
               ORDER BY updated_at DESC
               LIMIT ?`;
  params.push(limit);
  const rows = await query<MemoryFact>(sql, ...params);
  return rows;
}

/**
 * Soft-dismiss a fact. The row stays; dismissed=true excludes it from
 * buildMemoryContext selection.
 */
export async function dismissFact(factId: string, userId: string): Promise<boolean> {
  try {
    const fact = await get<{ project_id: string; fact: string }>(
      'SELECT project_id, fact FROM memory_facts WHERE id = ? AND user_id = ?',
      factId,
      userId,
    );
    if (!fact) return false;

    await run(
      'UPDATE memory_facts SET dismissed = true, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      factId,
    );
    await recordEvent({
      userId,
      projectId: fact.project_id,
      eventType: 'fact_dismissed',
      payload: { factId, preview: fact.fact.slice(0, 120) },
    });
    return true;
  } catch (err) {
    console.warn('[memory/facts] dismissFact failed:', err);
    return false;
  }
}

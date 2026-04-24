import crypto from 'crypto';
import { get, query, run } from '@/lib/db';
import { recordEvent } from './events';
import type { Source } from '@/types/artifacts';

/**
 * memory_facts is the durable knowledge base per (user, project). Facts are
 * curated signals the agent (or user) wants preserved across sessions:
 * decisions, commitments, named entities, preferences, observed patterns.
 *
 * Compared to memory_events (append-only timeline), facts are:
 *   - Dedup-able (same fact string per user+project = same row, bump updated_at)
 *   - Dismissible (user can mark as stale without deleting)
 *   - Ranked (recency + confidence drive buildMemoryContext selection)
 *   - Embedding-ready (BLOB column stays NULL in v1; populated later for
 *     semantic retrieval — schema change not needed)
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
  // Optional structured Source[] (Phase D). Coexists with sourceType/sourceId
  // (which are compact back-pointers to the originating table row). When the
  // agent emits a fact via :::artifact{type=fact} block, the parser ensures
  // sources[] is non-empty before we ever reach this function — callers
  // deriving facts from internal code (skill completions, workflow capture)
  // may omit sources if they rely on sourceType+sourceId instead.
  sources?: Source[];
}

/**
 * Record a new fact. If an identical fact string already exists for the same
 * (user, project, kind), bumps updated_at + confidence instead of inserting
 * a duplicate. Also writes a memory_event(type='fact_recorded').
 *
 * Returns the fact id. Non-throwing (warns + returns '' on failure).
 */
export function recordFact(input: RecordFactInput): string {
  try {
    const kind = input.kind || 'fact';
    const confidence = input.confidence ?? 0.8;

    // Dedup: same fact text (case-insensitive, trimmed) within (user,project,kind)
    const trimmed = input.fact.trim();
    const existing = get<{ id: string; confidence: number }>(
      `SELECT id, confidence FROM memory_facts
       WHERE user_id = ? AND project_id = ? AND kind = ?
         AND LOWER(fact) = LOWER(?) AND dismissed = 0`,
      input.userId,
      input.projectId,
      kind,
      trimmed,
    );

    const sourcesJson =
      input.sources && input.sources.length > 0 ? JSON.stringify(input.sources) : null;

    let id: string;
    if (existing) {
      // Keep the higher confidence; bump updated_at. If the new call carries
      // sources, overwrite — newer provenance is generally richer (the agent
      // may have run a web_search the first time and cited a verbatim URL
      // the second time). A NULL-preserving merge would be possible but not
      // worth the complexity for v1.
      const newConf = Math.max(existing.confidence, confidence);
      run(
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
      run(
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

    recordEvent({
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

export function listFacts(
  userId: string,
  projectId: string,
  opts: ListFactsOpts = {},
): MemoryFact[] {
  const { limit = 20, includeDismissed = false, kinds, minConfidence } = opts;
  const clauses: string[] = ['user_id = ?', 'project_id = ?'];
  const params: unknown[] = [userId, projectId];
  if (!includeDismissed) clauses.push('dismissed = 0');
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
  // Override the boolean `dismissed` field with the SQLite int representation
  // so the spread + boolean cast on the next line type-checks.
  const rows = query<Omit<MemoryFact, 'dismissed'> & { dismissed: number }>(sql, ...params);
  return rows.map((r) => ({ ...r, dismissed: r.dismissed === 1 }));
}

/**
 * Soft-dismiss a fact. The row stays; dismissed=1 excludes it from
 * buildMemoryContext selection. Also writes a memory_event for audit +
 * preference-learning feedback.
 */
export function dismissFact(factId: string, userId: string): boolean {
  try {
    const fact = get<{ project_id: string; fact: string }>(
      'SELECT project_id, fact FROM memory_facts WHERE id = ? AND user_id = ?',
      factId,
      userId,
    );
    if (!fact) return false;

    run(
      'UPDATE memory_facts SET dismissed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      factId,
    );
    recordEvent({
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

/**
 * Research cache (gap 2) — web_search / read_url results were never persisted:
 * they lived only in the ephemeral pi-agent session file, so every turn
 * re-fetched identical queries (cost) and any evidence the agent didn't fold
 * into an artifact was unrecoverable. This gives those results a durable,
 * TTL'd home so a repeated query is served from cache (cheaper + faster) and
 * the sources survive for later inspection.
 *
 * GLOBAL, not project-scoped: a web result for "Italian meal-kit market size"
 * is the same regardless of which project asked, so cross-project reuse is a
 * feature. Keyed by sha1(tool:normalized_key). Non-throwing throughout — a
 * cache miss/failure must never break the live tool call.
 */
import crypto from 'crypto';
import { get, run } from '@/lib/db';
import type { Source } from '@/types/artifacts';
import type { AgentToolResult } from '@mariozechner/pi-agent-core';

const TTL_DAYS = 14;
/** Cap stored result text so a huge scraped page can't bloat the row. */
const MAX_RESULT_TEXT = 20_000;

export type ResearchTool = 'web_search' | 'read_url';

/** Normalize a query/url into a stable cache key (case/space-insensitive). */
export function normalizeResearchKey(s: string): string {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 500);
}

function keyId(tool: ResearchTool, key: string): string {
  return crypto.createHash('sha1').update(`${tool}:${key}`).digest('hex');
}

/** Coerce a JSONB sources column (object or double-encoded string) to Source[]. */
function coerceSources(raw: unknown): Source[] {
  if (Array.isArray(raw)) return raw as Source[];
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

/**
 * Return a cached, non-expired result reconstructed as an AgentToolResult, or
 * null on miss/error. The `cache_hit: true` detail lets callers/telemetry see
 * that no provider call was made.
 */
export async function getCachedResearch(
  tool: ResearchTool,
  key: string,
): Promise<AgentToolResult<unknown> | null> {
  try {
    const row = await get<{ result_text: string; sources: unknown }>(
      `SELECT result_text, sources FROM research_cache
        WHERE id = ? AND expires_at > CURRENT_TIMESTAMP`,
      keyId(tool, key),
    );
    if (!row) return null;
    return {
      content: [{ type: 'text', text: row.result_text }],
      details: { cache_hit: true, tool, sources: coerceSources(row.sources) },
    };
  } catch (err) {
    console.warn('[research-cache] get failed (non-fatal):', (err as Error).message);
    return null;
  }
}

/**
 * Persist a successful tool result. No-op for error/empty results (those must
 * not poison the cache) — we only store a hit that carried real sources. sources
 * is a JSONB column: bind the RAW array (never JSON.stringify — that double-
 * encodes; see finding-jsonb-double-encode-audit).
 */
export async function putCachedResearch(
  tool: ResearchTool,
  key: string,
  result: AgentToolResult<unknown> | undefined | null,
): Promise<void> {
  try {
    const text = (result?.content?.[0] as { text?: string } | undefined)?.text;
    const details = (result?.details ?? {}) as { sources?: unknown; error?: boolean };
    const sources = coerceSources(details.sources);
    // Skip error results, empty text, and results with no sources — nothing
    // worth serving from cache, and caching a failure would suppress a retry.
    if (details.error || !text || sources.length === 0) return;
    await run(
      `INSERT INTO research_cache (id, tool, cache_key, result_text, sources, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '${TTL_DAYS} days')
       ON CONFLICT (id) DO UPDATE
         SET result_text = EXCLUDED.result_text,
             sources     = EXCLUDED.sources,
             created_at  = CURRENT_TIMESTAMP,
             expires_at  = EXCLUDED.expires_at`,
      keyId(tool, key),
      tool,
      key.slice(0, 500),
      text.slice(0, MAX_RESULT_TEXT),
      sources,
    );
  } catch (err) {
    console.warn('[research-cache] put failed (non-fatal):', (err as Error).message);
  }
}

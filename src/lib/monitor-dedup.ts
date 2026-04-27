/**
 * Monitor dedup layer — prevents duplicate / overlapping monitors at propose
 * time. Two layers:
 *
 *   L1 (SQL, <10ms, no override):
 *     - (project_id, linked_risk_id, kind) uniqueness for active monitors.
 *       One sensor per risk per kind. A founder can have a competitor-kind
 *       monitor AND a regulation-kind monitor on the same risk id, but not
 *       two competitor-kind monitors on the same risk id.
 *     - URL-set intersection: any proposed URL already tracked by an active
 *       monitor → block with a pointer to that monitor.
 *     - Max 10 active monitors per project (runaway fan-out guard).
 *
 *   L2 (Haiku semantic classifier, ~$0.0002 + 300ms):
 *     - Only runs if L1 passes AND ≥1 active monitor exists.
 *     - Scores proposed vs each existing on 0.0-1.0.
 *     - Threshold >= 0.7 returns `semantic_duplicate` with the best match.
 *     - Agent can re-call with `dedup_override: true` + `override_reason` to
 *       bypass — the reason surfaces on the founder's approval card so
 *       no override is silent.
 *
 * L1 rejections are mandatory. L2 rejections are overrideable. Nothing
 * escapes observation — every override path is logged for audit.
 */

import crypto from 'crypto';
import { get, query } from '@/lib/db';
import { chatJSONByTask } from '@/lib/llm';

export const MAX_ACTIVE_MONITORS_PER_PROJECT = 10;

export interface MonitorProposalInput {
  name: string;
  kind: string;
  schedule: 'hourly' | 'daily' | 'weekly';
  query?: string;
  urls_to_track?: string[];
  alert_threshold: string;
  linked_risk_id: string;
  /** When true, L2 rejections are ignored + override_reason is stored. */
  dedup_override?: boolean;
  override_reason?: string;
}

interface ActiveMonitorRow {
  id: string;
  name: string;
  kind: string | null;
  linked_risk_id: string | null;
  urls_to_track: string[] | null;
  query: string | null;
}

export type DedupVerdict =
  | { ok: true; dedup_hash: string; active_count: number }
  | { ok: false; error: 'cap_reached'; current: number; max: number; recommend_pause_candidates: Array<{ id: string; name: string }> }
  | { ok: false; error: 'duplicate_for_risk_kind'; existing_monitor_id: string; existing_name: string }
  | { ok: false; error: 'url_overlap'; existing_monitor_id: string; existing_name: string; overlapping_urls: string[] }
  | { ok: false; error: 'semantic_duplicate'; existing_monitor_id: string; existing_name: string; overlap_score: number; reason: string };

/**
 * Canonical hash for exact-match dedup. Sorts urls + normalizes query so
 * "WatchHubSpot" vs "watch hubspot" vs url-order-variations all hash equal.
 * Stored in monitors.dedup_hash + indexed for O(1) lookup.
 */
export function computeDedupHash(
  urls: string[] | undefined,
  q: string | undefined,
): string {
  const sortedUrls = (urls ?? []).slice().sort().join('|');
  const normQ = (q ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(`${sortedUrls}#${normQ}`).digest('hex');
}

/**
 * Run full dedup pipeline. L1 rules first (cheap + always enforced), then
 * L2 classifier if L1 passes. Callers should only create the monitor if
 * the verdict is {ok: true}.
 *
 * NOTE: dedup only considers status='active' monitors. Paused monitors
 * don't block new proposals — the founder can supersede a paused monitor
 * by creating a fresh one (v2 will add explicit un-pause flow).
 */
export async function checkDedup(
  projectId: string,
  proposal: MonitorProposalInput,
): Promise<DedupVerdict> {
  const active = await query<ActiveMonitorRow>(
    `SELECT id, name, kind, linked_risk_id, urls_to_track, query
     FROM monitors
     WHERE project_id = ? AND status = 'active'`,
    projectId,
  );

  // L1.0 — cap check. At 10 active monitors, the project is out of slots
  // until one is paused. Return a small list of candidates (lowest-signal
  // monitors first — v2 will score, v1 just returns the oldest).
  if (active.length >= MAX_ACTIVE_MONITORS_PER_PROJECT) {
    const candidates = active.slice(0, 3).map((m) => ({ id: m.id, name: m.name }));
    return {
      ok: false,
      error: 'cap_reached',
      current: active.length,
      max: MAX_ACTIVE_MONITORS_PER_PROJECT,
      recommend_pause_candidates: candidates,
    };
  }

  // L1.1 — (linked_risk_id, kind) uniqueness. One sensor per risk+kind pair.
  // If agent wants a second angle on the same risk, it must use a different
  // kind (e.g., competitor + regulation on the same risk is fine; two
  // competitor-kind monitors on the same risk is not).
  const riskKindDup = active.find(
    (m) => m.linked_risk_id === proposal.linked_risk_id && m.kind === proposal.kind,
  );
  if (riskKindDup) {
    return {
      ok: false,
      error: 'duplicate_for_risk_kind',
      existing_monitor_id: riskKindDup.id,
      existing_name: riskKindDup.name,
    };
  }

  // L1.2 — URL-set intersection. Any URL already tracked by an active
  // monitor is off-limits for a new proposal. Overlapping URLs mean the
  // two monitors would scrape the same page on different schedules =
  // wasted cost.
  const proposedUrls = new Set((proposal.urls_to_track ?? []).map((u) => u.trim()).filter(Boolean));
  if (proposedUrls.size > 0) {
    for (const m of active) {
      const existing: string[] = m.urls_to_track ? safeParseArray(m.urls_to_track) : [];
      const overlap = existing.filter((u) => proposedUrls.has(u));
      if (overlap.length > 0) {
        return {
          ok: false,
          error: 'url_overlap',
          existing_monitor_id: m.id,
          existing_name: m.name,
          overlapping_urls: overlap,
        };
      }
    }
  }

  const dedup_hash = computeDedupHash(proposal.urls_to_track, proposal.query);

  // L1.3 — exact-hash match. Covers the edge case where two proposals
  // happen to produce the same normalized (url_set + query) combination
  // but different names — e.g. agent reproposing a known monitor with a
  // reworded title. The indexed lookup is O(1).
  const hashDup = await get<{ id: string; name: string }>(
    'SELECT id, name FROM monitors WHERE project_id = ? AND status = ? AND dedup_hash = ? LIMIT 1',
    projectId, 'active', dedup_hash,
  );
  if (hashDup) {
    return {
      ok: false,
      error: 'duplicate_for_risk_kind',  // surface as same error — the UX is identical
      existing_monitor_id: hashDup.id,
      existing_name: hashDup.name,
    };
  }

  // L2 — Haiku semantic classifier. Only runs if we have a non-trivial
  // comparison set (≥1 active monitor). Cheap (~$0.0002/call) but async,
  // so skip when there's nothing to compare against.
  if (active.length === 0) {
    return { ok: true, dedup_hash, active_count: active.length };
  }

  // Override escape hatch — agent can bypass L2 with a public reason that
  // shows on the approval card. Useful when two monitors legitimately
  // cover adjacent signals at different frequencies (e.g., hourly price
  // check + weekly feature-parity check on the same company). The override
  // does NOT skip L1 — those rules are hard.
  if (proposal.dedup_override === true) {
    return { ok: true, dedup_hash, active_count: active.length };
  }

  const verdict = await runSemanticClassifier(proposal, active);
  if (verdict && verdict.overlap_score >= 0.7) {
    const match = active.find((m) => m.id === verdict.best_match_id);
    if (match) {
      return {
        ok: false,
        error: 'semantic_duplicate',
        existing_monitor_id: match.id,
        existing_name: match.name,
        overlap_score: verdict.overlap_score,
        reason: verdict.reason,
      };
    }
  }

  return { ok: true, dedup_hash, active_count: active.length };
}

/**
 * Safely coerce a JSONB-returned value into a string[].
 * postgres.js returns JSONB as already-parsed objects, so this handles
 * both the case where it's already an array and edge cases.
 */
function safeParseArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((x) => typeof x === 'string');
  return [];
}

const DEDUP_SYSTEM_PROMPT = `You compare a proposed startup monitor against existing active monitors to detect semantic overlap. Two monitors overlap if they fire on substantially the same underlying events.

Output JSON ONLY in this shape:
{"overlap_score": 0.0-1.0, "best_match_id": "<existing id OR null>", "reason": "<one sentence>"}

Scoring:
- 0.0-0.3 — Clearly different targets (different company, different regulator, different market segment)
- 0.4-0.6 — Related but distinct angles (same company, different signals; e.g., pricing vs funding)
- 0.7-1.0 — Substantial overlap (same target + same signal + same horizon)

Bias toward flagging overlap. A missed duplicate runs forever every cycle. A false flag is fixable in 30 seconds via an explicit dedup_override.`;

interface ClassifierResult {
  overlap_score: number;
  best_match_id: string | null;
  reason: string;
}

async function runSemanticClassifier(
  proposal: MonitorProposalInput,
  existing: ActiveMonitorRow[],
): Promise<ClassifierResult | null> {
  // Construct a compact comparison payload — just the fields that matter
  // for overlap judgment. Avoids sending the agent 10 full monitor rows.
  const userPayload = JSON.stringify({
    proposed: {
      name: proposal.name,
      kind: proposal.kind,
      query: proposal.query ?? null,
      urls: proposal.urls_to_track ?? [],
      alert_threshold: proposal.alert_threshold,
    },
    existing: existing.map((m) => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      query: m.query,
      urls: m.urls_to_track ? safeParseArray(m.urls_to_track) : [],
    })),
  });

  try {
    const res = await chatJSONByTask(
      [
        { role: 'system', content: DEDUP_SYSTEM_PROMPT },
        { role: 'user', content: userPayload },
      ],
      'classify',
    );
    // Shape-check — Haiku occasionally wraps the JSON in extra framing.
    const candidate = res as Partial<ClassifierResult>;
    if (
      typeof candidate.overlap_score === 'number' &&
      candidate.overlap_score >= 0 &&
      candidate.overlap_score <= 1 &&
      typeof candidate.reason === 'string'
    ) {
      return {
        overlap_score: candidate.overlap_score,
        best_match_id: typeof candidate.best_match_id === 'string' ? candidate.best_match_id : null,
        reason: candidate.reason,
      };
    }
    console.warn('[monitor-dedup] classifier returned unexpected shape, skipping:', res);
    return null;
  } catch (err) {
    // Classifier failure is non-fatal — we'd rather let a borderline case
    // through than block the whole propose_monitor flow on a Haiku hiccup.
    // L1 rules still protected against the worst cases (exact dup, cap).
    console.warn('[monitor-dedup] classifier error, skipping L2:', (err as Error).message);
    return null;
  }
}

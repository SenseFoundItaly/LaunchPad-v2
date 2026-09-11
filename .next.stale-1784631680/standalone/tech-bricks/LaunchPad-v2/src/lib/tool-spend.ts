/**
 * Tool-spend metering — observability for the PAID web_search / read_url tools.
 *
 * The web_search and read_url AgentTools (pi-tools.ts) reach paid third-party
 * APIs (Exa, Jina) via raw fetch. That is NOT a token cost, so it never appears
 * in pi-ai's usage.cost.total and was previously invisible to BOTH llm_usage_logs
 * and Langfuse (audit 2026-06-30 — "tracking all the instances where we're
 * charged"). This module records an ESTIMATED per-call cost for the billable
 * providers so the spend surfaces on the /usage page and in Langfuse next to LLM
 * spend.
 *
 * It is purely OBSERVATIONAL — like recordUsage under strict billing, it does NOT
 * debit the founder's credit pool (1 message = 1 credit; all tool/background cost
 * is absorbed). It only makes the spend visible.
 *
 * COSTS ARE ESTIMATES. Exa and Jina bill per request and their responses give us
 * no per-call figure, so we attribute a documented list-price default. Every
 * default is env-overridable so the number can be tuned to the real invoice
 * without a code change. Only billable providers are recorded — the keyless DDG /
 * raw-fetch fallbacks are free, and Jina is only billed when JINA_API_KEY is set.
 */
import { run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { logToLangfuse } from '@/lib/telemetry';

function envNum(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Documented list-price defaults (USD per call), each env-overridable.
//   Exa search ≈ $5 / 1k searches → $0.005; Exa /contents livecrawl ≈ $0.01.
//   Jina Reader/Search bill per token; a small flat estimate is used per call.
export const EXA_SEARCH_COST_USD = envNum(process.env.EXA_SEARCH_COST_USD, 0.005);
export const EXA_READ_COST_USD = envNum(process.env.EXA_READ_COST_USD, 0.01);
export const JINA_SEARCH_COST_USD = envNum(process.env.JINA_SEARCH_COST_USD, 0.001);
export const JINA_READ_COST_USD = envNum(process.env.JINA_READ_COST_USD, 0.001);

/** Jina is free (per-IP rate-limited) without a key; only billed when keyed. */
const JINA_BILLED = !!process.env.JINA_API_KEY;

export type ToolKind = 'web_search' | 'read_url';
export interface ToolSpendCtx {
  projectId?: string;
  /** Audit step label of the run that triggered the tool (e.g. 'chat', 'cron.competitors'). */
  step?: string;
}

/**
 * Map a tool result's `details.source` to the billable provider + estimated
 * cost. Returns null for the free fallbacks (ddg-fallback / raw-fallback) and
 * for keyless Jina, which incur no charge.
 */
export function classifyToolSpend(
  source: string | undefined,
  kind: ToolKind,
): { provider: 'exa' | 'jina'; cost: number } | null {
  if (source === 'exa') {
    return { provider: 'exa', cost: kind === 'read_url' ? EXA_READ_COST_USD : EXA_SEARCH_COST_USD };
  }
  if (source === 'jina' && JINA_BILLED) {
    return { provider: 'jina', cost: kind === 'read_url' ? JINA_READ_COST_USD : JINA_SEARCH_COST_USD };
  }
  return null;
}

/**
 * Record one paid web_search / read_url call (estimated cost) into
 * llm_usage_logs + Langfuse. Best-effort and never throws — a metering failure
 * must not break the agent's tool call. No-ops on the free path or when there is
 * no project to attribute the spend to.
 */
export async function recordToolSpend(
  ctx: ToolSpendCtx,
  kind: ToolKind,
  source: string | undefined,
): Promise<void> {
  const hit = classifyToolSpend(source, kind);
  if (!hit || hit.cost <= 0) return; // free provider/fallback — nothing billed
  if (!ctx.projectId) return; // no project to attribute to — skip
  const step = ctx.step
    ? `tool.${kind}.${hit.provider}:${ctx.step}`
    : `tool.${kind}.${hit.provider}`;

  // Per-project $ accumulator + audit row (the /usage page). model='web_search'
  // / 'read_url', provider='exa'/'jina' marks this as a tool fee, not a token
  // call. NOT recordUsage() — this is a flat third-party fee with zero tokens.
  try {
    await run(
      `INSERT INTO llm_usage_logs
         (id, project_id, skill_id, step, provider, model,
          input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
          total_cost_usd, latency_ms)
       VALUES (?, ?, NULL, ?, ?, ?, 0, 0, 0, 0, ?, 0)`,
      generateId('llmlg'),
      ctx.projectId,
      step,
      hit.provider,
      kind,
      hit.cost,
    );
  } catch (err) {
    console.warn('[recordToolSpend] usage-log failed (non-fatal):', (err as Error).message);
  }

  // Langfuse span so search spend shows in the same dashboard as LLM spend.
  // cost is passed via costDetails (telemetry) so Langfuse uses our number.
  try {
    await logToLangfuse(
      { projectId: ctx.projectId, step, provider: hit.provider, model: kind },
      { input_tokens: 0, output_tokens: 0 },
      hit.cost,
      0,
    );
  } catch {
    /* logToLangfuse already swallows its own errors */
  }
}

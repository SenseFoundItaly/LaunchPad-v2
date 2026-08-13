import { Langfuse } from 'langfuse';
import { run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { MODEL_CONFIG } from './llm/models';

// ---------------------------------------------------------------------------
// Langfuse — lazy-init so the app runs fine without credentials
// ---------------------------------------------------------------------------
let _langfuse: Langfuse | null = null;

/**
 * Environment tag attached to every trace/span/generation this client emits
 * (a client-construction-time option, not per-call). Explicit override first,
 * then Netlify's build/runtime CONTEXT, then NODE_ENV. Matters because dev,
 * staging, and prod all point at the SAME Langfuse project — without this,
 * local/staging test traces are indistinguishable from real founder traffic
 * in the dashboard.
 */
export function resolveLangfuseEnvironment(): string {
  if (process.env.LANGFUSE_ENVIRONMENT) return process.env.LANGFUSE_ENVIRONMENT;
  if (process.env.CONTEXT === 'production') return 'production';
  if (process.env.CONTEXT === 'deploy-preview' || process.env.CONTEXT === 'branch-deploy') return 'staging';
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

export function getLangfuse(): Langfuse | null {
  if (!process.env.LANGFUSE_SECRET_KEY) return null;
  if (!_langfuse) {
    _langfuse = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY || '',
      secretKey: process.env.LANGFUSE_SECRET_KEY || '',
      baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
      environment: resolveLangfuseEnvironment(),
    });
  }
  return _langfuse;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface TelemetryContext {
  projectId: string;
  skillId?: string;
  step?: string;
  // 'exa'/'jina' cover the paid web_search / read_url tool providers, whose
  // per-call cost is metered separately from LLM token spend (see tool-spend.ts).
  provider: 'anthropic' | 'openai' | 'openrouter' | 'exa' | 'jina';
  model?: string;
  /** Real founder/user id (falls back to projectId in logToLangfuse when absent). */
  userId?: string;
}

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// ---------------------------------------------------------------------------
// estimateCost — USD from token counts and known pricing
// ---------------------------------------------------------------------------

// Build PRICING from MODEL_CONFIG — auto-registers both Anthropic and OpenRouter
// slugs so adding a new model in models.ts is sufficient.
const PRICING: Record<string, {
  input: number;
  output: number;
  cacheWrite?: number;
  cacheRead?: number;
}> = {};
for (const m of Object.values(MODEL_CONFIG)) {
  PRICING[m.id] = m.pricing;
  PRICING[m.openrouterId] = m.pricing;
}
// Sonnet 4.0 (legacy, kept for backward compat with PI_MODEL fallback)
PRICING['claude-sonnet-4-20250514'] = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 };
PRICING['claude-sonnet-4'] = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 };
// OpenAI fallback models (not in MODEL_CONFIG)
PRICING['gpt-4o'] = { input: 2.50, output: 10 };
PRICING['gpt-4o-mini'] = { input: 0.15, output: 0.60 };

export function estimateCost(
  _provider: string,
  model: string,
  usage: TokenUsage,
): number {
  const prices = PRICING[model];
  if (!prices) return 0;

  const M = 1_000_000;
  let cost = 0;
  cost += ((usage.input_tokens || 0) / M) * prices.input;
  cost += ((usage.output_tokens || 0) / M) * prices.output;
  if (prices.cacheWrite) {
    cost += ((usage.cache_creation_input_tokens || 0) / M) * prices.cacheWrite;
  }
  if (prices.cacheRead) {
    cost += ((usage.cache_read_input_tokens || 0) / M) * prices.cacheRead;
  }
  return cost;
}

// ---------------------------------------------------------------------------
// Langfuse wire-shape helpers — shared by logToLangfuse (flat, post-hoc) and
// pi-agent.ts (live, nested tracing). One place that knows how to turn a
// (model, TokenUsage, cost) triple into what the Langfuse SDK expects.
// ---------------------------------------------------------------------------

// Map OpenRouter slugs back to the canonical Anthropic id Langfuse displays,
// built entirely from MODEL_CONFIG so adding a model in models.ts is enough.
// A canonical id (e.g. 'claude-sonnet-4-6') or unknown slug passes through
// unchanged. (The old hardcoded 'sonnet'/'claude-sonnet-4' → Sonnet-4.0
// aliases were dead — no caller ever passed those bare strings; removed
// 2026-06-30 so the logged model can never silently misattribute to 4.0.)
const LANGFUSE_MODEL_MAP: Record<string, string> = {};
for (const cfg of Object.values(MODEL_CONFIG)) {
  LANGFUSE_MODEL_MAP[cfg.openrouterId] = cfg.id;
}

export function mapToLangfuseModelId(model: string | undefined): string {
  return LANGFUSE_MODEL_MAP[model || ''] || model || 'unknown';
}

export function toLangfuseUsageAndCost(usage: TokenUsage, cost: number): {
  usageDetails: {
    input: number;
    output: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    total: number;
  };
  costDetails: { total: number } | undefined;
} {
  const promptTokens = usage.input_tokens || 0;
  const completionTokens = usage.output_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  // Langfuse's UsageDetails.total should be the sum of all token classes
  // billable for this call. If we only summed input + output we'd hide
  // 60-80% of the tokens on cached calls.
  const totalTokens = promptTokens + completionTokens + cacheCreation + cacheRead;
  return {
    usageDetails: {
      input: promptTokens,
      output: completionTokens,
      cache_creation_input_tokens: cacheCreation,
      cache_read_input_tokens: cacheRead,
      total: totalTokens,
    },
    costDetails: cost > 0 ? { total: cost } : undefined,
  };
}

// ---------------------------------------------------------------------------
// logToLangfuse — standalone Langfuse trace with full cost/model/token tracking
// ---------------------------------------------------------------------------
export async function logToLangfuse(
  ctx: TelemetryContext,
  usage: TokenUsage,
  cost: number,
  latencyMs: number,
  input?: string,
  output?: string,
): Promise<string | null> {
  try {
    const lf = getLangfuse();
    if (!lf) return null;

    const now = new Date();
    const startTime = new Date(now.getTime() - latencyMs);

    const langfuseModel = mapToLangfuseModelId(ctx.model);
    const { usageDetails, costDetails } = toLangfuseUsageAndCost(usage, cost);

    const trace = lf.trace({
      name: `${ctx.provider}/${ctx.step || 'chat'}`,
      // Real founder id when the caller has one; falls back to projectId for
      // callers not yet updated to pass userId (preserves prior behavior).
      userId: ctx.userId ?? ctx.projectId,
      sessionId: `${ctx.projectId}-${ctx.step || 'chat'}`,
      input: input?.slice(0, 2000),
      output: output?.slice(0, 2000),
      metadata: {
        projectId: ctx.projectId,
        skillId: ctx.skillId,
        provider: ctx.provider,
      },
    });

    // Generation — this is what Langfuse uses for cost/token/model display.
    // Use the v3 `usageDetails` + `costDetails` fields. When `costDetails`
    // is provided, Langfuse skips its own price-table lookup and uses our
    // authoritative number — critical because:
    //   - Langfuse doesn't know about OpenRouter slug pricing for newer models
    //   - We have pi-ai's exact cost.total which matches OpenRouter billing
    //   - Default Langfuse calc ignores cache tokens entirely, so its number
    //     comes out ~42% low on cached calls (verified against this project).
    trace.generation({
      name: `${ctx.provider} generation`,
      model: langfuseModel,
      modelParameters: {
        temperature: 0.7,
        maxTokens: 4096,
        provider: ctx.provider,
      },
      input: input?.slice(0, 2000) || ctx.step || 'chat',
      output: output?.slice(0, 2000) || '',
      startTime,
      endTime: now,
      usageDetails,
      costDetails,
      metadata: {
        latencyMs,
        costUsd: cost > 0 ? cost : undefined,
        cacheCreationTokens: usage.cache_creation_input_tokens || 0,
        cacheReadTokens: usage.cache_read_input_tokens || 0,
      },
    });

    // Serverless delivery: on Netlify/OpenNext the Lambda is frozen the instant
    // the HTTP response returns, so a fire-and-forget flush() (which only
    // SCHEDULES the batch send) drops any in-flight events. Await flushAsync()
    // so the trace is actually on the wire before this resolves — the documented
    // serverless pattern. Best-effort: a flush failure must not lose the
    // already-created trace id we return, so it gets its own try/catch.
    try {
      await lf.flushAsync();
    } catch (flushErr) {
      console.warn('Langfuse flushAsync failed (non-fatal):', (flushErr as Error).message);
    }
    return trace.id;
  } catch (err) {
    console.error('Langfuse logging failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// logUsageToDb — persist to llm_usage_logs table
// ---------------------------------------------------------------------------
export async function logUsageToDb(
  projectId: string,
  skillId: string | null,
  step: string | null,
  provider: string,
  model: string | null,
  usage: TokenUsage,
  cost: number,
  latencyMs: number,
): Promise<void> {
  try {
    const id = generateId('usg');
    await run(
      `INSERT INTO llm_usage_logs
        (id, project_id, skill_id, step, provider, model,
         input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
         total_cost_usd, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      projectId,
      skillId,
      step,
      provider,
      model,
      usage.input_tokens || 0,
      usage.output_tokens || 0,
      usage.cache_creation_input_tokens || 0,
      usage.cache_read_input_tokens || 0,
      cost,
      latencyMs,
      new Date().toISOString(),
    );
  } catch (err) {
    // Telemetry should never break the main flow
    console.error('Failed to log LLM usage:', err);
  }

  // STRICT BILLING (founder decision 2026-06-26): "1 message = 1 credit,
  // everything else is free." A chat message's ONLY credit charge is the flat
  // debitCredits('chat_message') in the chat route — the sole writer to the
  // per-USER credit pool (user_budgets). logUsageToDb is therefore
  // OBSERVATIONAL for that pool (exactly like recordUsage): it accumulates the
  // real token cost into project_budgets (the /usage analytics page +
  // per-project reconciliation) and logs the row above, but it must NOT touch
  // user_budgets.
  //
  // History — why this used to write user_budgets and why it no longer does:
  //   - pre-2026-06-04 it touched neither ledger (undercounted ~4x);
  //   - then project_budgets only;
  //   - 2026-06-14 ALSO user_budgets, when the per-user pool became the
  //     authoritative credit source;
  //   - 2026-06-26 strict billing made recordUsage observational, but this
  //     path was missed — so chat double-charged (flat $0.20 from debitCredits
  //     PLUS the real token cost here), making a message cost ~2+ credits
  //     instead of 1 and scaling credits with usage. Removed the user-pool
  //     write so the flat per-message debit is the only thing that moves it.
  //
  // Dynamic import to avoid a circular dep (cost-meter ← db ← telemetry).
  // Wrapped in try/catch independently because budget accumulation must NEVER
  // break the chat stream — better an undercount than a crashed turn.
  try {
    if (cost > 0) {
      const periodMonth = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
      const { upsertMonthlyBudget } = await import('@/lib/cost-meter');
      // Per-project $ accumulator only (usage page + per-project
      // reconciliation). NOT the per-user credit pool — that is moved solely by
      // debitCredits('chat_message') at exactly 1 credit per message.
      await upsertMonthlyBudget(projectId, periodMonth, cost);
    }
  } catch (err) {
    console.error('Failed to accumulate budget from logUsageToDb:', err);
  }
}


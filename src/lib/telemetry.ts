import { Langfuse } from 'langfuse';
import { run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { MODEL_CONFIG } from './llm/models';

// ---------------------------------------------------------------------------
// Langfuse — lazy-init so the app runs fine without credentials
// ---------------------------------------------------------------------------
let _langfuse: Langfuse | null = null;

function getLangfuse(): Langfuse | null {
  if (!process.env.LANGFUSE_SECRET_KEY) return null;
  if (!_langfuse) {
    _langfuse = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY || '',
      secretKey: process.env.LANGFUSE_SECRET_KEY || '',
      baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
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
  // 'openclaw' kept for backward compat with any legacy rows.
  provider: 'anthropic' | 'openai' | 'openclaw' | 'openrouter';
  model?: string;
}

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// ---------------------------------------------------------------------------
// traceLLMCall — wraps an async fn with Langfuse trace + local logging
// ---------------------------------------------------------------------------
export async function traceLLMCall<T>(
  ctx: TelemetryContext,
  fn: () => Promise<{ result: T; usage?: TokenUsage }>,
): Promise<T> {
  const start = Date.now();
  const lf = getLangfuse();

  const trace = lf?.trace({
    name: ctx.step || 'llm-call',
    userId: ctx.projectId,
    sessionId: ctx.skillId || ctx.step || 'default',
    metadata: {
      projectId: ctx.projectId,
      skillId: ctx.skillId,
      provider: ctx.provider,
      model: ctx.model,
    },
  });

  try {
    const { result, usage } = await fn();
    const latencyMs = Date.now() - start;
    const cost = usage ? estimateCost(ctx.provider, ctx.model || '', usage) : 0;

    if (trace && usage) {
      trace.update({
        output: typeof result === 'string' ? result.slice(0, 500) : undefined,
        metadata: {
          usage,
          cost,
          latencyMs,
        },
      });
    }

    await logUsageToDb(
      ctx.projectId,
      ctx.skillId || null,
      ctx.step || null,
      ctx.provider,
      ctx.model || null,
      usage || {},
      cost,
      latencyMs,
    );

    return result;
  } catch (err) {
    if (trace) {
      trace.update({
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }
    throw err;
  }
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
// logToLangfuse — standalone Langfuse trace with full cost/model/token tracking
// ---------------------------------------------------------------------------
export function logToLangfuse(
  ctx: TelemetryContext,
  usage: TokenUsage,
  cost: number,
  latencyMs: number,
  input?: string,
  output?: string,
): void {
  try {
    const lf = getLangfuse();
    if (!lf) return;

    const now = new Date();
    const startTime = new Date(now.getTime() - latencyMs);

    // Map model names to Langfuse-recognized canonical IDs. Auto-register
    // OpenRouter slugs from MODEL_CONFIG so adding a model in models.ts is
    // sufficient — no manual sync needed here.
    const modelMap: Record<string, string> = {
      'sonnet': 'claude-sonnet-4-20250514',
      'claude-sonnet-4': 'claude-sonnet-4-20250514',
    };
    for (const cfg of Object.values(MODEL_CONFIG)) {
      modelMap[cfg.openrouterId] = cfg.id;
    }
    const langfuseModel = modelMap[ctx.model || ''] || ctx.model || 'unknown';

    const promptTokens = usage.input_tokens || 0;
    const completionTokens = usage.output_tokens || 0;
    const totalTokens = promptTokens + completionTokens;

    const trace = lf.trace({
      name: `${ctx.provider}/${ctx.step || 'chat'}`,
      userId: ctx.projectId,
      sessionId: `${ctx.projectId}-${ctx.step || 'chat'}`,
      input: input?.slice(0, 2000),
      output: output?.slice(0, 2000),
      metadata: {
        projectId: ctx.projectId,
        skillId: ctx.skillId,
        provider: ctx.provider,
      },
    });

    // Generation — this is what Langfuse uses for cost/token/model display
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
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      // Langfuse v3 dropped `calculatedTotalCost` from the top-level
      // generation signature; keep cost visible in metadata instead so
      // dashboards that key off `metadata.costUsd` still work.
      metadata: {
        latencyMs,
        costUsd: cost > 0 ? cost : undefined,
        cacheCreationTokens: usage.cache_creation_input_tokens || 0,
        cacheReadTokens: usage.cache_read_input_tokens || 0,
      },
    });

    lf.flush();
  } catch (err) {
    console.error('Langfuse logging failed:', err);
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
}

/** @deprecated Use logUsageToDb instead */
export const logUsageToSQLite = logUsageToDb;

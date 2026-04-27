import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { pickModel, type TaskLabel } from './router';
import {
  estimateCost,
  logToLangfuse,
  logUsageToSQLite,
  type TokenUsage,
} from '@/lib/telemetry';

// Lazy-init: avoid crashing at import time when keys aren't set (gateway mode)
let _openai: OpenAI | null = null;
let _anthropic: Anthropic | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'unused' });
  }
  return _openai;
}

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'unused' });
  }
  return _anthropic;
}

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

/**
 * Optional observability context for chat/chatJSON/chatJSONByTask.
 *
 * When provided, the wrapper captures the underlying SDK response's token
 * usage, computes cost via estimateCost(), and mirrors the call into both
 * Langfuse (for cross-project traces + dashboards) and llm_usage_logs (for
 * the monthly budget meter). Omit to preserve the legacy fire-and-forget
 * behavior (no trace emitted — keeps infrastructure/tests quiet).
 *
 * Passing telemetry is safe in all environments: logToLangfuse() no-ops
 * when LANGFUSE_SECRET_KEY is absent, and logUsageToSQLite() swallows any
 * DB failure rather than breaking the calling flow.
 */
export interface LLMTelemetry {
  project_id: string;
  /** Short label for which skill or monitor caused this call. */
  skill_id?: string;
  /** Freeform step label (e.g. 'monitor.dedup.classify'). */
  step?: string;
}

/** Internal result of a single LLM round-trip — always includes usage. */
interface ChatResult {
  text: string;
  usage: TokenUsage;
  provider: 'anthropic' | 'openai' | 'openrouter';
  model: string;
  latency_ms: number;
}

async function chatInternal(
  messages: Message[],
  provider: string,
  temperature: number,
  maxTokens: number,
  model?: string,
): Promise<ChatResult> {
  const start = Date.now();

  if (provider === 'anthropic') {
    const resolvedModel = model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const msgs = messages.filter((m) => m.role !== 'system');
    const response = await getAnthropic().messages.create({
      model: resolvedModel,
      system,
      messages: msgs as Anthropic.MessageParam[],
      temperature,
      max_tokens: maxTokens,
    });
    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const u = response.usage;
    const uAny = u as unknown as Record<string, number>;
    return {
      text,
      usage: {
        input_tokens: u?.input_tokens ?? 0,
        output_tokens: u?.output_tokens ?? 0,
        cache_creation_input_tokens: uAny?.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: uAny?.cache_read_input_tokens ?? 0,
      },
      provider: 'anthropic',
      model: resolvedModel,
      latency_ms: Date.now() - start,
    };
  }

  // provider === 'openai' | 'openrouter' — both speak the OpenAI chat.completions
  // wire format. We don't inject a separate client for openrouter here (that's
  // a pre-existing gap tracked elsewhere); telemetry plumbing only needs the
  // provider label for Langfuse/DB rows.
  const resolvedModel = model || process.env.OPENAI_MODEL || 'gpt-4o';
  const response = await getOpenAI().chat.completions.create({
    model: resolvedModel,
    messages,
    temperature,
    max_tokens: maxTokens,
  });
  const text = response.choices[0]?.message?.content || '';
  const u = response.usage;
  return {
    text,
    usage: {
      input_tokens: u?.prompt_tokens ?? 0,
      output_tokens: u?.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    provider: provider === 'openrouter' ? 'openrouter' : 'openai',
    model: resolvedModel,
    latency_ms: Date.now() - start,
  };
}

/**
 * Fire-and-forget: Langfuse trace + llm_usage_logs row for one LLM round-trip.
 *
 * Both primitives are defensive (no-op on missing credentials / best-effort
 * SQLite writes), so failures here must never bubble up into the caller's
 * control flow — the LLM response has already been returned to them.
 */
function emitTelemetry(telemetry: LLMTelemetry | undefined, r: ChatResult): void {
  if (!telemetry) return;

  // estimateCost() expects 'anthropic' | 'openai' | 'openclaw' | 'openrouter'.
  // ChatResult.provider is already in that shape.
  const cost = estimateCost(r.provider, r.model, r.usage);

  try {
    logToLangfuse(
      {
        projectId: telemetry.project_id,
        skillId: telemetry.skill_id,
        step: telemetry.step || 'llm-call',
        provider: r.provider,
        model: r.model,
      },
      r.usage,
      cost,
      r.latency_ms,
    );
  } catch (err) {
    console.warn('[llm] Langfuse trace failed (non-fatal):', (err as Error).message);
  }

  try {
    logUsageToSQLite(
      telemetry.project_id,
      telemetry.skill_id || null,
      telemetry.step || null,
      r.provider,
      r.model,
      r.usage,
      cost,
      r.latency_ms,
    );
  } catch (err) {
    console.warn('[llm] llm_usage_logs insert failed (non-fatal):', (err as Error).message);
  }
}

export async function chat(
  messages: Message[],
  provider = 'openai',
  temperature = 0.7,
  maxTokens = 4096,
  model?: string,
  telemetry?: LLMTelemetry,
): Promise<string> {
  const r = await chatInternal(messages, provider, temperature, maxTokens, model);
  emitTelemetry(telemetry, r);
  return r.text;
}

export async function chatJSON<T = Record<string, unknown>>(
  messages: Message[],
  provider = 'openai',
  temperature = 0.3,
  model?: string,
  telemetry?: LLMTelemetry,
): Promise<T> {
  const r = await chatInternal(messages, provider, temperature, 4096, model);
  emitTelemetry(telemetry, r);
  let cleaned = r.text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '');
  return JSON.parse(cleaned.trim());
}

/**
 * Task-labeled chatJSON. The router picks provider + model based on the task's
 * complexity tier (see src/lib/llm/router.ts). Use this for any new call site
 * where you'd otherwise pass a hardcoded provider.
 *
 * Pass `telemetry` with the project_id (and optionally skill_id / step) so
 * the call shows up in Langfuse + llm_usage_logs + the monthly budget meter.
 *
 * Example:
 *   const result = await chatJSONByTask<ScoreResult>(messages, 'scoring', 0.3, {
 *     project_id: projectId,
 *     step: 'scoring',
 *     skill_id: 'scoring',
 *   });
 */
export async function chatJSONByTask<T = Record<string, unknown>>(
  messages: Message[],
  task: TaskLabel | string,
  temperature = 0.3,
  telemetry?: LLMTelemetry,
): Promise<T> {
  const { provider, model } = pickModel(task);
  return chatJSON<T>(messages, provider, temperature, model, telemetry);
}

export interface LLMUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export async function chatWithUsage(
  messages: Message[],
  provider = 'openai',
  temperature = 0.7,
  maxTokens = 4096,
  telemetry?: LLMTelemetry,
): Promise<{ text: string; usage: LLMUsage }> {
  const r = await chatInternal(messages, provider, temperature, maxTokens);
  emitTelemetry(telemetry, r);
  return { text: r.text, usage: r.usage as LLMUsage };
}

export async function* chatStream(
  messages: Message[],
  provider = 'openai',
  temperature = 0.7,
  maxTokens = 4096,
): AsyncGenerator<string> {
  if (provider === 'anthropic') {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const msgs = messages.filter((m) => m.role !== 'system');
    const stream = getAnthropic().messages.stream({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      system,
      messages: msgs as Anthropic.MessageParam[],
      temperature,
      max_tokens: maxTokens,
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
    return;
  }

  const stream = await getOpenAI().chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {yield delta;}
  }
}

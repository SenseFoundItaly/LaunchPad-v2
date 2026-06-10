import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { pickModel, type TaskLabel } from './router';
import { recordUsage } from '@/lib/cost-meter';
import { estimateCost } from '@/lib/telemetry';

// Lazy-init: avoid crashing at import time when keys aren't set (gateway mode)
let _openai: OpenAI | null = null;
let _anthropic: Anthropic | null = null;
let _openrouter: OpenAI | null = null;

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

function getOpenAI(apiKeyOverride?: string): OpenAI {
  if (apiKeyOverride) {
    return new OpenAI({ apiKey: apiKeyOverride });
  }
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'unused' });
  }
  return _openai;
}

// OpenRouter speaks OpenAI's REST shape, so we reuse the OpenAI SDK with a
// different baseURL + key. Without this, chatJSONByTask + the chat-route
// fallback path with provider='openrouter' silently hit api.openai.com with
// an OpenRouter-namespaced slug (e.g. "anthropic/claude-sonnet-4.6") and 400.
function getOpenRouter(apiKeyOverride?: string): OpenAI {
  if (apiKeyOverride) {
    return new OpenAI({ apiKey: apiKeyOverride, baseURL: OPENROUTER_BASE_URL });
  }
  if (!_openrouter) {
    _openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY || 'unused',
      baseURL: OPENROUTER_BASE_URL,
    });
  }
  return _openrouter;
}

function getAnthropic(apiKeyOverride?: string): Anthropic {
  if (apiKeyOverride) {
    return new Anthropic({ apiKey: apiKeyOverride });
  }
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'unused' });
  }
  return _anthropic;
}

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

/** Per-request overrides for BYOK. */
export interface UserKeyOverride {
  provider: 'anthropic' | 'openai' | 'openrouter';
  apiKey: string;
}

export async function chat(
  messages: Message[],
  provider = 'openai',
  temperature = 0.7,
  maxTokens = 4096,
  model?: string,
  userKey?: UserKeyOverride,
): Promise<string> {
  const { text } = await chatWithUsage(messages, provider, temperature, maxTokens, model, userKey);
  return text;
}

export async function chatJSON<T = Record<string, unknown>>(
  messages: Message[],
  provider = 'openai',
  temperature = 0.3,
  model?: string,
): Promise<T> {
  const raw = await chat(messages, provider, temperature, 4096, model);
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '');
  return JSON.parse(cleaned.trim());
}

/**
 * Task-labeled chatJSON. The router picks provider + model based on the task's
 * complexity tier (see src/lib/llm/router.ts). Use this for any new call site
 * where you'd otherwise pass a hardcoded provider.
 *
 * When `opts.projectId` is provided, token usage is recorded via recordUsage()
 * which handles both the DB log row and the Langfuse trace.
 *
 * When `opts.userKey` is provided (BYOK), the per-request API key is used
 * instead of the global env var. Usage is still logged for the project but
 * tagged with key_source='user'.
 *
 * Example:
 *   const result = await chatJSONByTask<ScoreResult>(messages, 'scoring', { projectId });
 *   // routes to balanced tier (Sonnet 4.6) by default.
 */
export async function chatJSONByTask<T = Record<string, unknown>>(
  messages: Message[],
  task: TaskLabel | string,
  opts?: { projectId?: string; temperature?: number; userKey?: UserKeyOverride },
): Promise<T> {
  const { provider, model, maxTokens } = pickModel(task);
  const startedAt = Date.now();
  const { text: raw, usage } = await chatWithUsage(
    messages, provider, opts?.temperature ?? 0.3, maxTokens, model, opts?.userKey,
  );
  const latencyMs = Date.now() - startedAt;

  if (opts?.projectId) {
    // Prefer OpenRouter's provider-reported cost when present (matches
    // billing exactly). When absent (OpenAI / Anthropic direct), fall back
    // to the PRICING-table estimate so the meter still records something.
    // Shape matches cost-meter.extractCost: it looks for usage.cost.total.
    const costUsd = typeof usage.cost_usd === 'number'
      ? usage.cost_usd
      : estimateCost(provider, model, {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_creation_input_tokens: usage.cache_creation_input_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens,
        });
    recordUsage({
      project_id: opts.projectId,
      step: task,
      provider,
      model,
      usage: {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cacheCreation: usage.cache_creation_input_tokens,
        cacheRead: usage.cache_read_input_tokens,
        cost: { total: costUsd },
      } as any,
      latency_ms: latencyMs,
      ...(opts?.userKey ? { key_source: 'user' } : {}),
    }).catch(err => console.warn(`[${task}] recordUsage failed:`, (err as Error).message));
  }

  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '');
  return JSON.parse(cleaned.trim());
}

export interface LLMUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  /**
   * Provider-reported cost in USD, when available. OpenRouter returns this
   * directly on every response (`usage.cost`); Anthropic + OpenAI do not.
   * When present, callers should prefer it over estimateCost() since it
   * matches the actual invoice line.
   */
  cost_usd?: number;
}

export async function chatWithUsage(
  messages: Message[],
  provider = 'openai',
  temperature = 0.7,
  maxTokens = 4096,
  model?: string,
  userKey?: UserKeyOverride,
): Promise<{ text: string; usage: LLMUsage }> {
  // Resolve the API key: user's BYOK key takes priority over env var.
  const anthropicKey = userKey?.provider === 'anthropic' ? userKey.apiKey : undefined;
  const openaiKey = userKey?.provider === 'openai' ? userKey.apiKey : undefined;
  const openrouterKey = userKey?.provider === 'openrouter' ? userKey.apiKey : undefined;

  if (provider === 'anthropic') {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const msgs = messages.filter((m) => m.role !== 'system');
    const response = await getAnthropic(anthropicKey).messages.create({
      model: model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      system,
      messages: msgs as Anthropic.MessageParam[],
      temperature,
      max_tokens: maxTokens,
    });
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const u = response.usage;
    return {
      text,
      usage: {
        input_tokens: u.input_tokens ?? 0,
        output_tokens: u.output_tokens ?? 0,
        cache_creation_input_tokens: (u as unknown as Record<string, number>).cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: (u as unknown as Record<string, number>).cache_read_input_tokens ?? 0,
      },
    };
  }

  // BYOK with provider='openrouter' should be honored even if the caller
  // passed provider='openai' (BYOK selection is the source of truth for
  // where the key works). Same for env: when OPENROUTER_API_KEY is the only
  // gateway configured, router.ts already returns provider='openrouter'.
  const useOpenRouter = provider === 'openrouter' || userKey?.provider === 'openrouter';
  const client = useOpenRouter ? getOpenRouter(openrouterKey) : getOpenAI(openaiKey);
  // OpenRouter wants the namespaced slug (e.g. "anthropic/claude-sonnet-4.6");
  // for OpenAI keep gpt-4o as the fallback. Router-provided `model` overrides.
  const resolvedModel = model
    || (useOpenRouter
      ? process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.6'
      : process.env.OPENAI_MODEL || 'gpt-4o');
  const response = await client.chat.completions.create({
    model: resolvedModel,
    messages,
    temperature,
    max_tokens: maxTokens,
  });
  const text = response.choices[0].message.content || '';
  const u = response.usage;
  // OpenRouter mirrors Anthropic's cache token fields under a non-standard
  // `prompt_tokens_details.cached_tokens`; carry it through so cache hits
  // show up in llm_usage_logs.cache_read_tokens for Sonnet/Haiku via OR.
  const cachedTokens = (u as unknown as { prompt_tokens_details?: { cached_tokens?: number } })
    ?.prompt_tokens_details?.cached_tokens ?? 0;
  // OpenRouter's authoritative cost (USD). Matches billing — preferred over
  // estimateCost() when present. Plain OpenAI doesn't return this; leave
  // undefined so callers fall back to PRICING-table estimation.
  const providerCost = (u as unknown as { cost?: number })?.cost;
  return {
    text,
    usage: {
      input_tokens: u?.prompt_tokens ?? 0,
      output_tokens: u?.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: cachedTokens,
      ...(typeof providerCost === 'number' ? { cost_usd: providerCost } : {}),
    },
  };
}

export async function* chatStream(
  messages: Message[],
  provider = 'openai',
  temperature = 0.7,
  maxTokens = 4096,
  userKey?: UserKeyOverride,
): AsyncGenerator<string> {
  const anthropicKey = userKey?.provider === 'anthropic' ? userKey.apiKey : undefined;
  const openaiKey = userKey?.provider === 'openai' ? userKey.apiKey : undefined;
  const openrouterKey = userKey?.provider === 'openrouter' ? userKey.apiKey : undefined;

  if (provider === 'anthropic') {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const msgs = messages.filter((m) => m.role !== 'system');
    const stream = getAnthropic(anthropicKey).messages.stream({
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

  const useOpenRouter = provider === 'openrouter' || userKey?.provider === 'openrouter';
  const client = useOpenRouter ? getOpenRouter(openrouterKey) : getOpenAI(openaiKey);
  const resolvedModel = useOpenRouter
    ? process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.6'
    : process.env.OPENAI_MODEL || 'gpt-4o';
  const stream = await client.chat.completions.create({
    model: resolvedModel,
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

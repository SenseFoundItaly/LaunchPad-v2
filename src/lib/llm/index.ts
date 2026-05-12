import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { pickModel, type TaskLabel } from './router';
import { recordUsage } from '@/lib/cost-meter';

// Lazy-init: avoid crashing at import time when keys aren't set (gateway mode)
let _openai: OpenAI | null = null;
let _anthropic: Anthropic | null = null;

function getOpenAI(apiKeyOverride?: string): OpenAI {
  if (apiKeyOverride) {
    // Per-request client for BYOK — not cached (different users, different keys).
    return new OpenAI({ apiKey: apiKeyOverride });
  }
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'unused' });
  }
  return _openai;
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
  const openaiKey = (userKey?.provider === 'openai' || userKey?.provider === 'openrouter')
    ? userKey.apiKey : undefined;

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

  const response = await getOpenAI(openaiKey).chat.completions.create({
    model: model || process.env.OPENAI_MODEL || 'gpt-4o',
    messages,
    temperature,
    max_tokens: maxTokens,
  });
  const text = response.choices[0].message.content || '';
  const u = response.usage;
  return {
    text,
    usage: {
      input_tokens: u?.prompt_tokens ?? 0,
      output_tokens: u?.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
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
  const openaiKey = (userKey?.provider === 'openai' || userKey?.provider === 'openrouter')
    ? userKey.apiKey : undefined;

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

  const stream = await getOpenAI(openaiKey).chat.completions.create({
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

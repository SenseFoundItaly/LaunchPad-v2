import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

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

export async function chat(
  messages: Message[],
  provider = 'openai',
  temperature = 0.7,
  maxTokens = 4096,
): Promise<string> {
  if (provider === 'anthropic') {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const msgs = messages.filter((m) => m.role !== 'system');
    const response = await getAnthropic().messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      system,
      messages: msgs as Anthropic.MessageParam[],
      temperature,
      max_tokens: maxTokens,
    });
    return response.content[0].type === 'text' ? response.content[0].text : '';
  }

  const response = await getOpenAI().chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    messages,
    temperature,
    max_tokens: maxTokens,
  });
  return response.choices[0].message.content || '';
}

export async function chatJSON<T = Record<string, unknown>>(
  messages: Message[],
  provider = 'openai',
  temperature = 0.3,
): Promise<T> {
  const raw = await chat(messages, provider, temperature);
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
): Promise<{ text: string; usage: LLMUsage }> {
  if (provider === 'anthropic') {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const msgs = messages.filter((m) => m.role !== 'system');
    const response = await getAnthropic().messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
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
        cache_creation_input_tokens: (u as Record<string, number>).cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: (u as Record<string, number>).cache_read_input_tokens ?? 0,
      },
    };
  }

  const response = await getOpenAI().chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
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

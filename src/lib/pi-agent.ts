import { Agent } from '@mariozechner/pi-agent-core';
import { streamSimple, getModel, getEnvApiKey } from '@mariozechner/pi-ai';
import type { AssistantMessageEvent, Usage } from '@mariozechner/pi-ai';

const DEFAULT_PROVIDER = (process.env.PI_PROVIDER || 'anthropic') as 'anthropic' | 'openai';
const DEFAULT_MODEL_ID = process.env.PI_MODEL || (DEFAULT_PROVIDER === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o');

function resolveModel() {
  return getModel(DEFAULT_PROVIDER as any, DEFAULT_MODEL_ID as any);
}

export interface RunAgentOptions {
  sessionId?: string;
  systemPrompt?: string;
  timeout?: number;
}

export interface RunAgentResult {
  text: string;
  usage?: Usage;
}

/** Run Pi Agent and collect full response (non-streaming). */
export async function runAgent(prompt: string, options: RunAgentOptions = {}): Promise<RunAgentResult> {
  const model = resolveModel();
  const agent = new Agent({
    streamFn: streamSimple,
    sessionId: options.sessionId,
    getApiKey: (provider) => getEnvApiKey(provider),
  });

  agent.state.model = model;
  if (options.systemPrompt) {
    agent.state.systemPrompt = options.systemPrompt;
  }

  let fullText = '';
  let lastUsage: Usage | undefined;

  const timeout = options.timeout || 120000;
  const timer = setTimeout(() => agent.abort(), timeout);

  agent.subscribe((event) => {
    if (event.type === 'message_update') {
      const evt = event.assistantMessageEvent;
      if (evt.type === 'text_delta') {
        fullText += evt.delta;
      }
    }
    if (event.type === 'message_end' && event.message && 'usage' in event.message) {
      lastUsage = (event.message as any).usage;
    }
  });

  try {
    await agent.prompt(prompt);
    await agent.waitForIdle();
  } finally {
    clearTimeout(timer);
  }

  return { text: fullText, usage: lastUsage };
}

/**
 * Run Pi Agent with SSE streaming. Returns a ReadableStream suitable for
 * Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }).
 */
export function runAgentStream(prompt: string, options: RunAgentOptions = {}): {
  stream: ReadableStream;
  cleanup: () => void;
} {
  const model = resolveModel();
  const encoder = new TextEncoder();
  let agent: Agent;

  const timeout = options.timeout || 120000;
  let timer: ReturnType<typeof setTimeout>;

  const stream = new ReadableStream({
    start(controller) {
      agent = new Agent({
        streamFn: streamSimple,
        sessionId: options.sessionId,
        getApiKey: (provider) => getEnvApiKey(provider),
      });

      agent.state.model = model;
      if (options.systemPrompt) {
        agent.state.systemPrompt = options.systemPrompt;
      }

      timer = setTimeout(() => agent.abort(), timeout);

      let fullText = '';
      let lastUsage: Usage | undefined;

      agent.subscribe((event) => {
        if (event.type === 'message_update') {
          const evt = event.assistantMessageEvent;
          if (evt.type === 'text_delta' && evt.delta) {
            fullText += evt.delta;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ content: evt.delta })}\n\n`)
            );
          }
        }
        if (event.type === 'message_end' && event.message && 'usage' in event.message) {
          lastUsage = (event.message as any).usage;
        }
        if (event.type === 'agent_end') {
          clearTimeout(timer);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              done: true,
              fullText,
              usage: lastUsage ? {
                input_tokens: lastUsage.input,
                output_tokens: lastUsage.output,
                total_tokens: lastUsage.totalTokens,
                cost: lastUsage.cost?.total,
              } : undefined,
            })}\n\n`)
          );
          controller.close();
        }
      });

      agent.prompt(prompt).catch((err) => {
        clearTimeout(timer);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`)
        );
        controller.close();
      });
    },
    cancel() {
      clearTimeout(timer);
      agent?.abort();
    },
  });

  return {
    stream,
    cleanup: () => {
      clearTimeout(timer);
      agent?.abort();
    },
  };
}

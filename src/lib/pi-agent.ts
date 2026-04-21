import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import { streamSimple, getModel, getEnvApiKey } from '@mariozechner/pi-ai';
import type { Message, Usage } from '@mariozechner/pi-ai';
import { join } from 'path';
import { mkdirSync, readFileSync, appendFileSync, existsSync } from 'fs';
import { getTools } from './pi-tools';

const DEFAULT_PROVIDER = (process.env.PI_PROVIDER || 'anthropic') as 'anthropic' | 'openai';
const DEFAULT_MODEL_ID = process.env.PI_MODEL || (DEFAULT_PROVIDER === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o');
const SESSIONS_DIR = process.env.LAUNCHPAD_SESSIONS_DIR || join(process.env.HOME || '/tmp', '.launchpad', 'sessions');

function resolveModel() {
  return getModel(DEFAULT_PROVIDER as any, DEFAULT_MODEL_ID as any);
}

// ─── Lightweight JSONL session persistence ───
// Compatible with Pi's session format but no heavy deps

interface SessionEntry {
  role: string;
  content: unknown;
  timestamp: number;
  usage?: unknown;
}

function sessionPath(sessionId: string): string {
  const dir = join(SESSIONS_DIR, sessionId);
  mkdirSync(dir, { recursive: true });
  return join(dir, 'session.jsonl');
}

function loadSession(sessionId: string): AgentMessage[] {
  const path = sessionPath(sessionId);
  if (!existsSync(path)) return [];

  try {
    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
    const messages: AgentMessage[] = [];
    for (const line of lines) {
      const entry: SessionEntry = JSON.parse(line);
      if (entry.role === 'user' || entry.role === 'assistant' || entry.role === 'toolResult') {
        messages.push(entry as unknown as AgentMessage);
      }
    }
    return messages;
  } catch {
    return [];
  }
}

function appendToSession(sessionId: string, message: AgentMessage) {
  const path = sessionPath(sessionId);
  appendFileSync(path, JSON.stringify(message) + '\n');
}

export interface RunAgentOptions {
  sessionId?: string;
  systemPrompt?: string;
  timeout?: number;
  tools?: boolean;
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
  if (options.tools !== false) {
    agent.state.tools = getTools();
  }

  // Restore conversation history
  if (options.sessionId) {
    const prior = loadSession(options.sessionId);
    if (prior.length > 0) {
      agent.state.messages = prior;
    }
  }

  let fullText = '';
  let lastUsage: Usage | undefined;

  const timeout = options.timeout || 120000;
  const timer = setTimeout(() => agent.abort(), timeout);

  // Persist user message
  const userMsg: Message = { role: 'user', content: prompt, timestamp: Date.now() };
  if (options.sessionId) appendToSession(options.sessionId, userMsg as AgentMessage);

  agent.subscribe((event) => {
    if (event.type === 'message_update') {
      const evt = event.assistantMessageEvent;
      if (evt.type === 'text_delta') {
        fullText += evt.delta;
      }
    }
    if (event.type === 'message_end' && event.message) {
      if ('usage' in event.message) lastUsage = (event.message as any).usage;
      if (options.sessionId) appendToSession(options.sessionId, event.message);
    }
    if (event.type === 'turn_end' && event.toolResults && options.sessionId) {
      for (const tr of event.toolResults) {
        appendToSession(options.sessionId, tr as AgentMessage);
      }
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
 * Run Pi Agent with SSE streaming + session persistence.
 *
 * SSE events:
 * - { content: "..." }                    — text delta
 * - { tool_start: { name, args } }        — tool execution started
 * - { tool_end: { name, result } }        — tool execution finished
 * - { done: true, usage: {...} }          — agent finished
 * - { error: "..." }                      — error
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
      if (options.tools !== false) {
        agent.state.tools = getTools();
      }

      // Restore conversation history
      if (options.sessionId) {
        const prior = loadSession(options.sessionId);
        if (prior.length > 0) {
          agent.state.messages = prior;
        }
        // Persist user message
        const userMsg: Message = { role: 'user', content: prompt, timestamp: Date.now() };
        appendToSession(options.sessionId, userMsg as AgentMessage);
      }

      timer = setTimeout(() => agent.abort(), timeout);

      let fullText = '';
      let lastUsage: Usage | undefined;

      agent.subscribe((event) => {
        switch (event.type) {
          case 'message_update': {
            const evt = event.assistantMessageEvent;
            if (evt.type === 'text_delta' && evt.delta) {
              fullText += evt.delta;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content: evt.delta })}\n\n`)
              );
            }
            break;
          }

          case 'tool_execution_start': {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                tool_start: {
                  id: event.toolCallId,
                  name: event.toolName,
                  args: event.args,
                },
              })}\n\n`)
            );
            break;
          }

          case 'tool_execution_end': {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                tool_end: {
                  id: event.toolCallId,
                  name: event.toolName,
                  error: event.isError,
                },
              })}\n\n`)
            );
            break;
          }

          case 'message_end': {
            if (event.message && 'usage' in event.message) {
              lastUsage = (event.message as any).usage;
            }
            // Persist assistant message to session
            if (options.sessionId && event.message) {
              appendToSession(options.sessionId, event.message);
            }
            break;
          }

          case 'turn_end': {
            // Persist tool result messages
            if (options.sessionId && event.toolResults) {
              for (const tr of event.toolResults) {
                appendToSession(options.sessionId, tr as AgentMessage);
              }
            }
            break;
          }

          case 'agent_end': {
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
            break;
          }
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

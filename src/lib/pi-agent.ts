import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentMessage, AgentTool } from '@mariozechner/pi-agent-core';
import { streamSimple, getModel, getEnvApiKey } from '@mariozechner/pi-ai';
import type { Message, Usage } from '@mariozechner/pi-ai';
import { join } from 'path';
import { mkdirSync, readFileSync, appendFileSync, existsSync } from 'fs';
import { getTools } from './pi-tools';
import { pickModel, type TaskLabel } from './llm/router';

const DEFAULT_PROVIDER = (process.env.PI_PROVIDER || 'anthropic') as 'anthropic' | 'openai';
const DEFAULT_MODEL_ID = process.env.PI_MODEL || (DEFAULT_PROVIDER === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o');
const SESSIONS_DIR = process.env.LAUNCHPAD_SESSIONS_DIR || join(process.env.HOME || '/tmp', '.launchpad', 'sessions');

/**
 * Prompt caching note (Anthropic only):
 *
 * pi-ai automatically attaches `cache_control: {type: "ephemeral"}` to the
 * system prompt and the last user message. The TTL is controlled via the
 * `PI_CACHE_RETENTION` env var:
 *   - "short" (default) — 5 min TTL
 *   - "long" — 1 h TTL (recommended for cron contexts where multiple monitors
 *     run back-to-back for the same project against the same static prefix)
 *   - "none" — disables caching
 *
 * Observability: `llm_usage_logs.cache_read_tokens` is populated automatically
 * on cache hits. A healthy cache hit rate for the Monday cron is > 70% of
 * input tokens after the first monitor per founder.
 *
 * Source: node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js
 * (`resolveCacheRetention` + `getCacheControl`).
 */

/**
 * Resolve the concrete pi-ai Model object for this call.
 *
 * If a `task` label is provided, the router selects the model based on
 * task-complexity tier (see src/lib/llm/router.ts). Otherwise we fall back
 * to the globals `PI_PROVIDER` + `PI_MODEL` — preserving the pre-router
 * behavior for callers that haven't been retrofitted yet.
 */
function resolveModel(task?: TaskLabel) {
  if (task) {
    const { provider, model } = pickModel(task);
    return getModel(provider as any, model as any);
  }
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

function loadSession(sessionId: string, maxMessages?: number): AgentMessage[] {
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

    // Anthropic's API rejects (or silently returns empty) when conversation
    // history ends with an incomplete assistant turn:
    //   - tool_use block with no matching tool_result follow-up
    //   - empty content array (turn killed before any text/tool was produced)
    // Both happen when a stream is killed mid-turn. Prevent the next turn
    // from failing by trimming any trailing incomplete-assistant and its
    // preceding user message, so the agent retries from the last complete
    // (user, assistant) pair.
    while (messages.length > 0) {
      const last = messages[messages.length - 1] as { role?: string; content?: unknown };
      if (last.role !== 'assistant') break;

      const content = last.content;
      const isEmpty =
        content === undefined ||
        content === null ||
        (Array.isArray(content) && content.length === 0) ||
        (typeof content === 'string' && content.trim() === '');
      const contentStr = JSON.stringify(content ?? '');
      const hasUnpairedToolUse = contentStr.includes('tool_use');

      if (!isEmpty && !hasUnpairedToolUse) break;

      messages.pop();
      if (messages.length > 0 && (messages[messages.length - 1] as { role?: string }).role === 'user') {
        messages.pop();
      }
    }

    // After trimming incomplete assistant turns, also strip any trailing user
    // messages that were left orphaned. The SDK will re-add the user message
    // when the next turn runs, preventing consecutive-user-message rejections.
    while (messages.length > 0) {
      const last = messages[messages.length - 1] as { role?: string };
      if (last.role !== 'user') break;
      messages.pop();
    }

    // Sliding window: cap history to the most recent N messages to prevent
    // unbounded token growth on long conversations. Each message re-sent on
    // every tool roundtrip, so this compounds savings significantly.
    if (maxMessages && maxMessages > 0 && messages.length > maxMessages) {
      messages.splice(0, messages.length - maxMessages);
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
  /** Include the default generic tools (web_search, read_url, calculate). Default true. */
  tools?: boolean;
  /** Additional tools to merge in, e.g. project-scoped tools from makeProjectTools(projectId). */
  extraTools?: AgentTool[];
  /**
   * Task-complexity label. When set, the router selects the model tier
   * (cheap/balanced/premium) based on this task rather than reading
   * PI_PROVIDER + PI_MODEL globals. See src/lib/llm/router.ts.
   */
  task?: TaskLabel;
  /**
   * Hard cap on tool calls per turn. After this many tool_execution_start
   * events, the agent is aborted. Prevents runaway cost from agentic loops
   * that ignore the prompt-level "max 4 tool calls" instruction.
   * Default: 4.
   */
  maxToolCalls?: number;
  /**
   * Max conversation history messages to load from the session file.
   * Older messages are trimmed from the beginning to cap token growth.
   * Default: 12 (~6 user/assistant pairs).
   */
  maxHistoryMessages?: number;
}

export interface RunAgentResult {
  text: string;
  usage?: Usage;
}

/** Run Pi Agent and collect full response (non-streaming). */
export async function runAgent(prompt: string, options: RunAgentOptions = {}): Promise<RunAgentResult> {
  const model = resolveModel(options.task);
  const agent = new Agent({
    streamFn: streamSimple,
    sessionId: options.sessionId,
    getApiKey: (provider) => getEnvApiKey(provider),
    // Explicitly request parallel tool execution. With 3-4 web_search +
    // read_url calls in a research turn, sequential execution dominates
    // latency — parallel lets them all run concurrently and finalizes
    // results in source order.
    toolExecution: 'parallel',
  });

  agent.state.model = model;
  if (options.systemPrompt) {
    agent.state.systemPrompt = options.systemPrompt;
  }
  // Compose tool set: base generic tools (web_search, read_url, calculate)
  // plus any project-scoped tools from makeProjectTools(projectId).
  const baseTools = options.tools !== false ? getTools() : [];
  const extraTools = options.extraTools || [];
  if (baseTools.length > 0 || extraTools.length > 0) {
    agent.state.tools = [...baseTools, ...extraTools];
  }

  // Restore conversation history (with optional sliding window)
  if (options.sessionId) {
    const prior = loadSession(options.sessionId, options.maxHistoryMessages ?? 12);
    if (prior.length > 0) {
      agent.state.messages = prior;
    }
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
    // message_end fires for user, toolResult, and assistant messages in order.
    // Writing here is sufficient — turn_end would double-write toolResults.
    if (event.type === 'message_end' && event.message) {
      if ('usage' in event.message) lastUsage = (event.message as any).usage;
      if (options.sessionId) appendToSession(options.sessionId, event.message);
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
  const model = resolveModel(options.task);
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
      const baseToolsS = options.tools !== false ? getTools() : [];
      const extraToolsS = options.extraTools || [];
      if (baseToolsS.length > 0 || extraToolsS.length > 0) {
        agent.state.tools = [...baseToolsS, ...extraToolsS];
      }

      // Restore conversation history (trimmed to last valid complete turn,
      // capped to maxHistoryMessages to prevent unbounded token growth).
      // The SDK appends the user message and subsequent assistant turns itself —
      // do NOT call appendToSession here or the user message appears twice.
      if (options.sessionId) {
        const prior = loadSession(options.sessionId, options.maxHistoryMessages ?? 12);
        if (prior.length > 0) {
          agent.state.messages = prior;
        }
      }

      timer = setTimeout(() => agent.abort(), timeout);

      let fullText = '';
      let lastUsage: Usage | undefined;
      let toolCallCount = 0;
      const maxToolCalls = options.maxToolCalls ?? 8;

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
            toolCallCount++;
            if (toolCallCount > maxToolCalls) {
              console.warn(`[pi-agent] tool call limit reached (${maxToolCalls}), aborting agent`);
              agent.abort();
              break;
            }
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
            // message_end fires for user, toolResult, and assistant messages in order.
            // Writing here is sufficient — turn_end would double-write toolResults.
            if (options.sessionId && event.message) {
              appendToSession(options.sessionId, event.message);
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

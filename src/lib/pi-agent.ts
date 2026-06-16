import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentMessage, AgentTool } from '@mariozechner/pi-agent-core';
import { streamSimple, getModel, getEnvApiKey } from '@mariozechner/pi-ai';
import type { Message, Usage } from '@mariozechner/pi-ai';
import { join } from 'path';
import { mkdirSync, readFileSync, appendFileSync, existsSync, readdirSync, statSync, rmSync } from 'fs';
import { getTools } from './pi-tools';
import { pickModel, type TaskLabel } from './llm/router';
import { estimateCost } from './telemetry';

const DEFAULT_PROVIDER = (process.env.PI_PROVIDER || 'anthropic') as 'anthropic' | 'openai';
const DEFAULT_MODEL_ID = process.env.PI_MODEL || (DEFAULT_PROVIDER === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o');
const SESSIONS_DIR = process.env.LAUNCHPAD_SESSIONS_DIR || join(process.env.HOME || '/tmp', '.launchpad', 'sessions');

// ─── Stale session cleanup ───
// Runs once per process lifecycle. Deletes session directories with
// session.jsonl older than 30 days.
let _sessionsCleaned = false;
const STALE_SESSION_DAYS = 30;

function cleanStaleSessions() {
  if (_sessionsCleaned) return;
  _sessionsCleaned = true;
  try {
    if (!existsSync(SESSIONS_DIR)) return;
    const threshold = Date.now() - STALE_SESSION_DAYS * 24 * 60 * 60 * 1000;
    const dirs = readdirSync(SESSIONS_DIR);
    for (const dir of dirs) {
      const sessionFile = join(SESSIONS_DIR, dir, 'session.jsonl');
      try {
        if (!existsSync(sessionFile)) continue;
        const stat = statSync(sessionFile);
        if (stat.mtimeMs < threshold) {
          rmSync(join(SESSIONS_DIR, dir), { recursive: true, force: true });
        }
      } catch {
        // Skip individual dirs that fail — non-fatal.
      }
    }
  } catch (err) {
    console.warn('[pi-agent] stale session cleanup failed (non-fatal):', err);
  }
}

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

/**
 * Reseed a session's history from a durable source (the chat_messages thread,
 * passed in by the caller) when the local session file is empty or missing.
 *
 * WHY: the session JSONL lives on the serverless filesystem, which is EPHEMERAL
 * on Netlify — a deploy, cold start, or new instance wipes it. Without this the
 * agent loses ALL conversational memory mid-thread (observed in prod: the
 * founder answered a question and the agent "restarted" with a generic opener,
 * because loadSession returned []). chat_messages survives in the DB, so rebuild
 * the working session from it on a cache miss. No-op when the session already
 * has content, so it never clobbers a live conversation.
 */
export function seedSessionIfEmpty(
  sessionId: string,
  priorTurns: Array<{ role: string; content: string }>,
): void {
  if (!priorTurns?.length) return;
  const path = sessionPath(sessionId);
  try {
    if (existsSync(path) && readFileSync(path, 'utf-8').trim().length > 0) return;
  } catch {
    // Unreadable session file → fall through and (re)seed from the durable thread.
  }
  for (const t of priorTurns) {
    if ((t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim()) {
      appendToSession(sessionId, { role: t.role, content: t.content, timestamp: Date.now() } as unknown as AgentMessage);
    }
  }
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
   * that ignore the prompt-level "max 8 tool calls" instruction.
   * Default: 8.
   */
  maxToolCalls?: number;
  /**
   * Max conversation history messages to load from the session file.
   * Older messages are trimmed from the beginning to cap token growth.
   * Default: 12 (~6 user/assistant pairs).
   */
  maxHistoryMessages?: number;
}

/**
 * Accumulate per-message usage into a single Usage object. pi-agent-core's
 * `message_end` fires once per *assistant message* in the agent loop, and a
 * single turn often produces N assistant messages (initial → tool call →
 * tool result → next LLM call → ...). Each carries its OWN usage. Without
 * this accumulator the chat route ends up logging only the last sub-call's
 * tokens, drastically under-reporting input_tokens (observed 32× lower than
 * actual billing). The cost.total field is correctly summed by pi-ai across
 * sub-calls because it's authoritative for billing, but the per-token
 * fields require this client-side sum.
 */
function accumulateUsage(acc: Usage | undefined, incoming: unknown): Usage | undefined {
  if (!incoming || typeof incoming !== 'object') return acc;
  const u = incoming as Record<string, unknown>;
  if (!acc) {
    // First message — clone to avoid mutating pi-ai's state.
    const clone: Record<string, unknown> = {};
    for (const k of Object.keys(u)) {
      if (k === 'cost' && u.cost && typeof u.cost === 'object') {
        clone.cost = { ...(u.cost as Record<string, unknown>) };
      } else {
        clone[k] = u[k];
      }
    }
    return clone as unknown as Usage;
  }
  const a = acc as unknown as Record<string, unknown>;
  // Token fields — pi-ai's Usage interface (node_modules/@mariozechner/pi-ai/
  // dist/types.d.ts:111) has: input, output, cacheRead, cacheWrite, totalTokens.
  // Listing aliases too in case the provider adapter renames any of them.
  for (const k of ['input', 'inputTokens', 'input_tokens',
    'output', 'outputTokens', 'output_tokens',
    'cacheWrite', 'cacheCreation', 'cache_creation_tokens', 'cacheCreationInputTokens',
    'cacheRead', 'cache_read_tokens', 'cacheReadInputTokens',
    'totalTokens']) {
    const v = u[k];
    if (typeof v === 'number') a[k] = (typeof a[k] === 'number' ? (a[k] as number) : 0) + v;
  }
  // Cost — sum cost.total across all sub-calls.
  if (u.cost && typeof u.cost === 'object') {
    const incomingCost = u.cost as Record<string, unknown>;
    const accCost = (a.cost as Record<string, unknown>) || (a.cost = {});
    for (const k of Object.keys(incomingCost)) {
      const v = incomingCost[k];
      if (typeof v === 'number') {
        accCost[k] = (typeof accCost[k] === 'number' ? (accCost[k] as number) : 0) + v;
      }
    }
  }
  return acc;
}

export interface RunAgentResult {
  text: string;
  usage?: Usage;
}

/** Run Pi Agent and collect full response (non-streaming). */
export async function runAgent(prompt: string, options: RunAgentOptions = {}): Promise<RunAgentResult> {
  cleanStaleSessions();
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
      if ('usage' in event.message) {
        lastUsage = accumulateUsage(lastUsage, (event.message as any).usage);
      }
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
  cleanStaleSessions();
  const model = resolveModel(options.task);
  const encoder = new TextEncoder();
  let agent: Agent;

  const timeout = options.timeout || 120000;
  let timer: ReturnType<typeof setTimeout>;

  const stream = new ReadableStream({
    start(controller) {
      // Port note: the double-close guard (closed/safeEnqueue/safeClose) is
      // declared a few lines down — master's rework version is the superset
      // (adds safeEnqueue + fullText). The WIP's partial duplicate here was
      // dropped to avoid redeclaring the same block-scoped names.
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

      // Force-close on timeout. agent.abort() alone does NOT reliably make
      // pi-agent-core emit agent_end or reject the prompt promise, so the
      // SSE controller can stay open indefinitely (observed up to 54 min on
      // heavy turns). Emit a done event + close the controller from the
      // timer too, regardless of whether the agent cooperates.
      // Single source of truth for the controller's lifecycle. Once closed by
      // ANY path (timeout timer, agent_end, or prompt().catch) every later
      // enqueue/close no-ops instead of throwing "Invalid state: Controller is
      // already closed". Previously the timer raced the catch: the timer closed
      // the stream, then the aborted prompt rejected and the catch enqueued onto
      // the closed controller → unhandledRejection + a multi-minute hung POST.
      let closed = false;
      let fullText = '';
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try { controller.enqueue(chunk); } catch { closed = true; }
      };
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };

      timer = setTimeout(() => {
        console.warn(`[pi-agent] timeout (${timeout}ms) — aborting agent and force-closing stream`);
        try { agent.abort(); } catch { /* ignore */ }
        // Best-effort usage on timeout. OpenRouter (and the underlying
        // provider) charges for every token streamed BEFORE the abort, but
        // the timeout's done event historically carried no usage — so the
        // chat route's recordUsage logged $0.00 for the whole turn and we
        // under-counted real spend. Attach a usage object (same shape the
        // agent_end path emits) with a non-zero cost so the existing
        // recordUsage path bills the streamed-then-aborted tokens.
        let timeoutUsage: Record<string, unknown> | undefined;
        try {
          // Resolve the concrete model slug the same way the chat route's
          // flush does (pickModel), so estimateCost hits the right pricing row.
          const model = pickModel(options.task ?? 'chat').model;
          if (lastUsage) {
            // Partial usage WAS accumulated (one or more message_end events
            // fired before the abort). Reuse it, filling cost via estimateCost
            // when pi-ai didn't attach an authoritative cost.total.
            const u = lastUsage as unknown as Record<string, number | { total?: number } | undefined>;
            const partial = {
              input_tokens: (u.input as number) || 0,
              output_tokens: (u.output as number) || 0,
              cache_creation_input_tokens: (u.cacheWrite as number) || 0,
              cache_read_input_tokens: (u.cacheRead as number) || 0,
            };
            const existingCost = (u.cost as { total?: number } | undefined)?.total;
            const cost = (typeof existingCost === 'number' && existingCost > 0)
              ? existingCost
              : estimateCost('', model, partial);
            timeoutUsage = {
              ...partial,
              total_tokens: (u.totalTokens as number)
                || (partial.input_tokens + partial.output_tokens),
              cost,
              estimated: true,
            };
          } else {
            // No message_end fired before the abort — estimate from the text
            // we streamed (~4 chars/token) and the prompt + system prompt
            // length for the input side. Coarse, but non-zero beats $0.
            const outTok = Math.ceil((fullText.length || 0) / 4);
            const inChars = (prompt?.length || 0) + (options.systemPrompt?.length || 0);
            const inTok = Math.ceil(inChars / 4);
            const partial = {
              input_tokens: inTok,
              output_tokens: outTok,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            };
            timeoutUsage = {
              ...partial,
              total_tokens: inTok + outTok,
              cost: estimateCost('', model, partial),
              estimated: true,
            };
          }
        } catch {
          // Estimation failed — fall back to no usage rather than break the
          // timeout/close. Better $0 than a crash.
          timeoutUsage = undefined;
        }
        // WEAVE (port): emit the partial answer (master's fullText flush, so a
        // partial answer beats a blank "timed out" turn) AND best-effort usage
        // (WIP's $0-on-timeout fix) through the double-close-safe enqueue.
        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ done: true, timeout: true, fullText, usage: timeoutUsage })}\n\n`));
        safeClose();
      }, timeout);

      let lastUsage: Usage | undefined;
      let toolCallCount = 0;
      const maxToolCalls = options.maxToolCalls ?? 8;

      agent.subscribe((event) => {
        switch (event.type) {
          case 'message_update': {
            const evt = event.assistantMessageEvent;
            if (evt.type === 'text_delta' && evt.delta) {
              fullText += evt.delta;
              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify({ content: evt.delta })}\n\n`)
              );
            }
            break;
          }

          case 'tool_execution_start': {
            toolCallCount++;
            if (toolCallCount > maxToolCalls) {
              // FORCE SYNTHESIS instead of aborting. agent.abort() killed the
              // agent mid-loop, leaving turns with tool_results but no closing
              // artifacts (option-set, prose summary) — a Tier 0 violation
              // visible to founders as "agent did research then went silent".
              //
              // Stripping tools lets pi-agent-core continue its loop: the
              // LLM's next iteration sees no tools available and is forced
              // to respond with text + artifacts (which is exactly the
              // synthesis we want). This in-flight call still completes
              // because we don't abort.
              if (agent.state.tools && agent.state.tools.length > 0) {
                console.warn(`[pi-agent] tool call limit reached (${maxToolCalls}), forcing synthesis`);
                agent.state.tools = [];
              }
            }
            safeEnqueue(
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
            safeEnqueue(
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
              lastUsage = accumulateUsage(lastUsage, (event.message as any).usage);
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
            const u = lastUsage as unknown as Record<string, number | { total?: number } | undefined>;
            safeEnqueue(
              encoder.encode(`data: ${JSON.stringify({
                done: true,
                fullText,
                usage: lastUsage ? {
                  input_tokens: u.input as number,
                  output_tokens: u.output as number,
                  // pi-ai's Usage uses cacheWrite/cacheRead (see types.d.ts:111).
                  // Map to the column names llm_usage_logs expects.
                  cache_creation_input_tokens: (u.cacheWrite as number) || 0,
                  cache_read_input_tokens: (u.cacheRead as number) || 0,
                  total_tokens: u.totalTokens as number,
                  cost: (u.cost as { total?: number } | undefined)?.total,
                } : undefined,
              })}\n\n`)
            );
            safeClose();
            break;
          }
        }
      });

      agent.prompt(prompt).catch((err) => {
        clearTimeout(timer);
        // WEAVE (port): emit a done event carrying both the error message
        // (master) and whatever usage we accumulated before the failure
        // (WIP's $0-flake-turn fix), through the double-close-safe enqueue.
        // Without the usage, cost extraction sees no streamUsage.done and
        // records $0.00 — the pattern observed in e2e turns 5/6/7.
        const u = lastUsage as unknown as Record<string, number | { total?: number } | undefined> | undefined;
        safeEnqueue(
          encoder.encode(`data: ${JSON.stringify({
            done: true,
            error: err.message,
            usage: lastUsage && u ? {
              input_tokens: u.input as number,
              output_tokens: u.output as number,
              cache_creation_input_tokens: (u.cacheWrite as number) || 0,
              cache_read_input_tokens: (u.cacheRead as number) || 0,
              total_tokens: u.totalTokens as number,
              cost: (u.cost as { total?: number } | undefined)?.total,
            } : undefined,
          })}\n\n`)
        );
        safeClose();
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

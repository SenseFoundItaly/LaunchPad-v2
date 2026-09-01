import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentMessage, AgentTool } from '@mariozechner/pi-agent-core';
import { streamSimple, getModel, getEnvApiKey } from '@mariozechner/pi-ai';
import type { Message, Model, Usage } from '@mariozechner/pi-ai';
import { MODEL_CONFIG } from './llm/models';
import { join } from 'path';
import { mkdirSync, readFileSync, appendFileSync, existsSync, readdirSync, statSync, rmSync } from 'fs';
import { getTools } from './pi-tools';
import { pickModel, type TaskLabel } from './llm/router';
import { getLangfuse, estimateCost, mapToLangfuseModelId, toLangfuseUsageAndCost, type TokenUsage } from './telemetry';
import type { LangfuseTraceClient, LangfuseSpanClient } from 'langfuse';

const DEFAULT_PROVIDER = (process.env.PI_PROVIDER || 'anthropic') as 'anthropic' | 'openai';
// No-task fallback follows the router's balanced tier. The old hard-coded pin
// ('claude-sonnet-4-20250514') outlived its model: that snapshot retired in
// June 2026, and the cron/monitor callers that never pass a task label were
// still running on it.
const DEFAULT_MODEL_ID = process.env.PI_MODEL || (DEFAULT_PROVIDER === 'anthropic' ? MODEL_CONFIG['claude-sonnet-5'].id : 'gpt-4o');
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
 * SCOPE — this applies ONLY to the direct-Anthropic provider. When
 * OPENROUTER_API_KEY is set (i.e. prod), every call goes through
 * `openai-completions.js` instead and `PI_CACHE_RETENTION` has NO effect:
 * pi-ai emits `ttl:"1h"` only when the baseUrl is api.anthropic.com. On the
 * OpenRouter path the chat system prompt is instead emitted as TWO content
 * blocks with `cache_control` on the static half — see
 * `src/lib/chat/cache-breakpoint.ts` (CHAT_CACHE_SPLIT, default ON).
 *
 * Observability: `llm_usage_logs.cache_read_tokens` is populated automatically
 * on cache hits. A healthy cache hit rate for the Monday cron is > 70% of
 * input tokens after the first monitor per founder. NOTE: that target is
 * currently unverifiable for the buffered path — `extractTokens` misses pi-ai's
 * `cacheWrite` key there, so cache accounting reads as zero for skills and
 * monitors even when caching works.
 *
 * Source: node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js
 * (`resolveCacheRetention` + `getCacheControl`).
 */

/**
 * Models newer than pi-ai 0.67.68's static registry. `getModel()` returns
 * undefined for these (and the Agent would crash), so we hand-construct the
 * Model objects — same shapes as the registry's Sonnet 4.6 entries, with
 * Sonnet 5 ids and pricing sourced from MODEL_CONFIG so the cost meter and
 * pi-ai's calculateCost agree. `reasoning: true` matters on both entries:
 * it is what makes pi-ai explicitly send thinking OFF (OpenRouter
 * reasoning:{effort:"none"} / Anthropic thinking:{type:"disabled"}) instead
 * of omitting the param — and Sonnet 5 defaults to adaptive thinking when
 * the param is omitted, which would silently add output-token spend.
 */
const SONNET_5 = MODEL_CONFIG['claude-sonnet-5'];
const LP_EXTRA_MODELS: Record<string, Model<'anthropic-messages'> | Model<'openai-completions'>> = {
  [`anthropic:${SONNET_5.id}`]: {
    id: SONNET_5.id,
    name: 'Claude Sonnet 5',
    api: 'anthropic-messages',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    reasoning: true,
    input: ['text', 'image'],
    cost: {
      input: SONNET_5.pricing.input,
      output: SONNET_5.pricing.output,
      cacheRead: SONNET_5.pricing.cacheRead,
      cacheWrite: SONNET_5.pricing.cacheWrite,
    },
    contextWindow: SONNET_5.contextWindow,
    maxTokens: SONNET_5.maxOutputTokens,
  },
  [`openrouter:${SONNET_5.openrouterId}`]: {
    id: SONNET_5.openrouterId,
    name: 'Anthropic: Claude Sonnet 5',
    api: 'openai-completions',
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    reasoning: true,
    input: ['text', 'image'],
    cost: {
      input: SONNET_5.pricing.input,
      output: SONNET_5.pricing.output,
      cacheRead: SONNET_5.pricing.cacheRead,
      cacheWrite: SONNET_5.pricing.cacheWrite,
    },
    contextWindow: SONNET_5.contextWindow,
    maxTokens: SONNET_5.maxOutputTokens,
  },
};

/**
 * Resolve the concrete pi-ai Model object for this call.
 *
 * If a `task` label is provided, the router selects the model based on
 * task-complexity tier (see src/lib/llm/router.ts). Otherwise we fall back
 * to the globals `PI_PROVIDER` + `PI_MODEL` — preserving the pre-router
 * behavior for callers that haven't been retrofitted yet.
 *
 * Registry misses fall through to LP_EXTRA_MODELS (models newer than the
 * pinned pi-ai); a miss in both is a loud error instead of the downstream
 * undefined-model crash pi-agent-core would otherwise produce.
 */
function resolveModel(task?: TaskLabel, override?: { provider: string; model: string } | null) {
  const target = override
    ?? (task
      ? pickModel(task)
      : { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL_ID });
  const model =
    getModel(target.provider as any, target.model as any) ??
    LP_EXTRA_MODELS[`${target.provider}:${target.model}`];
  if (!model) {
    throw new Error(`[pi-agent] unknown model ${target.provider}:${target.model} — not in pi-ai's registry or LP_EXTRA_MODELS`);
  }
  return model;
}

/**
 * Key resolver handed to the Agent: the founder's own key when it matches the
 * provider actually being called, our env key otherwise.
 *
 * Matching on provider matters — the router picks per task, so a founder who
 * stored an OpenRouter key can still be routed to Anthropic, and billing that
 * to their OpenRouter credentials would just fail the call.
 */
function makeGetApiKey(userKey?: { provider: string; apiKey: string }) {
  return (provider: string) =>
    userKey && userKey.provider === provider ? userKey.apiKey : getEnvApiKey(provider as any);
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

/**
 * Trim a raw session transcript into a shape the provider accepts.
 * Pure function, exported for tests — loadSession is just file I/O around it.
 *
 * Fixes two long-standing poisoners (2026-09-01 audit):
 *  - The unpaired-tool-call guard used to grep for 'tool_use' (Anthropic's wire
 *    name), but pi-ai persists AgentMessages whose blocks are typed 'toolCall'
 *    — so the guard was dead code and every timeout-aborted agentic turn
 *    poisoned the next warm turn on that instance (400 / silent-empty).
 *  - The sliding window could open ON a toolResult whose toolCall assistant
 *    message was just sliced away — an orphaned toolResult the provider
 *    rejects. Measured: ~11% of live sessions were one warm turn away from
 *    this state. After windowing, drop leading toolResults (and the then-
 *    leading assistant tool-call turn they belonged to, if the slice split a
 *    multi-result batch).
 */
export function trimSessionMessages(messages: AgentMessage[], maxMessages?: number): AgentMessage[] {
  // Anthropic's API rejects (or silently returns empty) when conversation
  // history ends with an incomplete assistant turn:
  //   - toolCall block with no matching toolResult follow-up
  //   - empty content array (turn killed before any text/tool was produced)
  // Both happen when a stream is killed mid-turn. Trim any trailing
  // incomplete-assistant and its preceding user message, so the agent
  // retries from the last complete (user, assistant) pair.
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
    // 'toolCall' is pi-ai's persisted block type; keep 'tool_use' too in case
    // an older file ever carried wire-shaped blocks.
    const hasUnpairedToolCall = contentStr.includes('toolCall') || contentStr.includes('tool_use');

    if (!isEmpty && !hasUnpairedToolCall) break;

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

  // The window slice above is position-based, so it can open mid tool-exchange:
  // a leading toolResult whose toolCall turn was cut off. The provider rejects
  // that shape outright. Drop leading toolResults until the window starts on a
  // user or assistant message.
  while (messages.length > 0 && (messages[0] as { role?: string }).role === 'toolResult') {
    messages.shift();
  }

  return messages;
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
    return trimSessionMessages(messages, maxMessages);
  } catch {
    return [];
  }
}

function appendToSession(sessionId: string, message: AgentMessage) {
  const path = sessionPath(sessionId);
  appendFileSync(path, JSON.stringify(message) + '\n');
}

/**
 * Resolve the conversation history to restore for this turn.
 *
 * The ephemeral session file (loadSession) is the PROVEN source on a warm
 * instance — it holds the full agentic history (including tool plumbing) in the
 * exact shape the SDK emitted. The durable seedHistory is the cold-start
 * recovery: it only WINS when it carries MORE of the thread than the file —
 * i.e. the file was wiped or left partial by a cold start / deploy. On a warm
 * instance the file is complete (>= the conversational seed, since it also
 * counts tool messages) and is used unchanged, so the reconstructed seed shape
 * can only ever feed the model on the cold path — confining any shape risk
 * (cf. the reverted b11eff4) to exactly the case it's meant to fix. The window
 * cap bounds token growth on whichever source is used. Callers without a
 * durable transcript (cron, skills) just get loadSession.
 */
function resolveHistory(options: RunAgentOptions): AgentMessage[] {
  const cap = options.maxHistoryMessages ?? 12;
  const fromFile = options.sessionId ? loadSession(options.sessionId, cap) : [];
  const seed = options.seedHistory ?? [];
  const windowedSeed = cap > 0 && seed.length > cap ? seed.slice(seed.length - cap) : seed;
  return windowedSeed.length > fromFile.length ? windowedSeed : fromFile;
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
   * Project this run belongs to. When set, the base web_search / read_url tools
   * meter their paid Exa/Jina calls to that project (llm_usage_logs + Langfuse).
   * Omitted ⇒ tool spend is not attributed (metering skipped, no breakage).
   */
  projectId?: string;
  /** Audit step label used for tool-spend metering (e.g. 'chat', 'cron.competitors'). */
  step?: string;
  /**
   * Task-complexity label. When set, the router selects the model tier
   * (cheap/balanced/premium) based on this task rather than reading
   * PI_PROVIDER + PI_MODEL globals. See src/lib/llm/router.ts.
   */
  task?: TaskLabel;
  /**
   * Per-turn tool-call budget. Calls past it are BLOCKED at prepare time by
   * `beforeToolCall` (makeToolCallLimiter) with an instructive error result —
   * the agent is NOT aborted, so the loop continues and the model is pushed
   * into synthesis. Prevents runaway cost from agentic loops that ignore the
   * prompt-level "max N tool calls" instruction. Applies to BOTH runAgent and
   * runAgentStream. Default: 8.
   */
  maxToolCalls?: number;
  /**
   * Explicit model override, resolved BEFORE the task router — the wire for
   * users.preferred_model (Settings "Preferred Model": "When set, all chat
   * messages use this model"). Build it with router.modelForKey() so the
   * provider matches this deployment's wire path. Unknown ids still fail loud
   * in resolveModel.
   */
  modelOverride?: { provider: 'anthropic' | 'openrouter'; model: string } | null;
  /**
   * Per-sub-call output-token ceiling. Defaults to the router tier's
   * maxTokens (cheap 4096 / balanced 8192 / premium 16384) — before this
   * existed, EVERY call shipped pi-ai's blanket min(model.maxTokens, 32000),
   * so a runaway synthesis could bill 32k output tokens on one call. Applied
   * via the onPayload hook (see makeOutputCapHook); pass a larger value for
   * callers that legitimately produce long artifacts.
   */
  maxTokens?: number;
  /**
   * Max conversation history messages to load from the session file.
   * Older messages are trimmed from the beginning to cap token growth.
   * Default: 12 (~6 user/assistant pairs).
   */
  maxHistoryMessages?: number;
  /**
   * Durable conversation history to seed the agent with when present.
   *
   * The session file (loadSession) lives on the EPHEMERAL serverless disk and
   * is wiped by every cold start / new instance / deploy. When that happens
   * mid-thread the agent "restarts from scratch" (see the MediFlow turn-16
   * field report: a cold instance → empty session.jsonl → the model never saw
   * the prior turns → snapped back to Stage-1). Callers that hold the durable
   * history (the chat route gets it in the request body, mirrored from
   * chat_messages) pass it here so a cold start is harmless: seedHistory wins
   * over the session file ONLY when it carries more of the thread than the file
   * (i.e. the file was wiped/partial). See resolveHistory.
   *
   * Shape contract: each entry MUST be a valid AgentMessage — assistant
   * content MUST be a content-block array (`[{type:'text',text}]`), NOT a plain
   * string. A plain string is malformed and makes the provider reject the call
   * with an empty response (the bug that got commit b11eff4 reverted). Build
   * these with buildSeedHistory(), which enforces the shape.
   */
  seedHistory?: AgentMessage[];
  /**
   * Streaming mirror — fired with each assistant text delta as it arrives.
   * runAgent stays BUFFERED (same {text,usage} return + identical persistence
   * and usage accounting); this just echoes the deltas out so a caller can
   * stream the output live (e.g. the /skills SSE route streaming skill output
   * into chat instead of dumping it all at the end). Optional + side-effect-free.
   */
  onDelta?: (delta: string) => void;
  /**
   * BYOK — the founder's own provider key, resolved from `user_api_keys`.
   *
   * When the router picks a provider this key is for, the agent bills that
   * provider account instead of ours; any other provider still falls through
   * to `getEnvApiKey`. Omitted ⇒ system keys, which is the path every request
   * took before this option existed (Settings collected keys that nothing
   * read — see the 2026-07-27 audit).
   */
  userKey?: { provider: string; apiKey: string };
  /**
   * Real founder/user id for the live Langfuse trace opened around this run
   * (see openAgentTrace below). Omitted for system-initiated work with no
   * attributable owner — a trace with no userId is valid, not a bug.
   */
  userId?: string;
  /** Stable, verb-first Langfuse trace name (e.g. 'chat-turn', 'cron-monitor'). Default 'agent-run'. */
  traceName?: string;
}

/**
 * Convert a durable {role, content} transcript (e.g. chat_messages rows or the
 * client's message array) into AgentMessage[] safe to seed an agent with.
 *
 * - Keeps only user/assistant turns with non-empty text (tool_use/tool_result
 *   reconstruction is intentionally skipped — historical tool plumbing isn't
 *   needed for conversational continuity, and unpaired tool_use blocks would be
 *   rejected by the API anyway).
 * - Wraps content in a `[{type:'text',text}]` block for BOTH roles. assistant
 *   content MUST be an array; using the array form for user too keeps it
 *   uniform and avoids the plain-string footgun (b11eff4).
 * - The assistant's full text (including any :::artifact option-sets it emitted)
 *   is preserved, so after a cold start the model can still see what it
 *   previously offered (fixes the "this option wasn't in the set I proposed"
 *   regression).
 */
export function buildSeedHistory(
  transcript: Array<{ role?: string; content?: unknown }>,
): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const m of transcript) {
    const role = m.role === 'user' || m.role === 'assistant' ? m.role : null;
    if (!role) continue;
    const text = typeof m.content === 'string' ? m.content.trim() : '';
    if (!text) continue;
    out.push({ role, content: [{ type: 'text', text }] } as unknown as AgentMessage);
  }
  return out;
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

// ─── Live Langfuse tracing ───
//
// One trace per runAgent()/runAgentStream() invocation (= one agent run, per
// Langfuse's own best-practices guidance), opened here and closed here — NOT
// left to callers to log post-hoc from an already-flattened usage summary.
// Tool calls become spans, each LLM sub-call becomes its own generation, both
// nested under the trace. All SDK calls below (trace()/span()/generation()/
// .end()/.update()) are synchronous — they only enqueue to an in-memory batch,
// no network I/O — so calling them inside the hot agent.subscribe() callback
// adds no latency. Only flushAsync() does network I/O; it's awaited exactly
// once, at the true end of the run. Gated purely on getLangfuse() !== null
// (the existing LANGFUSE_SECRET_KEY no-op switch) — zero overhead when unset.

/** Normalize pi-ai's Usage shape (which varies slightly by provider/event) to TokenUsage. */
function toTokenUsage(u: unknown): TokenUsage {
  if (!u || typeof u !== 'object') return {};
  const r = u as Record<string, unknown>;
  const num = (...keys: string[]): number => {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === 'number') return v;
    }
    return 0;
  };
  return {
    input_tokens: num('input', 'inputTokens', 'input_tokens'),
    output_tokens: num('output', 'outputTokens', 'output_tokens'),
    cache_creation_input_tokens: num('cacheWrite', 'cacheCreation', 'cache_creation_tokens', 'cacheCreationInputTokens'),
    cache_read_input_tokens: num('cacheRead', 'cache_read_tokens', 'cacheReadInputTokens'),
  };
}

function resolveGenerationCost(
  usage: TokenUsage,
  authoritative: number | undefined,
  provider: string,
  model: string,
): number {
  return typeof authoritative === 'number' && authoritative > 0
    ? authoritative
    : estimateCost(provider, model, usage);
}

/** Open one trace for this agent run. Returns null when tracing is disabled or open fails (non-fatal). */
function openAgentTrace(options: RunAgentOptions, prompt: string): LangfuseTraceClient | null {
  const lf = getLangfuse();
  if (!lf) return null;
  try {
    const tags = [options.step, options.task].filter(
      (v, i, arr): v is string => !!v && arr.indexOf(v) === i,
    );
    return lf.trace({
      name: options.traceName || 'agent-run',
      userId: options.userId,
      sessionId: options.sessionId,
      input: prompt.slice(0, 2000),
      metadata: { projectId: options.projectId, step: options.step, task: options.task },
      tags: tags.length > 0 ? tags : undefined,
    });
  } catch (err) {
    console.warn('[pi-agent] Langfuse trace open failed (non-fatal):', (err as Error).message);
    return null;
  }
}

/** One generation per LLM sub-call (message_end with usage), nested under the run's trace. */
function recordGeneration(
  trace: LangfuseTraceClient | null,
  provider: string,
  modelId: string,
  incomingUsage: unknown,
  startTimeMs?: number,
): void {
  if (!trace || !incomingUsage) return;
  try {
    const tu = toTokenUsage(incomingUsage);
    const authoritative = (incomingUsage as { cost?: { total?: number } })?.cost?.total;
    const cost = resolveGenerationCost(tu, authoritative, provider, modelId);
    const { usageDetails, costDetails } = toLangfuseUsageAndCost(tu, cost);
    trace.generation({
      name: `${provider} generation`,
      model: mapToLangfuseModelId(modelId),
      usageDetails,
      costDetails,
      // startTime comes from the onResponse hook (HTTP response start of this
      // sub-call). Before it was wired, generations carried only endTime and
      // rendered as zero-duration in Langfuse, so model time vs tool time was
      // unanswerable from traces (round-2 audit finding).
      ...(startTimeMs ? { startTime: new Date(startTimeMs) } : {}),
      endTime: new Date(),
    });
  } catch (err) {
    console.warn('[pi-agent] Langfuse generation failed (non-fatal):', (err as Error).message);
  }
}

/**
 * onResponse hook (pi-ai calls it with HTTP status + headers the moment each
 * LLM sub-call's response starts): per-sub-call observability that was
 * previously absent — non-2xx statuses were swallowed into pi-agent-core's
 * generic error stop with no status classification, and generations had no
 * start time. The returned object is shared per run: `at` feeds
 * recordGeneration's startTime; `lastStatus` lets callers distinguish
 * 429/overload blips from hard 4xx in logs.
 */
function makeResponseMeter() {
  const meter = { at: undefined as number | undefined, lastStatus: undefined as number | undefined };
  const onResponse = (response: { status: number }) => {
    meter.at = Date.now();
    meter.lastStatus = response.status;
    if (response.status >= 400) {
      console.warn(`[pi-agent] LLM sub-call responded ${response.status}${response.status === 429 ? ' (rate limited)' : response.status >= 500 ? ' (provider error)' : ''}`);
    }
  };
  return { meter, onResponse };
}

/** One span per tool call, keyed by toolCallId so the matching end event can close it. */
function openToolSpan(
  trace: LangfuseTraceClient | null,
  spans: Map<string, LangfuseSpanClient>,
  toolCallId: string,
  toolName: string,
  args: unknown,
): void {
  if (!trace) return;
  try {
    spans.set(toolCallId, trace.span({
      name: toolName,
      input: JSON.stringify(args ?? {}).slice(0, 2000),
    }));
  } catch (err) {
    console.warn('[pi-agent] Langfuse span open failed (non-fatal):', (err as Error).message);
  }
}

function closeToolSpan(
  spans: Map<string, LangfuseSpanClient>,
  toolCallId: string,
  isError: boolean,
  result?: unknown,
): void {
  const span = spans.get(toolCallId);
  if (!span) return;
  try {
    const output = result === undefined ? undefined : JSON.stringify(result).slice(0, 2000);
    span.end({ output, level: isError ? 'ERROR' : 'DEFAULT' });
  } catch (err) {
    console.warn('[pi-agent] Langfuse span close failed (non-fatal):', (err as Error).message);
  }
  spans.delete(toolCallId);
}

/** Set the trace's root output and flush. Awaited exactly once, at the true end of the run. */
async function finishAgentTrace(trace: LangfuseTraceClient | null, outputText: string): Promise<string | null> {
  if (!trace) return null;
  try {
    trace.update({ output: outputText.slice(0, 2000) });
  } catch (err) {
    console.warn('[pi-agent] Langfuse trace update failed (non-fatal):', (err as Error).message);
  }
  try {
    await getLangfuse()?.flushAsync();
  } catch (err) {
    console.warn('[pi-agent] Langfuse flushAsync failed (non-fatal):', (err as Error).message);
  }
  return trace.id;
}

export interface RunAgentResult {
  text: string;
  usage?: Usage;
  /** True when the run hit the timeout and was aborted — `text` is TRUNCATED
   *  at the cut, so machine-readable tails (e.g. a closing ```json fence) may
   *  be missing. Callers persisting structured output should check this. */
  timedOut?: boolean;
  /** Id of the live Langfuse trace opened for this run, when tracing is on.
   *  Pass to recordUsage/recordAgentUsage (cost-meter.ts) so it skips its own
   *  post-hoc flat trace — this run already has a real nested one. */
  langfuseTraceId?: string | null;
  /** Set when the run ended on a provider stream error WITH NO output (after
   *  the one zero-emission retry). `text` is '' in that case — callers that
   *  treat empty text as "model returned nothing" can now tell "provider
   *  failed" apart from it and message/log accordingly. */
  error?: string;
}

/**
 * Enforce the per-turn tool-call budget with the loop's own `beforeToolCall`
 * hook. Once the budget is spent, every further call is BLOCKED with an
 * instructive error result — the loop keeps running, so the model's next
 * iteration is forced into synthesis instead of more tool churn.
 *
 * This replaces the old `agent.state.tools = []` strip, which was doubly
 * wrong: (a) a no-op — Agent.prompt() snapshots the tool array at run start
 * and the loop only reads the snapshot, so the strip never reached the LLM;
 * (b) even if it had worked, removing tools mid-turn mutates cache-prefix
 * position 0 and re-bills the whole prefix at write price for the turn's
 * largest call. Blocking per-call keeps the tool array byte-stable.
 */
/**
 * Output-token ceiling, applied at the wire via pi-ai's onPayload hook (the
 * hook's return value replaces the request params on both provider paths).
 *
 * Why here and not in Agent options: pi-agent-core's createLoopConfig never
 * forwards a maxTokens, so pi-ai's buildBaseOptions falls back to
 * min(model.maxTokens, 32000) for every call — the router's per-tier
 * TIER_DEFAULTS.maxTokens was computed by pickModel and then thrown away
 * (round-1 audit finding). This restores the tier cap as a guardrail:
 * cheap 4096 / balanced 8192 / premium 16384, overridable per call via
 * options.maxTokens. Ledger check before choosing these: max observed chat
 * output in 30 days was ~5.4k tokens, well inside the balanced cap.
 */
function makeOutputCapHook(task: TaskLabel | undefined, explicit?: number) {
  const cap = explicit ?? (task ? pickModel(task).maxTokens : pickModel('chat').maxTokens);
  return (params: unknown) => {
    if (params && typeof params === 'object') {
      const p = params as Record<string, unknown>;
      p.max_tokens = typeof p.max_tokens === 'number' ? Math.min(p.max_tokens, cap) : cap;
    }
    return params;
  };
}

/**
 * Persistence guard for session writes during retried runs (see the retry
 * logic in runAgent/runAgentStream):
 *  - error-stopped assistant messages are never persisted — trimSessionMessages
 *    would drop them on the next load anyway, and skipping them keeps a
 *    retried turn from leaving a poisoned entry between the two attempts;
 *  - on a retry attempt the user message is already in the file from attempt 1,
 *    so persisting it again would leave duplicate consecutive user entries.
 */
function shouldPersistMessage(message: unknown, attempt: number): boolean {
  const m = message as { role?: string; stopReason?: string };
  if (m.role === 'assistant' && m.stopReason === 'error') return false;
  if (attempt > 1 && m.role === 'user') return false;
  return true;
}

/** Retry policy for provider blips: one retry, only when the failed attempt
 *  emitted NOTHING (no text streamed, no tool executed) — so a retry can never
 *  duplicate founder-visible output or re-run a side-effectful tool. */
const STREAM_RETRY_DELAY_MS = 750;

function makeToolCallLimiter(maxToolCalls: number) {
  let attempted = 0;
  let warned = false;
  return async () => {
    attempted++;
    if (attempted <= maxToolCalls) return undefined;
    if (!warned) {
      warned = true;
      console.warn(`[pi-agent] tool call limit reached (${maxToolCalls}), blocking further calls to force synthesis`);
    }
    return {
      block: true,
      reason:
        `Tool-call budget for this turn is exhausted (${maxToolCalls} calls used). ` +
        'Do not request any more tools. Write your final answer NOW, synthesizing what you already gathered, ' +
        'including every required closing artifact (option set / summary).',
    };
  };
}

/** Run Pi Agent and collect full response (non-streaming). */
export async function runAgent(prompt: string, options: RunAgentOptions = {}): Promise<RunAgentResult> {
  cleanStaleSessions();
  const model = resolveModel(options.task, options.modelOverride);

  // Attempt-invariant setup, built ONCE and reused by a retry: tools, history,
  // trace, output cap. history MUST be copied into each agent (the loop pushes
  // the new user message into state.messages — reusing the same array across
  // attempts would double-inject attempt 1's messages).
  const baseTools = options.tools !== false
    ? getTools({ projectId: options.projectId, step: options.step ?? options.task, userId: options.userId })
    : [];
  const extraTools = options.extraTools || [];
  const prior = resolveHistory(options);
  const outputCap = makeOutputCapHook(options.task, options.maxTokens);

  let fullText = '';
  let lastUsage: Usage | undefined;

  const trace = openAgentTrace(options, prompt);
  const toolSpans = new Map<string, LangfuseSpanClient>();

  const timeout = options.timeout || 120000;
  let timedOut = false;
  let currentAgent: Agent | null = null;

  // HARD DEADLINE, raced against the run instead of trusted to abort():
  // agent.abort() only reaches the LLM socket — tools ignore the signal and
  // the loop never checks it, so a hung tool (stuck fetch, dead DB wait) left
  // waitForIdle() unresolved past the timeout indefinitely; buffered callers
  // (skills, cron) then zombied to the platform kill with NOTHING persisted.
  // The race guarantees the caller gets its partial result back at ~timeout;
  // the abandoned run keeps its abort signal and dies with the socket.
  let deadlineFired!: () => void;
  const deadline = new Promise<void>((resolve) => { deadlineFired = resolve; });
  const timer = setTimeout(() => {
    timedOut = true;
    console.warn(`[pi-agent] timeout (${timeout}ms) — aborting buffered agent run (output truncated)`);
    try { currentAgent?.abort(); } catch { /* ignore */ }
    deadlineFired();
  }, timeout);

  const runAttempt = async (attempt: number): Promise<{ errorStop: boolean; errorMessage?: string; toolsRan: boolean }> => {
    const { meter, onResponse } = makeResponseMeter();
    const agent = new Agent({
      streamFn: streamSimple,
      sessionId: options.sessionId,
      getApiKey: makeGetApiKey(options.userKey),
      onResponse,
      // Explicitly request parallel tool execution. With 3-4 web_search +
      // read_url calls in a research turn, sequential execution dominates
      // latency — parallel lets them all run concurrently and finalizes
      // results in source order.
      toolExecution: 'parallel',
      // The buffered path previously had NO tool-call cap at all — a section
      // that ignored its "at most 2 searches" prompt could burn the whole run
      // budget on tool loops. Same default cap as the streaming path.
      beforeToolCall: makeToolCallLimiter(options.maxToolCalls ?? 8),
      onPayload: outputCap,
    });
    currentAgent = agent;

    agent.state.model = model;
    if (options.systemPrompt) {
      agent.state.systemPrompt = options.systemPrompt;
    }
    if (baseTools.length > 0 || extraTools.length > 0) {
      agent.state.tools = [...baseTools, ...extraTools];
    }
    if (prior.length > 0) {
      agent.state.messages = [...prior];
    }

    let errorStop = false;
    let errorMessage: string | undefined;
    let toolsRan = false;

    agent.subscribe((event) => {
      if (event.type === 'message_update') {
        const evt = event.assistantMessageEvent;
        if (evt.type === 'text_delta') {
          fullText += evt.delta;
          options.onDelta?.(evt.delta); // mirror the delta out (buffered return unchanged)
        }
      }
      if (event.type === 'tool_execution_start') {
        toolsRan = true;
        openToolSpan(trace, toolSpans, event.toolCallId, event.toolName, event.args);
      }
      if (event.type === 'tool_execution_end') {
        closeToolSpan(toolSpans, event.toolCallId, event.isError, event.result);
      }
      // message_end fires for user, toolResult, and assistant messages in order.
      // Writing here is sufficient — turn_end would double-write toolResults.
      if (event.type === 'message_end' && event.message) {
        const msg = event.message as { role?: string; stopReason?: string; errorMessage?: string };
        if (msg.role === 'assistant' && msg.stopReason === 'error') {
          errorStop = true;
          errorMessage = msg.errorMessage;
        }
        if ('usage' in event.message) {
          const usage = (event.message as any).usage;
          lastUsage = accumulateUsage(lastUsage, usage);
          recordGeneration(trace, model.provider, model.id, usage, meter.at);
        }
        if (options.sessionId && shouldPersistMessage(event.message, attempt)) {
          appendToSession(options.sessionId, event.message);
        }
      }
    });

    await Promise.race([
      (async () => { await agent.prompt(prompt); await agent.waitForIdle(); })(),
      deadline,
    ]);
    return { errorStop, errorMessage, toolsRan };
  };

  let finalError: string | undefined;
  try {
    let result = await runAttempt(1);
    // Retry-on-blip: pi-agent-core swallows provider stream errors into a
    // stopReason:'error' assistant message and RESOLVES prompt() — before
    // this, a transient OpenRouter 5xx/socket drop surfaced as a silently
    // empty "successful" run. Retry once, ONLY when nothing was emitted (no
    // text, no tool executed), so the retry can never duplicate output or
    // side effects. The deadline timer spans both attempts.
    if (result.errorStop && !timedOut && fullText === '' && !result.toolsRan) {
      console.warn(`[pi-agent] provider stream error before any output (${result.errorMessage || 'unknown'}) — retrying once`);
      await new Promise((r) => setTimeout(r, STREAM_RETRY_DELAY_MS));
      if (!timedOut) result = await runAttempt(2);
    }
    if (result.errorStop && fullText === '') {
      finalError = result.errorMessage || 'model stream failed';
    }
  } finally {
    clearTimeout(timer);
  }

  const langfuseTraceId = await finishAgentTrace(trace, fullText);
  return { text: fullText, usage: lastUsage, timedOut, langfuseTraceId, error: finalError };
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
  const model = resolveModel(options.task, options.modelOverride);
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
      // Attempt-invariant setup — built once, shared by the zero-emission
      // retry (see startAttempt below). History must be COPIED into each
      // agent: the loop pushes the new user message into state.messages, so
      // sharing the array across attempts would double-inject it.
      const baseToolsS = options.tools !== false
        ? getTools({ projectId: options.projectId, step: options.step ?? options.task, userId: options.userId })
        : [];
      const extraToolsS = options.extraTools || [];
      const prior = resolveHistory(options);
      const outputCap = makeOutputCapHook(options.task, options.maxTokens);

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

      // Live Langfuse trace for this turn — see openAgentTrace/recordGeneration/
      // openToolSpan/closeToolSpan/finishAgentTrace above. finishAgentTrace is
      // chained via .then() (not an async callback) at each of the 3 finalize
      // paths below (timeout, agent_end, prompt().catch) so flushAsync() always
      // completes before safeClose() — same await this stream already had to do
      // for Langfuse delivery, just moved from the chat route's flush() hook to
      // here.
      const trace = openAgentTrace(options, prompt);
      const toolSpans = new Map<string, LangfuseSpanClient>();

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
        // (WIP's $0-on-timeout fix) through the double-close-safe enqueue. The
        // per-sub-call generations were already recorded live in message_end
        // below (if any fired before the abort) — this only closes the trace.
        finishAgentTrace(trace, fullText).then((langfuseTraceId) => {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ done: true, timeout: true, fullText, usage: timeoutUsage, langfuseTraceId })}\n\n`));
          safeClose();
        });
      }, timeout);

      let lastUsage: Usage | undefined;

      /**
       * One agent attempt. Wrapped so a provider blip that emitted NOTHING
       * (no content frame, no tool execution) can be retried once without the
       * client ever noticing — before this, pi-agent-core swallowed stream
       * errors into a stopReason:'error' assistant message and the turn ended
       * as a silent `done:true` with empty text: a dead turn styled as
       * complete (the observed $0-flake class). When output HAS been emitted
       * (or the retry also fails), the done frame now carries `error` so the
       * client can render a real failure instead of a fake-complete turn.
       * The master timeout timer spans attempts.
       */
      const startAttempt = (attempt: number) => {
        const { meter, onResponse } = makeResponseMeter();
        agent = new Agent({
          streamFn: streamSimple,
          sessionId: options.sessionId,
          getApiKey: makeGetApiKey(options.userKey),
          onResponse,
          // Pin parallel tool execution rather than relying on the library
          // default — a default flip upstream would silently serialize every
          // tool batch in the founder-facing path.
          toolExecution: 'parallel',
          // Per-turn tool budget, enforced at prepare time (see
          // makeToolCallLimiter). Replaces the old mid-turn tools-strip, which
          // never worked: the loop reads a snapshot taken at prompt() time.
          beforeToolCall: makeToolCallLimiter(options.maxToolCalls ?? 8),
          onPayload: outputCap,
        });

        agent.state.model = model;
        if (options.systemPrompt) {
          agent.state.systemPrompt = options.systemPrompt;
        }
        if (baseToolsS.length > 0 || extraToolsS.length > 0) {
          agent.state.tools = [...baseToolsS, ...extraToolsS];
        }
        // Restore conversation history (durable seedHistory wins over the
        // ephemeral session file — the cold-start fix; see resolveHistory). The
        // SDK appends the new user message and subsequent assistant turns itself —
        // do NOT call appendToSession here or the user message appears twice.
        if (prior.length > 0) {
          agent.state.messages = [...prior];
        }

        let sawErrorStop = false;
        let errorMessage: string | undefined;
        let toolsRan = false;
        const retryable = () =>
          sawErrorStop && !toolsRan && fullText === '' && attempt === 1 && !closed;

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
              // Tool budget is enforced in beforeToolCall (Agent construction
              // above) — blocked calls never reach execution, so no counting or
              // tool-stripping is needed here.
              toolsRan = true;
              openToolSpan(trace, toolSpans, event.toolCallId, event.toolName, event.args);
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
              closeToolSpan(toolSpans, event.toolCallId, event.isError, event.result);
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
              if (event.message) {
                const msg = event.message as { role?: string; stopReason?: string; errorMessage?: string };
                if (msg.role === 'assistant' && msg.stopReason === 'error') {
                  sawErrorStop = true;
                  errorMessage = msg.errorMessage;
                }
              }
              if (event.message && 'usage' in event.message) {
                const usage = (event.message as any).usage;
                lastUsage = accumulateUsage(lastUsage, usage);
                recordGeneration(trace, model.provider, model.id, usage, meter.at);
              }
              // message_end fires for user, toolResult, and assistant messages in order.
              // Writing here is sufficient — turn_end would double-write toolResults.
              if (options.sessionId && event.message && shouldPersistMessage(event.message, attempt)) {
                appendToSession(options.sessionId, event.message);
              }
              break;
            }

            case 'agent_end': {
              if (retryable()) {
                console.warn(`[pi-agent] provider stream error before any output (${errorMessage || 'unknown'}) — retrying once`);
                setTimeout(() => { if (!closed) startAttempt(2); }, STREAM_RETRY_DELAY_MS);
                break;
              }
              clearTimeout(timer);
              const u = lastUsage as unknown as Record<string, number | { total?: number } | undefined>;
              finishAgentTrace(trace, fullText).then((langfuseTraceId) => {
                safeEnqueue(
                  encoder.encode(`data: ${JSON.stringify({
                    done: true,
                    fullText,
                    // Honest failure reporting: a stream error used to render
                    // as a successful (possibly truncated) turn. Carry the
                    // error so the client can show a real failure state; keep
                    // fullText so a mid-stream drop still shows the partial.
                    ...(sawErrorStop ? { error: errorMessage || 'model stream failed', partial: fullText.length > 0 } : {}),
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
                    langfuseTraceId,
                  })}\n\n`)
                );
                safeClose();
              });
              break;
            }
          }
        });

        agent.prompt(prompt).catch((err) => {
          // Hard failure (thrown before/outside the loop). Same zero-emission
          // retry rule as the in-loop error path.
          if (retryable() || (!toolsRan && fullText === '' && attempt === 1 && !closed)) {
            console.warn(`[pi-agent] prompt() rejected before any output (${err?.message || err}) — retrying once`);
            setTimeout(() => { if (!closed) startAttempt(2); }, STREAM_RETRY_DELAY_MS);
            return;
          }
          clearTimeout(timer);
          // WEAVE (port): emit a done event carrying both the error message
          // (master) and whatever usage we accumulated before the failure
          // (WIP's $0-flake-turn fix), through the double-close-safe enqueue.
          // Without the usage, cost extraction sees no streamUsage.done and
          // records $0.00 — the pattern observed in e2e turns 5/6/7.
          const u = lastUsage as unknown as Record<string, number | { total?: number } | undefined> | undefined;
          finishAgentTrace(trace, fullText).then((langfuseTraceId) => {
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
                langfuseTraceId,
              })}\n\n`)
            );
            safeClose();
          });
        });
      };

      startAttempt(1);
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

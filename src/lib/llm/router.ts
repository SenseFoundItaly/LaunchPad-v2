/**
 * Task-complexity-based model router.
 *
 * Every LLM call in LaunchPad tags itself with a `TaskLabel` describing what
 * kind of work it's doing. The router maps labels to tiers, and tiers to
 * concrete {provider, model} tuples. This gives us three levers:
 *
 * 1. Route cheap work (summarization, classification) to Haiku instead of
 *    Sonnet — same quality, ~4x cheaper. Roadmap KPI target 3.1 (<€0.25 per
 *    user/month) depends on this.
 * 2. Route high-value long-horizon work (scaling-plan, 52-week milestones)
 *    to Opus — Sonnet's reasoning depth occasionally falls short on these.
 * 3. Override per deployment via LLM_ROUTING_JSON env var without a redeploy.
 *
 * The default for any task not explicitly mapped is `balanced` (Sonnet) —
 * quality-first policy so new routes don't silently degrade.
 */

import { MODEL_CONFIG, TIER_DEFAULTS } from './models';

export type ModelTier = 'cheap' | 'balanced' | 'premium';

export type TaskLabel =
  | 'chat'               // Pi Agent interactive chat
  | 'monitor-agent'      // Pi Agent cron / monitor run (web-browse + parse)
  | 'scoring'            // startup scoring (numeric across dimensions)
  | 'research'           // market research
  | 'simulation'         // persona simulation
  | 'pitch-iterate'      // pitch deck revision
  | 'term-sheet'         // term sheet analysis
  | 'investor-update'    // summarize progress for investors (cheap)
  | 'scaling-plan'       // 3-year strategic horizon (premium)
  | 'milestones'         // 52-week detailed roadmap (premium)
  | 'update-generate'    // journey update (cheap)
  | 'growth-iterate'     // growth loop hypothesis
  | 'growth-synthesize'  // growth pattern synthesis
  | 'summarize'          // generic summarization
  | 'classify'           // generic classification
  | 'heartbeat-reflect'  // daily agent self-reflection
  | 'heartbeat-propose'  // daily heartbeat task proposer (cheap)
  | 'skill-invoke'       // agent invoking a registered skill as a tool
  | 'risk-analysis'      // structured risk audit (roadmap 1.1)
  | 'task-expand'        // task-expansion turn (break a TODO into subtasks)
  | 'signal-classify'    // watch-source change significance classification (cheap)
  | 'signal-correlate'   // cross-signal correlation synthesis (balanced/Sonnet)
  | 'skill-premium'      // premium-tier skill runs (landing page, pitch deck)
  | 'chat-followup';     // simple chat follow-ups routed to Haiku

type ResolvedModel = {
  provider: 'anthropic' | 'openrouter';
  model: string;
  tier: ModelTier;
  maxTokens: number;
};

// Provider selection:
//   - OPENROUTER_API_KEY set → route via OpenRouter (single gateway, single
//     invoice, fallback between providers). Model slugs use OpenRouter's
//     namespaced format (e.g. "anthropic/claude-sonnet-4.6").
//   - otherwise → direct Anthropic. Requires ANTHROPIC_API_KEY.
//
// The tier map is flipped at module load time, not per-call. Swapping
// providers is a server restart, not a hot path decision.
const USE_OPENROUTER = Boolean(process.env.OPENROUTER_API_KEY);

// Derive tier → {provider, model} from MODEL_CONFIG instead of duplicating IDs.
const TIER_MODELS: Record<ModelTier, { provider: 'anthropic' | 'openrouter'; model: string }> = (() => {
  const result = {} as Record<ModelTier, { provider: 'anthropic' | 'openrouter'; model: string }>;
  for (const cfg of Object.values(MODEL_CONFIG)) {
    result[cfg.tier] = USE_OPENROUTER
      ? { provider: 'openrouter', model: cfg.openrouterId }
      : { provider: 'anthropic', model: cfg.id };
  }
  return result;
})();

// Default task -> tier. Anything not listed falls through to `balanced`.
// Conservative routing confirmed with user: only obvious wins move off balanced.
const DEFAULT_TASK_TIER: Partial<Record<TaskLabel, ModelTier>> = {
  classify: 'cheap',
  summarize: 'cheap',
  'update-generate': 'cheap',
  'investor-update': 'cheap',
  'heartbeat-propose': 'cheap',
  'scaling-plan': 'premium',
  milestones: 'premium',
  'task-expand': 'cheap',  // single-shot analytical; Haiku handles cleanly.
  'signal-classify': 'cheap',  // watch-source change classification; Haiku is sufficient.
  'chat-followup': 'cheap',    // simple follow-ups (yes, tell me more, go ahead) — Haiku handles fine.
  'skill-premium': 'premium',  // landing page + pitch deck Build skills need Opus.
  // chat, monitor-agent, scoring, research, simulation, pitch-iterate,
  // term-sheet, growth-iterate, growth-synthesize, heartbeat-reflect,
  // skill-invoke, AND any new unmapped task -> balanced (Sonnet).
};

// Cached env-override map. Parsed once on first use; re-parsed if the
// raw string changes (mostly for tests — in prod env vars are immutable).
let cachedOverride: { raw: string | undefined; parsed: Partial<Record<string, ModelTier>> } = {
  raw: null as never,
  parsed: {},
};

function loadOverride(): Partial<Record<string, ModelTier>> {
  const raw = process.env.LLM_ROUTING_JSON;
  if (raw === cachedOverride.raw) return cachedOverride.parsed;

  cachedOverride.raw = raw;
  cachedOverride.parsed = {};
  if (!raw) return cachedOverride.parsed;

  try {
    const parsed = JSON.parse(raw);
    for (const [task, tier] of Object.entries(parsed)) {
      if (tier === 'cheap' || tier === 'balanced' || tier === 'premium') {
        cachedOverride.parsed[task] = tier;
      }
    }
  } catch (err) {
    console.warn('[llm/router] Failed to parse LLM_ROUTING_JSON, ignoring:', err);
  }
  return cachedOverride.parsed;
}

/**
 * Resolve a task label to a concrete {provider, model, tier}.
 *
 * Lookup precedence:
 *   1. LLM_ROUTING_JSON env var (runtime override)
 *   2. DEFAULT_TASK_TIER map
 *   3. Fallback: 'balanced' (Sonnet) — safe default for new tasks
 *
 * Accepts any string at runtime (TaskLabel is compile-time hint); unknown
 * tasks route to `balanced` with a one-time console warning.
 */
export function pickModel(task: TaskLabel | string): ResolvedModel {
  const override = loadOverride();
  const tier: ModelTier =
    override[task] ??
    DEFAULT_TASK_TIER[task as TaskLabel] ??
    'balanced';

  const { provider, model } = TIER_MODELS[tier];
  const { maxTokens } = TIER_DEFAULTS[tier];
  return { provider, model, tier, maxTokens };
}

/** Test-only: reset the env cache so tests can set LLM_ROUTING_JSON and re-query. */
export function _resetRouterCache() {
  cachedOverride = { raw: null as never, parsed: {} };
}

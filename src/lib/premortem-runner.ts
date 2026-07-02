/**
 * Premortem Runner — shared executor for Franzagos-style premortem agents.
 *
 * Each agent (Black Swan Hunter, Historian, Devil's Advocate ×2, Second-Order
 * Thinker, Contradiction Finder, VC Panel) ports cleanly into our existing
 * `intelligence_briefs` table — same shape as the correlator's output, just
 * with a different `brief_type` and a structured `recommended_actions` array.
 *
 * The 80% reuse lives here:
 *   - Pull project context + numbered assumptions for the system prompt
 *   - Call runAgent at the agent-specific tier
 *   - Parse the structured JSON output (each agent provides its own parser)
 *   - Insert one intelligence_briefs row
 *   - Audit-log via signal_activity_logs (brief_generated)
 *   - Optional postInsert hook for agent-specific side effects (e.g. Black Swan
 *     creating monitors per scenario)
 *
 * The 20% specific to each agent — system prompt, parser, brief shape, side
 * effects — is supplied via a `PremortemAgentConfig<TOutput>` object. See
 * src/lib/premortem-agents/*.ts for concrete agents.
 */

import { generateId } from '@/lib/api-helpers';
import { run, get } from '@/lib/db';
import { runAgent } from '@/lib/pi-agent';
import { recordAgentUsage } from '@/lib/cost-meter';
import { logSignalActivity } from '@/lib/signal-activity-log';
import { listAssumptions, type AssumptionRow } from '@/lib/assumptions';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { withBriefLanguage } from '@/lib/ecosystem-monitors';
import type { TaskLabel } from '@/lib/llm/router';

export interface PremortemBriefShape {
  title: string;
  /** Long-form prose synthesizing the agent's findings. */
  narrative: string;
  /** Optional — the Historian uses this for "punto di non ritorno", Black Swan for "if you had to bet". */
  temporal_prediction?: string | null;
  /** 0.0 – 1.0. Each agent decides; default 0.7 if absent. */
  confidence?: number;
  /**
   * The actionable output. Shape is agent-specific (a Black Swan scenario,
   * a Devil's Advocate problem, a Historian case study) but always JSON.
   * Surfaces in BriefCard's "recommended action" callout.
   */
  recommended_actions: unknown[];
  /** How many discrete items the agent produced (scenarios, cases, problems). */
  item_count: number;
  /** Optional entity tag — e.g. competitor name for a VC verdict. */
  entity_name?: string | null;
  /** Optional expiry timestamp. Premortem briefs decay slower than correlation briefs. */
  valid_until?: string | null;
}

export interface PremortemAgentConfig<TOutput> {
  /** Short slug — used in audit logs and the brief_type column. */
  agentType:
    | 'black_swan'
    | 'historian'
    | 'devil_internal'
    | 'devil_external'
    | 'second_order'
    | 'contradiction'
    | 'vc_verdict';
  /** Value written to intelligence_briefs.brief_type. */
  briefType: string;
  /** System prompt for the LLM. Should explain the agent's mandate. */
  systemPrompt: string;
  /** Routing tier. Black Swan + Historian = balanced; VC Panel = premium. */
  task: TaskLabel;
  /** Token budget for the model call. */
  timeoutMs?: number;
  /** Parse the LLM output to the agent's structured type. Return null on parse failure. */
  parse(text: string): TOutput | null;
  /** Convert parsed output into a row-shaped brief. */
  toBrief(parsed: TOutput): PremortemBriefShape;
  /**
   * Optional side effects after the brief row is inserted. For Black Swan,
   * this is "create N monitors, one per scenario". Receives the parsed output,
   * the inserted brief_id, and the project context — returns metadata to log.
   */
  postInsert?(
    parsed: TOutput,
    briefId: string,
    projectId: string,
  ): Promise<Record<string, unknown>>;
}

export interface PremortemRunResult {
  brief_id: string;
  agent_type: string;
  item_count: number;
  side_effects: Record<string, unknown>;
}

const ASSUMPTION_BLOCK_HEADER = `\n\n## NUMBERED ASSUMPTION REGISTRY (#N format)\n\n` +
  `Reference each cited assumption by its number, e.g. "#7 [market, high]". Open ` +
  `high-criticality assumptions are the most important to address.\n\n`;

/**
 * Build the assumption-aware context block injected into every premortem
 * system prompt. Same registry as the chat agent's `list_open_assumptions`
 * tool, just delivered as plain text so the agent has the numbers at hand
 * without needing a tool roundtrip during a one-shot pass.
 */
async function buildAssumptionContext(projectId: string): Promise<string> {
  const rows = await listAssumptions(projectId, { status: 'open' }).catch(() => [] as AssumptionRow[]);
  if (rows.length === 0) return '';
  const lines = rows.map(
    (a) => `#${a.number} [${a.category}, ${a.criticality}]: ${a.text}`,
  );
  return ASSUMPTION_BLOCK_HEADER + lines.join('\n');
}

/**
 * Execute one premortem pass and persist the output as an intelligence_brief.
 *
 * Idempotency note: every call creates a new brief row (the premortem isn't
 * unique-keyed on anything besides timestamp). Callers that want
 * "don't re-run if a fresh one exists" should check before invoking — see
 * the chat tool's stale-check pattern.
 *
 * Cost note: this is a single LLM call routed at the agent's tier. Black Swan
 * and Historian → balanced (~$0.02/run). VC Panel → premium (~$0.30/run).
 * Caller is responsible for budget gating via `isProjectCapped`.
 */
export async function runPremortemPass<TOutput>(
  projectId: string,
  context: string,
  config: PremortemAgentConfig<TOutput>,
): Promise<PremortemRunResult> {
  const assumptionContext = await buildAssumptionContext(projectId);
  // Premortem briefs are founder-facing Intel — emit in the project's language.
  // resolveLocale(null, projectId) returns the project locale (which wins).
  const locale = await resolveLocale(null, projectId);
  const fullPrompt = withBriefLanguage(
    `Project context:\n\n${context}\n\nReturn JSON only.`,
    locale === 'it' ? 'it' : 'en',
  );
  const systemPrompt = config.systemPrompt + assumptionContext;

  const startedAt = Date.now();
  const agentResult = await runAgent(fullPrompt, {
    systemPrompt,
    task: config.task,
    tools: false,
    timeout: config.timeoutMs ?? 90_000,
    maxToolCalls: 0,
  });
  await recordAgentUsage({
    project_id: projectId,
    step: `premortem-${config.agentType}`,
    task: config.task,
    usage: agentResult.usage,
    latency_ms: Date.now() - startedAt,
  });

  const parsed = config.parse(agentResult.text);
  if (!parsed) {
    throw new PremortemParseError(
      `${config.agentType} agent returned non-JSON or unparseable output`,
      agentResult.text.slice(0, 800),
    );
  }

  const brief = config.toBrief(parsed);
  const briefId = generateId('ib');
  const now = new Date().toISOString();

  await run(
    `INSERT INTO intelligence_briefs
       (id, project_id, brief_type, entity_name, title, narrative,
        temporal_prediction, confidence, signal_ids, signal_count,
        recommended_actions, valid_until, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    briefId,
    projectId,
    config.briefType,
    brief.entity_name ?? null,
    brief.title,
    brief.narrative,
    brief.temporal_prediction ?? null,
    brief.confidence ?? 0.7,
    // signal_ids is required NOT NULL — empty array is the right value for
    // premortem briefs since they don't fold individual ecosystem signals.
    [],
    brief.item_count,
    brief.recommended_actions,
    brief.valid_until ?? null,
    now,
  );

  let sideEffects: Record<string, unknown> = {};
  if (config.postInsert) {
    try {
      sideEffects = await config.postInsert(parsed, briefId, projectId);
    } catch (err) {
      // The brief is already persisted. A failed side-effect should be visible
      // but not undo the brief — the founder can re-trigger the side effect
      // separately. Log it and continue.
      console.warn(
        `[premortem-runner] ${config.agentType} postInsert failed:`,
        (err as Error).message,
      );
      sideEffects = { post_insert_error: (err as Error).message };
    }
  }

  // Audit log — non-fatal. Uses the existing brief_generated event type so
  // the Signals "Activity" tab surfaces premortem runs alongside correlation
  // briefs without any UI change.
  await logSignalActivity({
    project_id: projectId,
    event_type: 'brief_generated',
    entity_id: briefId,
    entity_type: 'intelligence_brief',
    headline: `${config.agentType} · ${brief.title}`,
    metadata: {
      agent_type: config.agentType,
      brief_type: config.briefType,
      item_count: brief.item_count,
      ...sideEffects,
    },
  }).catch(() => { /* logging must never block */ });

  return {
    brief_id: briefId,
    agent_type: config.agentType,
    item_count: brief.item_count,
    side_effects: sideEffects,
  };
}

/**
 * Distinct error class so callers can present "the model output was malformed"
 * differently from "the DB write failed" — different user-facing copy.
 */
export class PremortemParseError extends Error {
  constructor(message: string, public sample: string) {
    super(message);
    this.name = 'PremortemParseError';
  }
}

/**
 * Parser helper — tolerates ```json fences and surrounding prose. Same pattern
 * used in src/lib/assumptions.ts's extractor and linker — extracted here
 * so each agent's parse() doesn't re-implement it.
 */
export function extractJsonObject(text: string): unknown | null {
  const stripped = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*$/g, '')
    .trim();
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(stripped.slice(first, last + 1));
  } catch {
    return null;
  }
}

/** Verify the project exists before launching an expensive premortem pass. */
export async function projectExists(projectId: string): Promise<boolean> {
  const row = await get<{ id: string }>(
    'SELECT id FROM projects WHERE id = ?',
    projectId,
  );
  return !!row;
}

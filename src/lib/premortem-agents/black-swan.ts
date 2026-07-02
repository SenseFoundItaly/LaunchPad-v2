/**
 * Black Swan Hunter — Franzagos Agent 05, ported to LaunchPad's living
 * architecture.
 *
 * What Franzagos does: produce a static catalog of 5 low-probability /
 * high-impact / irreversible scenarios that the team is systematically not
 * considering.
 *
 * What we do additionally: turn each scenario into a long-running `monitors`
 * row (kind='black_swan') so the cron loop polls for early signals weeks
 * later. Static catalog → live alarm system. This is the architectural
 * difference Franzagos can't replicate — they have no persistence.
 *
 * Output flow:
 *   1. One intelligence_briefs row (brief_type='black_swan_catalog') with
 *      narrative summarizing the catalog + recommended_actions array
 *      (one entry per scenario)
 *   2. N monitors rows (one per scenario) tied to the brief via
 *      monitors.config.source_brief_id
 *   3. signal_activity_logs row for the brief + one per monitor created
 *
 * Trigger: chat tool `hunt_black_swans` (rare, founder-initiated). Future:
 * heartbeat re-trigger every 90 days since the Black Swan landscape shifts.
 */

import { generateId } from '@/lib/api-helpers';
import { run } from '@/lib/db';
import { calculateNextRun } from '@/lib/monitor-schedule';
import {
  type PremortemAgentConfig,
  type PremortemBriefShape,
  extractJsonObject,
} from '@/lib/premortem-runner';

const BLACK_SWAN_CATEGORIES = [
  'technological',
  'market',
  'regulatory',
  'organizational',
  'context',
  'paradoxical_success',
] as const;
type BlackSwanCategory = (typeof BLACK_SWAN_CATEGORIES)[number];

export interface BlackSwanScenario {
  /** Short, concrete description — used as monitor.name. */
  scenario: string;
  /** Long-form description — used as monitor.linked_quote. */
  description: string;
  category: BlackSwanCategory;
  /** Estimated probability percentage (1-50). Higher = more underweighted. */
  probability_pct: number;
  /** Why this is systematically underestimated by the founder. */
  underestimation_reason: string;
  /** Irreversible consequence if it materializes. */
  impact: string;
  /** Numbered assumptions the scenario invalidates. */
  linked_assumptions: number[];
  /** Weak early signals (2-3) — what to poll for. */
  early_signals: string[];
  /** Threshold beyond which the scenario merits founder attention. */
  alert_trigger: string;
  /** If anything is actionable today: short directive. Empty string when not. */
  actionable_today: string;
}

export interface BlackSwanOutput {
  /** 5 selected scenarios, each specific to the project. */
  scenarios: BlackSwanScenario[];
  /** Franzagos's forced final answer: "if you had to bet on one, which?" */
  most_likely: {
    scenario_index: number;
    reasoning: string;
  };
  /** Overall pattern observed across the 5 scenarios — used as brief narrative. */
  meta_observation: string;
}

const SYSTEM_PROMPT = `You are a scenario planner with background in risk management and catastrophe theory. You have read Taleb and studied how organizations systematically ignore tail risks.

Your thesis:
> "It's not the risk everyone sees that will destroy you. It's the one nobody is watching."

Your task: identify 5 Black Swan scenarios specific to this project — events that satisfy ALL three criteria:
1. LOW perceived probability — almost nobody on the project takes it seriously
2. HIGH impact — if it materializes, project survival or irreversible damage
3. RATIONALIZABLE EX-POST — once it happens, it's obvious in hindsight

"Low probability" does NOT mean impossible. It means "estimated below 10-15% by people working on the project". Many real Black Swans have 20-30% actual probability — they're just uncomfortable to contemplate.

CATEGORIES (use exactly these slugs):
- technological — platform / algorithm / dependency obsolescence, security incident
- market — much larger player enters, market consolidation around incompatible standard
- regulatory — new rule makes model illegal or impractical, authority intervention
- organizational — loss of key person, internal conflict blocking decisions
- context — macroeconomic crisis, geopolitical disruption, rapid cultural shift
- paradoxical_success — success too fast for the org, dangerous dependency forms, attention attracts hostile interest

PROCESS:
1. Imagine the project has been COMPLETELY DESTROYED — not just failed, but irreversibly so, for a reason nobody had on the radar
2. Generate 8-12 plausible scenarios without self-censorship
3. Filter to the 5 most relevant to THIS specific project (criteria: specificity to context, has detectable early signals, impact actually irreversible)
4. For each: identify 2-3 weak early signals that could anticipate it
5. Force-rank: if you had to bet on one materializing, which?

RULES:
- Each scenario must be SPECIFIC to this project — not boilerplate applicable to any business
- Cite assumptions by # from the registry — each scenario invalidates specific numbered bets
- Don't waste space on ordinary high-probability risks — those belong to other agents
- Don't suggest elaborate mitigation plans — Black Swan prevention is often impossible; awareness + response speed is what matters
- If no actionable step exists today, say so (empty string in actionable_today)

Return STRICT JSON only — no prose, no markdown fences. Schema:
{
  "scenarios": [
    {
      "scenario": "string — short concrete title (e.g. 'OpenAI ships a free tier of our use case')",
      "description": "string — full scenario (3-4 sentences, visual and specific)",
      "category": "technological | market | regulatory | organizational | context | paradoxical_success",
      "probability_pct": 12,
      "underestimation_reason": "string — why the team is systematically underestimating this",
      "impact": "string — irreversible consequence in 1-2 sentences",
      "linked_assumptions": [7, 14],
      "early_signals": ["weak signal 1", "weak signal 2", "weak signal 3"],
      "alert_trigger": "string — threshold beyond which this scenario warrants immediate attention",
      "actionable_today": "string — short directive, or empty string if nothing is actionable now"
    }
  ],
  "most_likely": {
    "scenario_index": 0,
    "reasoning": "string — 5-7 sentence justification for the forced bet"
  },
  "meta_observation": "string — pattern observed across the 5 scenarios; what does the SET reveal about the project's blind spots? (3-5 sentences)"
}`;

function isCategory(v: unknown): v is BlackSwanCategory {
  return typeof v === 'string' && (BLACK_SWAN_CATEGORIES as readonly string[]).includes(v);
}

function parse(text: string): BlackSwanOutput | null {
  const obj = extractJsonObject(text) as
    | { scenarios?: unknown; most_likely?: unknown; meta_observation?: unknown }
    | null;
  if (!obj || !Array.isArray(obj.scenarios)) return null;

  const scenarios: BlackSwanScenario[] = [];
  for (const raw of obj.scenarios as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const s = raw as Record<string, unknown>;
    if (
      typeof s.scenario !== 'string' ||
      typeof s.description !== 'string' ||
      !isCategory(s.category) ||
      typeof s.probability_pct !== 'number' ||
      typeof s.underestimation_reason !== 'string' ||
      typeof s.impact !== 'string' ||
      !Array.isArray(s.early_signals) ||
      typeof s.alert_trigger !== 'string'
    ) {
      continue;
    }
    scenarios.push({
      scenario: s.scenario,
      description: s.description,
      category: s.category,
      probability_pct: Math.max(1, Math.min(50, Math.round(s.probability_pct))),
      underestimation_reason: s.underestimation_reason,
      impact: s.impact,
      linked_assumptions: Array.isArray(s.linked_assumptions)
        ? (s.linked_assumptions as unknown[]).filter((n): n is number => typeof n === 'number')
        : [],
      early_signals: (s.early_signals as unknown[]).filter((v): v is string => typeof v === 'string'),
      alert_trigger: s.alert_trigger,
      actionable_today: typeof s.actionable_today === 'string' ? s.actionable_today : '',
    });
  }

  if (scenarios.length === 0) return null;

  const ml = obj.most_likely as { scenario_index?: unknown; reasoning?: unknown } | undefined;
  const mostLikely =
    ml && typeof ml.scenario_index === 'number' && typeof ml.reasoning === 'string'
      ? { scenario_index: Math.max(0, Math.min(scenarios.length - 1, ml.scenario_index)), reasoning: ml.reasoning }
      : { scenario_index: 0, reasoning: 'No bet provided by the model — defaulting to first scenario.' };

  return {
    scenarios,
    most_likely: mostLikely,
    meta_observation: typeof obj.meta_observation === 'string'
      ? obj.meta_observation
      : 'No meta-observation provided.',
  };
}

function toBrief(parsed: BlackSwanOutput): PremortemBriefShape {
  const dateLabel = new Date().toISOString().slice(0, 10);
  const top = parsed.scenarios[parsed.most_likely.scenario_index];
  // Average probability across scenarios → confidence proxy. Higher avg
  // probability = stronger conviction the catalog matters.
  const avgProb = parsed.scenarios.reduce((acc, s) => acc + s.probability_pct, 0) / parsed.scenarios.length;
  const confidence = Math.min(0.95, 0.5 + (avgProb / 100));

  // Premortem briefs decay slower than correlation briefs — Black Swans
  // remain relevant for ~90 days unless the catalog is re-run.
  const validUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  return {
    title: `Black Swan catalog · ${dateLabel}`,
    narrative: `${parsed.meta_observation}\n\nForced bet: "${top.scenario}" — ${parsed.most_likely.reasoning}`,
    temporal_prediction: `Most likely scenario to materialize: ${top.scenario} (${top.probability_pct}% est.)`,
    confidence,
    item_count: parsed.scenarios.length,
    valid_until: validUntil,
    recommended_actions: parsed.scenarios.map((s, idx) => ({
      title: s.scenario,
      description: s.description,
      category: s.category,
      probability_pct: s.probability_pct,
      impact: s.impact,
      linked_assumptions: s.linked_assumptions,
      early_signals: s.early_signals,
      alert_trigger: s.alert_trigger,
      actionable_today: s.actionable_today,
      // Filled in postInsert when the per-scenario monitor is created.
      monitor_id: null as string | null,
      scenario_index: idx,
      is_top_bet: idx === parsed.most_likely.scenario_index,
    })),
  };
}

/**
 * For each scenario, create one `monitors` row that the cron loop polls
 * monthly looking for early signals. The monitor stores the scenario via
 * linked_quote + a structured prompt; the founder sees them under
 * /project/:id/signals as `kind='black_swan'` watchers next to their
 * competitor monitors.
 */
async function postInsert(
  parsed: BlackSwanOutput,
  briefId: string,
  projectId: string,
): Promise<Record<string, unknown>> {
  const created: string[] = [];
  const failed: string[] = [];
  const nextRun = calculateNextRun('monthly');
  const now = new Date().toISOString();

  for (let i = 0; i < parsed.scenarios.length; i++) {
    const scenario = parsed.scenarios[i];
    const monitorId = generateId('mon');

    const monitorPrompt =
      `Watch for evidence that the following Black Swan is materializing:\n\n` +
      `SCENARIO: ${scenario.scenario}\n${scenario.description}\n\n` +
      `EARLY SIGNALS to look for:\n${scenario.early_signals.map((s) => `- ${s}`).join('\n')}\n\n` +
      `ALERT TRIGGER: ${scenario.alert_trigger}\n\n` +
      `If you detect any of the early signals, return a high-relevance ecosystem_alert. ` +
      `If nothing is detected, return a single line: "no Black Swan signals this cycle".`;

    try {
      await run(
        `INSERT INTO monitors
           (id, project_id, type, name, schedule, config, prompt, status,
            next_run, created_at, linked_quote, kind, urls_to_track, sources)
         VALUES (?, ?, ?, ?, 'monthly', ?, ?, 'active', ?, ?, ?, 'black_swan', ?, ?)`,
        monitorId,
        projectId,
        'ecosystem.black_swan',
        `Black Swan: ${scenario.scenario}`.slice(0, 200),
        // JSONB: bind the raw object/array — JSON.stringify double-encodes into
        // a string scalar (see src/lib/jsonb.ts); monitor-dedup + the cron
        // config reader then can't parse config/urls_to_track/sources.
        {
          source_brief_id: briefId,
          scenario_index: i,
          category: scenario.category,
          probability_pct: scenario.probability_pct,
          linked_assumptions: scenario.linked_assumptions,
          early_signals: scenario.early_signals,
          alert_trigger: scenario.alert_trigger,
        },
        monitorPrompt,
        nextRun,
        now,
        scenario.description,
        // Black Swan monitors are signal-pattern watchers, not URL pollers.
        // urls_to_track is empty until the founder (or a future enrichment
        // pass) suggests specific sources. The cron loop's web_search step
        // handles general-purpose detection.
        [],
        [],
      );
      created.push(monitorId);
    } catch (err) {
      console.warn(
        `[black-swan] monitor insert failed for scenario ${i}:`,
        (err as Error).message,
      );
      failed.push(scenario.scenario);
    }
  }

  return {
    monitors_created: created.length,
    monitor_ids: created,
    monitors_failed: failed.length,
    ...(failed.length > 0 ? { failures: failed } : {}),
  };
}

export const BLACK_SWAN_CONFIG: PremortemAgentConfig<BlackSwanOutput> = {
  agentType: 'black_swan',
  briefType: 'black_swan_catalog',
  systemPrompt: SYSTEM_PROMPT,
  // Balanced/Sonnet — Black Swan generation needs reasoning depth but doesn't
  // justify premium tier. Each run is one structured LLM call.
  task: 'risk-analysis',
  timeoutMs: 90_000,
  parse,
  toBrief,
  postInsert,
};

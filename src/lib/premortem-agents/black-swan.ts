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
 *   2. N configure_monitor pending actions (one per scenario) — approve-first;
 *      the founder's apply creates the monitors row, tied to the brief via
 *      monitors.config.source_brief_id
 *
 * Trigger: chat tool `hunt_black_swans` (rare, founder-initiated). Future:
 * heartbeat re-trigger every 90 days since the Black Swan landscape shifts.
 */

import { query } from '@/lib/db';
import { createPendingAction } from '@/lib/pending-actions';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { translate } from '@/lib/i18n/messages';
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
 * For each scenario, STAGE one `configure_monitor` pending action — the same
 * approval lane every other watcher rides (phase1-watchers, chat proposals).
 * Approving in the Inbox runs the configureMonitor executor, which creates
 * the live `kind='black_swan'` monitor the cron loop polls monthly; unchecked
 * ones stay visible as "Proposed" in the Watchers tab.
 *
 * This used to INSERT monitors directly with status='active' — up to 5
 * watchers polling with no founder yes, the one bypass of the "watchers are
 * approve-first, never auto-activated" invariant (2026-07-10 audit INV6).
 */
async function postInsert(
  parsed: BlackSwanOutput,
  briefId: string,
  projectId: string,
): Promise<Record<string, unknown>> {
  const proposed: string[] = [];
  const failed: string[] = [];

  // Idempotency (mirror of phase1-watchers): a re-run — force:true fresh
  // catalog, the future 90-day heartbeat, a double-fired chat tool — must not
  // stack a second set of 5 cards on top of ones the founder hasn't decided
  // yet. Pending/edited only: once the old catalog's cards are resolved
  // (approved or dismissed), an explicitly requested fresh catalog may stage
  // new proposals.
  const prior = await query<{ id: string }>(
    `SELECT id FROM pending_actions
      WHERE project_id = ? AND status IN ('pending','edited')
        AND payload->>'origin' = 'black_swan_catalog'
      LIMIT 1`,
    projectId,
  );
  if (prior.length > 0) {
    console.info(`[black-swan] skipping monitor proposals for ${projectId} — a pending catalog set already awaits the founder`);
    return { monitors_proposed: 0, proposal_ids: [], monitors_failed: 0, skipped: 'pending_catalog_exists' };
  }

  // Card chrome follows the project locale (the scenario CONTENT is already
  // generated in the project language by the premortem runner) — English
  // titles wrapping Italian scenarios broke the "project.locale drives all
  // in-project UI" rule.
  const owner = (await query<{ owner_user_id: string | null }>(
    'SELECT owner_user_id FROM projects WHERE id = ?', projectId,
  ))[0];
  const locale = await resolveLocale(owner?.owner_user_id ?? null, projectId);

  for (let i = 0; i < parsed.scenarios.length; i++) {
    const scenario = parsed.scenarios[i];

    const monitorPrompt =
      `Watch for evidence that the following Black Swan is materializing:\n\n` +
      `SCENARIO: ${scenario.scenario}\n${scenario.description}\n\n` +
      `EARLY SIGNALS to look for:\n${scenario.early_signals.map((s) => `- ${s}`).join('\n')}\n\n` +
      `ALERT TRIGGER: ${scenario.alert_trigger}\n\n` +
      `If you detect any of the early signals, return a high-relevance ecosystem_alert. ` +
      `If nothing is detected, return a single line: "no Black Swan signals this cycle".`;

    try {
      const action = await createPendingAction({
        project_id: projectId,
        action_type: 'configure_monitor',
        title: translate(locale, 'blackswan.card-title', { name: scenario.scenario }).slice(0, 200),
        rationale: translate(locale, 'blackswan.card-rationale', {
          impact: scenario.impact,
          pct: scenario.probability_pct,
          reason: scenario.underestimation_reason,
        }),
        payload: {
          name: translate(locale, 'blackswan.monitor-name', { name: scenario.scenario }).slice(0, 200),
          objective: scenario.description,
          kind: 'black_swan',
          schedule: 'monthly',
          // Full scan prompt supplied here — configureMonitor uses a payload
          // prompt verbatim instead of building a generic one.
          prompt: monitorPrompt,
          linked_quote: scenario.description,
          alert_threshold: scenario.alert_trigger,
          // 'ad_hoc' = the sentinel bucket exempt from one-per-(risk,kind)
          // dedup, so sibling scenario watchers can all be applied.
          linked_risk_id: 'ad_hoc',
          // Black Swan monitors are signal-pattern watchers, not URL pollers —
          // the cron loop's web_search step handles detection. The scenario
          // title doubles as the search query AND as the dedup-hash input:
          // with empty urls + no query all 5 siblings hashed identically
          // (H("#")), so only the FIRST approval survived the apply-time
          // exact-hash dedup — scenarios 2-5 failed forever (audit H2).
          query: scenario.scenario,
          urls_to_track: [],
          // Scenario metadata the cron/config reader needs — merged into
          // monitors.config by the executor's config passthrough.
          config: {
            source_brief_id: briefId,
            scenario_index: i,
            category: scenario.category,
            probability_pct: scenario.probability_pct,
            linked_assumptions: scenario.linked_assumptions,
            early_signals: scenario.early_signals,
            alert_trigger: scenario.alert_trigger,
          },
          origin: 'black_swan_catalog',
        },
        estimated_impact: 'high',
      });
      proposed.push(action.id);
    } catch (err) {
      console.warn(
        `[black-swan] monitor proposal failed for scenario ${i}:`,
        (err as Error).message,
      );
      failed.push(scenario.scenario);
    }
  }

  return {
    monitors_proposed: proposed.length,
    proposal_ids: proposed,
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

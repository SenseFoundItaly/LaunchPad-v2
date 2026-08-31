/**
 * Skill executor — server-side, headless skill invocation.
 *
 * Phase E of the NanoCorp v2 plan. Until now skills were only invokable as
 * tools-in-chat (src/lib/skill-tools.ts) — there was no `runSkill(projectId,
 * skillId)` callable from the daily heartbeat. This module adds that path
 * for ANALYTICAL-only skills (no draft producers like pitch-coaching that
 * need founder voice).
 *
 * ⚠️ NO CALLER HAS EVER BEEN AUTOMATIC. Every caller is founder-driven: a score
 * request, a skill kickoff, or an approved run_skill proposal. The heartbeat
 * path this module was written for was never wired.
 *
 * `findStaleSkills`, `SAFE_AUTO_RERUN_SKILL_IDS` and `STALE_DAYS` lived here
 * with no callers until 2026-08-05, describing an auto-rerun that did not
 * exist. They were deleted because dead code that documents absent behaviour is
 * worse than no code: a cost review read the (mislabelled) usage rows plus this
 * header and concluded the product was silently re-running skills nobody asked
 * for — three times, with a recommendation to delete a feature that was never
 * built.
 *
 * If an auto-rerun is ever wanted, two rules it must satisfy, learned here:
 *   - Trigger on "an input this skill READS has changed" (canvas_versions +
 *     diffCanvas already do this), never on elapsed days. Re-running an
 *     unchanged project reproduces the same answer at full price.
 *   - PROPOSE, never run. "Skills propose, not run" is a product invariant, and
 *     an analysis the founder finds already done and already billed breaks it.
 *
 * Cost discipline: caller is responsible for budget gating. This module does
 * not check getCreditsRemaining — that decision belongs to the caller (the
 * heartbeat sets a higher headroom requirement than the chat path).
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { generateId } from '@/lib/api-helpers';
import { query, run, get } from '@/lib/db';
import { runAgent } from '@/lib/pi-agent';
import { recordUsage, ownerUserId } from '@/lib/cost-meter';
import { estimateCost } from '@/lib/telemetry';
import { pickModel } from '@/lib/llm/router';
import { recordEvent } from '@/lib/memory/events';
import { persistArtifact, persistScoreFromSummary } from '@/lib/artifact-persistence';
import { stageTechnicalValidationProposal } from '@/lib/auto-stage-validation';
import { isClarificationOnly } from '@/lib/skill-output';
import { buildSkillProjectContext } from '@/lib/skill-context';
import { persistResearchFromSkillOutput, extractResearchFields, type ResearchFields } from '@/lib/skill-research-persist';
import { parseMessageContent } from '@/lib/artifact-parser';
import { linkSkillCompletionToAssumptions } from '@/lib/assumptions';
import { SKILL_KICKOFFS } from '@/lib/stages';
import { stageSequenceLock } from '@/lib/journey/stage-lock';
import { computeSectionScoresFromSummary } from '@/lib/section-scoring';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales';
import { languageDirective } from '@/lib/agent-prompt';


/** Skills whose downstream persistence depends on a structured json payload in
 *  the output (parsed by persistResearchFromSkillOutput). */
/**
 * Skills whose output is PARSED downstream, with the contract that guarantees a
 * closed, parseable json block even when the run is cut short.
 *
 * Both entries exist because of the same live failure: the model writes a long
 * report, the 170s budget fires mid-sentence, the json fence never closes,
 * JSON.parse throws, and NOTHING persists while the run still reports
 * 'completed'. Luca's scoring blocker (#392) was exactly this — LocalPulse sat
 * at Stage 1 8/9 with a scorecard that said 54/100 and a `scores` table that
 * was empty.
 *
 * The rule that makes it survive truncation is ORDERING PLUS SIZE: a small
 * block that CLOSES early. parseScoreJson/`persistResearchFromSkillOutput`
 * iterate every fence and skip unparseable ones, so an early complete block is
 * read even when a later verbose one is severed. Ordering alone does not help —
 * an unclosed fence fails to parse no matter what came first.
 */
const STRUCTURED_JSON_CONTRACTS: Record<string, string> = {
  'market-research':
    'Once your research is done, your response MUST OPEN with the structured data from the "Output Format" section as a single ' +
    'fenced ```json code block (the market_research object with market_sizing, competitors[], and trends[]) — BEFORE any narrative, ' +
    "analysis or preamble. Do NOT replace it with a prose-only or markdown report. This json is parsed downstream to populate the " +
    "founder's research and knowledge graph. Keep the json COMPACT (at most 2 sources per item, at most 6 competitors) so it closes " +
    'properly; emit market_sizing and competitors FIRST inside the block, then write the full report as PROSE AFTER the block. ' +
    'This ordering is not cosmetic: the run has a hard time budget, and a small block that already CLOSED is the only thing that ' +
    "still parses if the run is cut short — without it the founder's research is silently lost even though the run looks successful. " +
    'Budget discipline: make AT MOST 4 web_search calls (batch them in one round), then STOP researching and write the json — ' +
    'a complete block from 4 searches beats a severed block from 8.',
  'startup-scoring':
    'Your response MUST OPEN with the compact json block from the "Output Format" section — before any narrative, analysis or ' +
    'preamble. It carries only overall_score, overall_grade, summary and one score + one-sentence rationale per dimension. ' +
    'Do NOT include weights, the grade scale, strengths/risks arrays, priorities or data gaps INSIDE the json — they are not ' +
    'read by the system and they are what pushes the run past its time budget. Write all of that as PROSE AFTER the block. ' +
    'This ordering is not cosmetic: if the run is cut short, a small block that already CLOSED is the only thing that still ' +
    "parses, and without it the founder's score is silently lost even though the run looks successful.",
  'clarity-scoring':
    'Your response MUST OPEN with the compact json block from the "Output Format" section — before any narrative. It carries ' +
    'overall_score, overall_grade, recommendation (GO | PIVOT PARZIALE | NO GO), summary and one score + one-sentence rationale ' +
    'per clarity variable. Do NOT use web search — this scoring reads ONLY the Idea Canvas. Write the verdict explanation and the ' +
    'revision suggestion as PROSE AFTER the block. A small block that already closed is the only thing that still parses if the ' +
    "run is cut short; without it the founder's score is silently lost even though the run looks successful.",
};
const STRUCTURED_JSON_SKILLS = new Set<string>(Object.keys(STRUCTURED_JSON_CONTRACTS));

/**
 * Wall-clock LLM budget for founder-initiated skill runs (the /skills route and
 * the inbox run_skill executor both pass this).
 *
 * 40s, NOT 170s and NOT the 90s of the first fix — the platform ceiling is the
 * real budget, and it is ~60 SECONDS, not the ~110s the first measurement
 * suggested. Re-measured live on the DEPLOYED function 2026-08-31 19:30Z
 * (authenticated pane session, PastaFresca): the sectioned run streamed 68
 * deltas and was killed at exactly 60s wall — nothing persisted, minutes
 * later. The earlier ~110s "survivor" datapoints were CONTAMINATED: gatewalk
 * sims and repair sessions run LOCALLY against the prod DB (dev==prod), so
 * the usage ledger cannot distinguish prod-served from local-served rows.
 * Every clean prod-served survivor is under 60s (clarity 35s; all 84 manual
 * monitor runs ≤59s — survivor bias at exactly the cap); Luca's morning kills
 * and tonight's are both consistent with ~60s.
 * A budget abort mid-stream is RECOVERABLE (text kept, fence parsed, run
 * persists); a platform kill is not. 40s + persistence (~5-10s warm) keeps
 * the whole request near ~50s. Raising this requires a clean re-measure ON
 * THE DEPLOYED FUNCTION — local runs prove nothing about the ceiling.
 */
export const SKILL_RUN_BUDGET_MS = 45_000;

/**
 * PARALLEL SECTIONED RUN — market-research only (for now).
 *
 * Why: one monolithic market-research call needs ~200s of wall-clock (searches
 * + a giant sourced json), which no request-served budget can afford — at the
 * 90s budget only market_sizing survived the cut and competitors/trends were
 * severed. June's reliable architecture was many small ~22s calls; this brings
 * that shape back deliberately: three parallel section calls (sizing /
 * competitors / trends+insights), each with its own compact json contract and
 * ≤2 searches, merged into ONE fence and handed to the UNCHANGED persistence
 * pipeline. Wall-clock = slowest section (+persist), not the sum — measured
 * well inside the platform ceiling — and each section only has to close a
 * small fence in its own window, so the full depth comes back.
 *
 * Failure model: sections run under Promise.allSettled — a failed/empty
 * section degrades that column only (the research upsert keeps prior values on
 * empty input); ALL sections failing yields empty text, which trips runSkill's
 * existing empty-output throw. The founder's live stream mirrors the sizing
 * section only — three interleaved parallel streams would be garbage.
 */
interface ResearchSection {
  key: 'sizing' | 'competitors' | 'trends';
  instruction: string;
  jsonSpec: string;
}

const SECTION_COMMON =
  "You are running ONE SECTION of the market-research skill; the other sections run in parallel, so do ONLY this section's work. Make AT MOST 2 web_search calls (batch them in ONE round), then STOP researching and write the output. Your ENTIRE response is a single fenced ```json code block — the very first characters you write are ```json and the last are ```. NO preamble ('Let me…'), NO narrative before or after, NO :::artifact blocks: prose is discarded, and every second spent on it risks the hard time budget cutting the block before it closes — an unclosed block persists NOTHING. Keep every string SHORT: calculations as one line of arithmetic, descriptions ≤ 20 words, at most 1 source per item.";

const MARKET_RESEARCH_SECTIONS: ResearchSection[] = [
  {
    key: 'sizing',
    instruction:
      "Section: MARKET SIZING ONLY (SKILL.md §1). Compute TAM/SAM/SOM — bottoms-up preferred, show the math in the calculation field.",
    jsonSpec:
      '{"market_research":{"market_sizing":{"tam":{"estimate","methodology","calculation","confidence","sources":[max 2]},"sam":{"estimate","methodology","constraints":[...]},"som":{"estimate","timeframe","assumptions":[...],"market_share_implied"}},"sources":[max 3 web sources]}}',
  },
  {
    key: 'competitors',
    instruction:
      'Section: COMPETITOR PROFILING ONLY (SKILL.md §2). Name 3-6 REAL companies with URLs — never "there are many players". Strengths AND weaknesses both matter: the weaknesses feed the differentiation evidence.',
    jsonSpec:
      '{"market_research":{"competitors":[3-6 of {"name","url","description","target_customer","pricing","traction","strengths":[...],"weaknesses":[...],"funding","threat_level":"low|medium|high","threat_reasoning","sources":[max 2]}],"sources":[max 3]}}',
  },
  {
    key: 'trends',
    instruction:
      'Section: MARKET TRENDS + CUSTOMER INSIGHTS ONLY (SKILL.md §3 + §5). 3-4 trends, each with an explicit tailwind/headwind direction; the buyer persona must name who makes the purchase decision.',
    jsonSpec:
      '{"market_research":{"trends":[3-4 of {"name","description","direction":"tailwind|headwind","timeframe","evidence","implication"}],"customer_insights":{"buyer_persona","user_persona","purchase_triggers":[...],"decision_criteria":[...],"common_objections":[...],"validation_questions":[...]},"sources":[max 3]}}',
  },
];

/** Per-section wall-clock cap. Sections run in parallel, so total ≈ this +
 *  persistence — keep the sum inside the measured platform ceiling (~60s on
 *  the deployed function; see SKILL_RUN_BUDGET_MS). */
const SECTION_BUDGET_CAP_MS = 45_000;

/** Sum tokens (and cost when every section reported one) across section runs so
 *  the single recordUsage row reflects the whole skill run, not one third. */
function mergeSectionUsages(list: unknown[]): unknown {
  const used = list.filter(Boolean) as Array<Record<string, unknown>>;
  if (used.length === 0) return undefined;
  let inT = 0, outT = 0, cost = 0, costKnown = true;
  for (const u of used) {
    inT += Number(u.input ?? u.inputTokens ?? u.input_tokens ?? 0) || 0;
    outT += Number(u.output ?? u.outputTokens ?? u.output_tokens ?? 0) || 0;
    const c = (u.cost as { total?: number } | undefined)?.total;
    if (typeof c === 'number' && c > 0) cost += c;
    else costKnown = false;
  }
  const merged: Record<string, unknown> = { input_tokens: inT, output_tokens: outT };
  if (costKnown && cost > 0) merged.cost = { total: cost };
  return merged;
}

async function runMarketResearchSectioned(args: {
  userMsg: string;
  /** SKILL.md body + project context, WITHOUT the monolithic output contract. */
  baseSystemPrompt: string;
  directive: string;
  timeoutMs: number;
  projectId: string;
  ownerId: string | null;
  onDelta?: (delta: string) => void;
}): Promise<Awaited<ReturnType<typeof runAgent>>> {
  const perSection = Math.min(args.timeoutMs, SECTION_BUDGET_CAP_MS);
  const settled = await Promise.allSettled(
    MARKET_RESEARCH_SECTIONS.map((s, i) => {
      let sys =
        `${args.baseSystemPrompt}\n\n=== OUTPUT CONTRACT (REQUIRED) ===\n${SECTION_COMMON}\n\n${s.instruction}\nJSON shape (keys are literal, values are yours): ${s.jsonSpec}`;
      if (args.directive) sys += `\n\n${args.directive}`;
      return runAgent(`${args.userMsg}\n\n(Parallel sectioned run — produce ONLY the ${s.key} section.)`, {
        systemPrompt: sys,
        timeout: perSection,
        task: 'skill-invoke',
        projectId: args.projectId,
        step: `market-research:${s.key}`,
        userId: args.ownerId ?? undefined,
        traceName: 'skill-run-section',
        // Only the first section mirrors deltas — parallel streams interleave.
        onDelta: i === 0 ? args.onDelta : undefined,
      });
    }),
  );

  const texts = settled.map((r, i) => {
    if (r.status === 'rejected') {
      console.warn(
        `[skill-executor] market-research section '${MARKET_RESEARCH_SECTIONS[i].key}' failed:`,
        (r.reason as Error)?.message,
      );
      return null;
    }
    return r.value.text?.trim() ? r.value.text : null;
  });
  const fields = texts.map((t) => (t ? extractResearchFields(t) : null));

  // Designated section first, any other section as fallback (a section that
  // overreached still contributes rather than being thrown away).
  const pick = <K extends keyof ResearchFields>(pref: number, k: K, has: (v: ResearchFields[K]) => boolean) => {
    for (const i of [pref, ...fields.map((_, j) => j).filter((j) => j !== pref)]) {
      const v = fields[i]?.[k];
      if (v != null && has(v)) return v;
    }
    return null;
  };
  const marketSizing = pick(0, 'marketSizing', (v) => typeof v === 'object');
  const competitors = pick(1, 'competitors', (v) => Array.isArray(v) && v.length > 0);
  const trends = pick(2, 'trends', (v) => Array.isArray(v) && v.length > 0);
  const customerInsights = pick(2, 'customerInsights', (v) => !!v && typeof v === 'object');
  const sources = fields.flatMap((f) => (Array.isArray(f?.sources) ? (f!.sources as unknown[]) : [])).slice(0, 8);

  const anyField = !!(marketSizing || competitors || trends || customerInsights);
  const prose = texts.filter(Boolean).join('\n\n---\n\n');
  if (!anyField) {
    // No section produced a parseable field — even if prose streamed, nothing
    // can persist, so a 'completed' row here would be the exact hollow-success
    // the original truncation bug produced (measured live 2026-08-31 19:47Z:
    // completed + 15KB summary + empty research row). Hand back empty text so
    // runSkill's empty-output throw fires and the founder gets the honest
    // failure note instead of a green check over nothing.
    console.error(
      `[skill-executor] market-research: ${texts.filter(Boolean).length}/3 sections returned text but NONE yielded a parseable field — failing the run honestly (prose len=${prose.length})`,
    );
    return { text: '', usage: mergeSectionUsages(settled.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof runAgent>>> => r.status === 'fulfilled').map((r) => r.value.usage)) as Awaited<ReturnType<typeof runAgent>>['usage'], timedOut: false, langfuseTraceId: null };
  }

  const merged = {
    market_research: {
      ...(marketSizing ? { market_sizing: marketSizing } : {}),
      ...(competitors ? { competitors } : {}),
      ...(trends ? { trends } : {}),
      ...(customerInsights ? { customer_insights: customerInsights } : {}),
      sources,
    },
  };
  // Merged fence FIRST: extractResearchFields takes the first parseable fence,
  // so the downstream pipeline sees one complete object regardless of what
  // each section emitted around its own block.
  const text = '```json\n' + JSON.stringify(merged) + '\n```\n\n' + prose;

  const fulfilled = settled.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof runAgent>>> => r.status === 'fulfilled');
  const timedOut = fulfilled.some((r) => r.value.timedOut);
  if (timedOut) {
    console.warn(`[skill-executor] market-research: one or more sections hit the ${perSection}ms section budget`);
  }
  return {
    text,
    usage: mergeSectionUsages(fulfilled.map((r) => r.value.usage)) as Awaited<ReturnType<typeof runAgent>>['usage'],
    timedOut,
    langfuseTraceId: fulfilled[0]?.value.langfuseTraceId ?? null,
  };
}

/**
 * The default whitelist for `runSkill`: analytical skills whose output is
 * structured data (gauge-chart, score-card, research). Draft producers —
 * pitch-coaching, prototype-spec, gtm-strategy, investor-relations — are
 * excluded because their output is founder-voice prose meant to be revised.
 *
 * ⚠️ The name says "auto rerun" and nothing in this codebase auto-reruns
 * anything. It is the guard for DIRECT calls: every real caller that runs a
 * founder-chosen skill passes `allowAnySkill: true` to bypass it, so in
 * practice this list only stops a programmatic caller from invoking a draft
 * producer headlessly. Kept (renaming touches every caller) but read it as
 * "safe to run without founder review", not as evidence of a cron.
 */
export const SAFE_AUTO_RERUN_SKILL_IDS: readonly string[] = [
  'startup-scoring',
  'clarity-scoring',
  'market-research',
  'risk-scoring',
  'simulation',
  'scientific-validation',
];

const SKILLS_DIR = join(process.cwd(), 'launchpad-skills');

interface SkillFrontmatter {
  name: string;
  description: string;
}

interface ParsedSkillBody {
  body: string;
  frontmatter: SkillFrontmatter;
}

/**
 * Load a skill's SKILL.md, return its body (post-frontmatter) + frontmatter.
 * Mirror of skill-tools.ts loader, kept inline so this module has no import
 * cycle with the chat tool path. For non-default locales, tries the curated
 * SKILL.<locale>.md first (same convention as agent-prompt.ts) and falls back
 * to the English SKILL.md — languageDirective covers the output language when
 * only the English body is found.
 */
function loadSkillBody(skillId: string, locale: Locale): ParsedSkillBody | null {
  const skillDir = join(SKILLS_DIR, skillId);
  const candidates =
    locale !== DEFAULT_LOCALE
      ? [join(skillDir, `SKILL.${locale}.md`), join(skillDir, 'SKILL.md')]
      : [join(skillDir, 'SKILL.md')];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, 'utf-8');
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) continue;

    const [, fmRaw, body] = match;
    const fm: Partial<SkillFrontmatter> = {};
    for (const line of fmRaw.split('\n')) {
      const kv = line.match(/^(\w[\w-]*):\s*(.+?)\s*$/);
      if (!kv) continue;
      const [, key, value] = kv;
      (fm as Record<string, string>)[key] = value;
    }
    if (!fm.name || !fm.description) continue;
    return { body: body.trim(), frontmatter: fm as SkillFrontmatter };
  }
  return null;
}

export interface RunSkillOptions {
  ownerUserId: string;
  /**
   * WHO asked for this run, recorded as the usage `step`.
   *
   * It used to be hardcoded 'heartbeat-executor' for every caller, a leftover
   * from when this module was written for the weekly heartbeat. The heartbeat
   * never wired it up — `findStaleSkills` has no callers to this day — so every
   * row under that label is actually a founder pressing a button, filed under
   * a name that reads as unattended background work.
   *
   * That mislabel cost a full cost review: $9.74 of founder-triggered analysis
   * was read as waste nobody had asked for, and a recommendation to delete a
   * feature that does not exist nearly shipped on the strength of it.
   */
  step?: string;
  /** Override the default kickoff prompt. */
  prompt?: string;
  /** Cap on agent wall-clock time. Defaults to 120s. */
  timeoutMs?: number;
  /** PR-A: memory_events id of the skill_invoked proposal this run fulfils, if
   *  the run was launched from an agent-proposed option. Recorded on the
   *  emitted skill_completed event so proposals can be marked acted-on. */
  proposalId?: string;
  /** Skip the internal stage-sequence lock check (the POST route already ran it
   *  and returned a localized 422, so re-checking would just rebuild the
   *  snapshot). Other callers omit this and get the guard. */
  bypassStageLock?: boolean;
  /** Streaming mirror — forwarded to runAgent so the skill's output streams live
   *  to the caller (the /skills SSE route) instead of dumping at the end. The
   *  buffered run + persistence + usage accounting are unchanged. */
  onDelta?: (delta: string) => void;
  /**
   * Iter-3 QA fix: bypass the SAFE_AUTO_RERUN_SKILL_IDS whitelist. The
   * whitelist exists to protect AUTO-rerun (heartbeat / cron) from re-running
   * draft-producer skills whose output needs editorial review. But the
   * founder-approved run_skill pending_action goes through this same
   * function, and from the founder's perspective they EXPLICITLY asked to
   * run the skill — they should not be gated by a heartbeat safety check.
   * Callers MUST set this true ONLY when the trigger is human-initiated.
   */
  allowAnySkill?: boolean;
}

export interface RunSkillResult {
  skill_id: string;
  summary: string;
  latency_ms: number;
  completed_at: string;
  artifacts_persisted: number;
  /** Client artifact id → server row id, mirroring the chat route's done-event
   *  map. The /skills SSE forwards it so usePersistedArtifact resolves and the
   *  Apply/Dismiss controls on skill-emitted knowledge cards go live (they
   *  rendered permanently disabled — "Saving proposal…" — without it). */
  persisted_artifacts: Record<string, { persisted_id: string; reviewed_state: 'pending' | 'applied' }>;
}

/**
 * Run an analytical skill end-to-end:
 *   1. Load SKILL.md body as system prompt.
 *   2. Run a single Pi Agent turn with the kickoff prompt.
 *   3. Persist artifacts via persistArtifact (routes gauge-chart → scores,
 *      research-summary → research.competitors, etc.).
 *   4. UPSERT skill_completions row.
 *   5. Emit memory_event(skill_completed) for the timeline.
 *
 * Throws on:
 *   - missing SKILL.md
 *   - empty agent output
 *   - LLM call timeout
 *
 * Caller is expected to wrap in try/catch — heartbeat must not fail because
 * one skill rerun blew up.
 */
export async function runSkill(
  projectId: string,
  skillId: string,
  opts: RunSkillOptions,
): Promise<RunSkillResult> {
  if (!opts.allowAnySkill && !SAFE_AUTO_RERUN_SKILL_IDS.includes(skillId)) {
    throw new Error(`runSkill: ${skillId} is not in the safe auto-rerun whitelist`);
  }
  // STAGE-SEQUENCE LOCK (defense-in-depth): Build/Fundraise/Operate skills can't
  // run until earlier stages are done. The POST route returns a clean localized
  // 422 before this and passes bypassStageLock; this guard covers EVERY OTHER
  // caller (the legacy Inbox run_skill executor, future callers) so the lock
  // can't be bypassed. Free for stage 1-4 skills (returns without a snapshot).
  if (!opts.bypassStageLock) {
    const lock = await stageSequenceLock(projectId, skillId);
    if (lock.locked) {
      throw new Error(`runSkill: ${skillId} is stage-locked — ${lock.message}`);
    }
  }
  // Every skill execution funnels through here, and it used to be locale-blind:
  // English SKILL.md, no directive → Italian projects got intermittently-English
  // skill output. Project locale wins over user preference (see resolveLocale).
  const locale = await resolveLocale(opts.ownerUserId, projectId).catch(() => DEFAULT_LOCALE);
  const loaded = loadSkillBody(skillId, locale);
  if (!loaded) {
    throw new Error(`runSkill: SKILL.md not found or unparseable for ${skillId}`);
  }

  const userMsg = opts.prompt || SKILL_KICKOFFS[skillId] || `Run the ${skillId} skill for the current project.`;

  // Inject authoritative project context (idea_canvas, research, competitors,
  // memory) so the skill agent doesn't run blind and ask "what's your startup?"
  // even when the canvas is filled. '' for a brand-new project → skill may ask.
  const projectContext = await buildSkillProjectContext(projectId, skillId).catch(() => '');
  // Base prompt (body + context) kept aside: the sectioned runner appends its
  // own per-section contracts instead of the monolithic one below.
  const baseSystemPrompt = projectContext ? `${loaded.body}\n\n${projectContext}` : loaded.body;
  let systemPrompt = baseSystemPrompt;

  // Research skills persist downstream from a structured json payload. The model
  // sometimes returns a prose/markdown report instead of the SKILL.md json block,
  // which persists nothing (confirmed live). Append a hard output contract so the
  // parseable json is always present (see persistResearchFromSkillOutput).
  const contract = STRUCTURED_JSON_CONTRACTS[skillId];
  if (contract) {
    systemPrompt += '\n\n=== OUTPUT CONTRACT (REQUIRED) ===\n' + contract;
  }

  // Language directive LAST (after the output contract) so recency keeps it
  // salient. The contract stays English on purpose — JSON keys must stay
  // English, and the directive itself exempts structured field keys.
  const directive = languageDirective(locale);
  if (directive) systemPrompt += `\n\n${directive}`;

  const startedAt = Date.now();
  const ownerId = await ownerUserId(projectId);

  // market-research runs as three PARALLEL section calls (see
  // runMarketResearchSectioned above) — one monolithic call needs ~200s and no
  // request-served budget survives that. Everything downstream of `text`
  // (artifact loop, research persist, gate staging, completion) is unchanged.
  const { text, usage, timedOut, langfuseTraceId } =
    skillId === 'market-research'
      ? await runMarketResearchSectioned({
          userMsg,
          baseSystemPrompt,
          directive: directive ?? '',
          timeoutMs: opts.timeoutMs ?? 120_000,
          projectId,
          ownerId,
          onDelta: opts.onDelta,
        })
      : await runAgent(userMsg, {
          systemPrompt,
          timeout: opts.timeoutMs ?? 120_000,
          task: 'skill-invoke',
          onDelta: opts.onDelta,
          // Attribute paid web_search / read_url (Exa/Jina) spend to this project.
          projectId,
          step: skillId,
          userId: ownerId ?? undefined,
          traceName: 'skill-run',
        });
  const latencyMs = Date.now() - startedAt;
  if (timedOut) {
    // The run was cut at the budget: `text` is whatever streamed before the
    // abort, and the machine-readable tail (scorecard ```json fence, artifact
    // blocks — emitted LAST per the SKILL.md format) is the likely casualty.
    // Log loudly so a truncated run is traceable when a downstream persist
    // (score, artifacts) comes up empty.
    console.warn(`[skill-executor] ${skillId} hit the ${opts.timeoutMs ?? 120_000}ms budget after ${latencyMs}ms — output truncated`);
  }

  if (!text || !text.trim()) {
    // Logged, not just thrown: this is the failure the founder sees as
    // "servono più dettagli" while NOTHING is persisted (no skill_completions
    // row at all), so without a log line the cause is invisible in prod.
    // Luca's 4/08 scoring blocker presented exactly this way.
    console.error(`[skill-executor] ${skillId} produced EMPTY output for project ${projectId} — no completion row will be written`);
    throw new Error(`runSkill ${skillId}: empty output`);
  }

  // Quality gate, computed up-front (before cost metering) so we can skip the
  // credit debit for a run that produced nothing usable — the founder shouldn't
  // pay for "what's your startup?" output. See isClarificationOnly.
  const incomplete = isClarificationOnly(text);

  // Cost meter — log against the actual provider/model from the router so
  // the slug matches what was called. Inject estimated cost when the runAgent
  // result's Usage doesn't carry one (mirrors chat/route.ts:550 and skill-
  // tools.ts pattern — without this, the row logs $0 and budget undercounts).
  const { provider, model } = pickModel('skill-invoke');
  const u = usage as unknown as { cost?: { total?: number }; input_tokens?: number; output_tokens?: number; inputTokens?: number; outputTokens?: number; input?: number; output?: number };
  const alreadyHasCost = typeof u?.cost?.total === 'number' && u.cost.total > 0;
  const executorUsage = alreadyHasCost
    ? usage
    : {
        ...usage,
        cost: {
          total: estimateCost(provider, model, {
            input_tokens: u.input ?? u.inputTokens ?? u.input_tokens ?? 0,
            output_tokens: u.output ?? u.outputTokens ?? u.output_tokens ?? 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          }),
        },
      };
  await recordUsage({
    project_id: projectId,
    skill_id: skillId,
    // Honest attribution: the caller says who it is. 'skill-run' is the neutral
    // default — never a name that implies nobody asked.
    step: opts.step ?? 'skill-run',
    provider,
    model,
    usage: executorUsage as typeof usage,
    latency_ms: latencyMs,
    skip_credit_debit: incomplete,
    userId: ownerId ?? undefined,
    langfuseTraceId,
  }).catch(err =>
    console.warn('[skill-executor] recordUsage failed:', (err as Error).message),
  );

  // Persist any structured artifacts the skill emitted (gauge-chart →
  // scores, comparison-table → research.competitors, etc.). Non-fatal — the
  // skill_completions row writes either way.
  let artifactsPersisted = 0;
  const persistedArtifacts: RunSkillResult['persisted_artifacts'] = {};
  try {
    const segments = parseMessageContent(text);
    for (const seg of segments) {
      if (seg.type !== 'artifact') continue;
      const result = await persistArtifact({ userId: opts.ownerUserId, projectId }, seg.artifact);
      if (result.persisted) {
        artifactsPersisted++;
        // Collect the id map for the done-event enrichment (chat route parity).
        if (result.persisted_id && seg.artifact.id) {
          persistedArtifacts[seg.artifact.id] = { persisted_id: result.persisted_id, reviewed_state: 'pending' };
        }
      }
    }
  } catch (err) {
    console.warn(`[skill-executor] artifact persist failed for ${skillId}:`, (err as Error).message);
  }

  // Research skills emit their payload as a json block (not :::artifact segments),
  // so persist it deterministically into research + PENDING graph_nodes — this is
  // what makes the founder's graph activate from a market-research run. Pending =
  // gate-respecting; the Canvas surfaces them as "proposed" for one-click apply.
  // Founder-facing summary: research skills emit raw json (for parsing); show the
  // clean markdown report instead. `text` stays raw for section-scoring + the
  // assumption linker, which parse the json. Falls back to raw text if unparsed.
  let displaySummary = text;
  try {
    const r = await persistResearchFromSkillOutput(projectId, skillId, text);
    if (r.ok) {
      artifactsPersisted += r.competitors + (r.marketSizeNode ? 1 : 0);
      if (r.markdown && r.markdown.trim()) displaySummary = r.markdown;
    }
  } catch (err) {
    console.warn(`[skill-executor] research persist failed for ${skillId}:`, (err as Error).message);
  }

  // UPSERT skill_completions — same shape as the POST /skills route.
  // startup-scoring emits its scorecard as prose ("Overall Score: 57/100"), not
  // always a gauge-chart artifact, so scores.overall_score can stay null even on a
  // good run (the Home score never appears). Persist it deterministically — fixes
  // the score landing for auto-scoring, manual runs, and cron alike.
  const isScoringSkill = skillId === 'startup-scoring' || skillId === 'clarity-scoring';
  if (isScoringSkill && !incomplete) {
    try {
      // force: a deliberate re-score must refresh the stored overall/dimensions.
      if (await persistScoreFromSummary(projectId, text, { force: true, source: skillId })) {
        artifactsPersisted++;
      } else {
        // false = no parseable score in the output (no closed json fence, no
        // recognizable "NN/100" phrasing — typical after a timeout truncation).
        // Without this log the run reads 'completed' everywhere while the
        // startup_scoring_baseline check silently stays red.
        console.warn(`[skill-executor] ${skillId} output had no parseable score — baseline NOT persisted (timed_out=${!!timedOut})`);
      }
    } catch (err) {
      console.warn(`[skill-executor] score fallback failed for ${skillId}:`, (err as Error).message);
    }
  }

  // technical-validation deterministic fallback (cert 2026-07-07): when the run
  // emitted NO parseable insight-cards (artifactsPersisted === 0), the three 1B
  // checks would stay red with nothing for the founder to apply. Stage the three
  // findings from the summary as ONE approve-to-green card — mirrors the
  // market-research → stageMarketSizeProposal fallback. Founder-first (pending).
  if (skillId === 'technical-validation' && !incomplete && artifactsPersisted === 0) {
    try {
      const r = await stageTechnicalValidationProposal(projectId, text);
      if (r.staged) artifactsPersisted++;
    } catch (err) {
      console.warn(`[skill-executor] technical-validation stage failed:`, (err as Error).message);
    }
  }

  const completedAt = new Date().toISOString();
  // Quality gate (computed up-front above): persist clarification-only output as
  // 'incomplete' with no section_scores so it can't feed the chat agent as
  // "completed evidence", score readiness from nothing, or render as a deliverable.
  const completionStatus = incomplete ? 'incomplete' : 'completed';
  const sectionScores = incomplete ? null : computeSectionScoresFromSummary(skillId, text);

  // Version history: copy current output to a versioned row before overwriting.
  try {
    const prev = await query<{ summary: string; completed_at: string }>(
      `SELECT summary, completed_at FROM skill_completions
       WHERE project_id = ? AND skill_id = ? AND status = 'completed'`,
      projectId, skillId,
    );
    if (prev[0]?.summary) {
      const ts = prev[0].completed_at?.replace(/[:.]/g, '-') || Date.now().toString();
      const versionedId = `${skillId}_v${ts}`;
      await run(
        `INSERT INTO skill_completions (id, project_id, skill_id, status, summary, completed_at)
         VALUES (?, ?, ?, 'completed', ?, ?)
         ON CONFLICT DO NOTHING`,
        generateId('skv'),
        projectId,
        versionedId,
        prev[0].summary,
        prev[0].completed_at,
      );
    }
  } catch (err) {
    console.warn('[skill-executor] version snapshot failed:', (err as Error).message);
  }

  await run(
    `INSERT INTO skill_completions (id, project_id, skill_id, status, summary, section_scores, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, skill_id) DO UPDATE SET
       status = excluded.status,
       summary = excluded.summary,
       section_scores = excluded.section_scores,
       completed_at = excluded.completed_at`,
    generateId('skc'),
    projectId,
    skillId,
    completionStatus,
    displaySummary,
    sectionScores ? JSON.stringify(sectionScores) : null,
    completedAt,
  );

  // Assumption linker — does this skill output validate or invalidate any of
  // the project's open assumptions? Non-fatal: a failed linker pass must not
  // poison the skill_completion write or downstream heartbeat narration.
  // ON CONFLICT keeps the original row id, so we resolve the canonical id by
  // (project_id, skill_id) — not the freshly minted generateId above.
  try {
    const completionRow = await get<{ id: string }>(
      'SELECT id FROM skill_completions WHERE project_id = ? AND skill_id = ?',
      projectId, skillId,
    );
    if (completionRow?.id) {
      await linkSkillCompletionToAssumptions(projectId, completionRow.id, skillId, text);
    }
  } catch (err) {
    console.warn('[skill-executor] assumption linker failed:', (err as Error).message);
  }

  // Timeline event. Heartbeat narration uses memory_events.
  try {
    await recordEvent({
      userId: opts.ownerUserId,
      projectId,
      eventType: 'skill_completed',
      payload: {
        skill_id: skillId,
        summary_preview: text.slice(0, 300),
        source: 'heartbeat-executor',
        artifacts_persisted: artifactsPersisted,
        // PR-A: links this completion back to the proposal that suggested it
        // (undefined for heartbeat/cron auto-runs, which have no proposal).
        ...(opts.proposalId ? { proposal_id: opts.proposalId } : {}),
      },
    });
  } catch (err) {
    console.warn('[skill-executor] skill_completed recordEvent failed:', (err as Error).message);
  }

  return {
    skill_id: skillId,
    summary: displaySummary,
    latency_ms: latencyMs,
    completed_at: completedAt,
    artifacts_persisted: artifactsPersisted,
    persisted_artifacts: persistedArtifacts,
  };
}

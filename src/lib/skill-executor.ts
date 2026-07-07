/**
 * Skill executor — server-side, headless skill invocation.
 *
 * Phase E of the NanoCorp v2 plan. Until now skills were only invokable as
 * tools-in-chat (src/lib/skill-tools.ts) — there was no `runSkill(projectId,
 * skillId)` callable from the daily heartbeat. This module adds that path
 * for ANALYTICAL-only skills (no draft producers like pitch-coaching that
 * need founder voice).
 *
 * Usage:
 *   const stale = findStaleSkills(projectId);
 *   if (stale.length > 0) {
 *     const result = await runSkill(projectId, stale[0].skill_id, { ownerUserId });
 *     // result.summary persisted; pending_action surfaces "score X → Y" to inbox
 *   }
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
import { recordUsage } from '@/lib/cost-meter';
import { estimateCost } from '@/lib/telemetry';
import { pickModel } from '@/lib/llm/router';
import { recordEvent } from '@/lib/memory/events';
import { persistArtifact, persistScoreFromSummary } from '@/lib/artifact-persistence';
import { isClarificationOnly } from '@/lib/skill-output';
import { buildSkillProjectContext } from '@/lib/skill-context';
import { persistResearchFromSkillOutput } from '@/lib/skill-research-persist';
import { parseMessageContent } from '@/lib/artifact-parser';
import { linkSkillCompletionToAssumptions } from '@/lib/assumptions';
import { SKILL_KICKOFFS } from '@/lib/stages';
import { computeSectionScoresFromSummary } from '@/lib/section-scoring';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales';
import { languageDirective } from '@/lib/agent-prompt';

/**
 * Whitelist — only analytical skills whose output is structured data
 * (gauge-chart, score-card, research) and contains no founder-voice prose
 * that would need editorial review. Draft producers (pitch-coaching,
 * prototype-spec, gtm-strategy, investor-relations) are EXCLUDED — their
 * output is meant for the founder to revise, not to be auto-rerun on a
 * cron and surfaced as "look what I refreshed."
 */
export const SAFE_AUTO_RERUN_SKILL_IDS: readonly string[] = [
  'startup-scoring',
  'market-research',
  'risk-scoring',
  'simulation',
  'scientific-validation',
];

export const STALE_DAYS = 14;

/** Skills whose downstream persistence depends on a structured json payload in
 *  the output (parsed by persistResearchFromSkillOutput). */
const STRUCTURED_JSON_SKILLS = new Set<string>(['market-research']);

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

export interface StaleSkill {
  skill_id: string;
  last_completed_at: string | null;
  days_since: number | null;
}

/**
 * Return skills in the safe-rerun whitelist that are either never-run or
 * older than STALE_DAYS, ordered with never-run first then oldest first.
 */
export async function findStaleSkills(projectId: string): Promise<StaleSkill[]> {
  const rows = await query<{ skill_id: string; completed_at: string | null }>(
    'SELECT skill_id, completed_at FROM skill_completions WHERE project_id = ?',
    projectId,
  );
  const byId = new Map<string, string>();
  for (const r of rows) {
    if (r.completed_at) byId.set(r.skill_id, r.completed_at);
  }

  const cutoffMs = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  const out: StaleSkill[] = [];
  for (const skillId of SAFE_AUTO_RERUN_SKILL_IDS) {
    const last = byId.get(skillId);
    if (!last) {
      out.push({ skill_id: skillId, last_completed_at: null, days_since: null });
      continue;
    }
    const lastMs = new Date(last).getTime();
    if (lastMs < cutoffMs) {
      const daysSince = Math.floor((Date.now() - lastMs) / (24 * 60 * 60 * 1000));
      out.push({ skill_id: skillId, last_completed_at: last, days_since: daysSince });
    }
  }

  // Never-run first (days_since null sorts first), then oldest first.
  out.sort((a, b) => {
    if (a.days_since === null && b.days_since !== null) return -1;
    if (b.days_since === null && a.days_since !== null) return 1;
    return (b.days_since ?? 0) - (a.days_since ?? 0);
  });

  return out;
}

export interface RunSkillOptions {
  ownerUserId: string;
  /** Override the default kickoff prompt. */
  prompt?: string;
  /** Cap on agent wall-clock time. Defaults to 120s. */
  timeoutMs?: number;
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
  const projectContext = await buildSkillProjectContext(projectId).catch(() => '');
  let systemPrompt = projectContext ? `${loaded.body}\n\n${projectContext}` : loaded.body;

  // Research skills persist downstream from a structured json payload. The model
  // sometimes returns a prose/markdown report instead of the SKILL.md json block,
  // which persists nothing (confirmed live). Append a hard output contract so the
  // parseable json is always present (see persistResearchFromSkillOutput).
  if (STRUCTURED_JSON_SKILLS.has(skillId)) {
    systemPrompt +=
      '\n\n=== OUTPUT CONTRACT (REQUIRED) ===\n' +
      'Your response MUST include the structured data from the "Output Format" section as a single fenced ```json code block ' +
      '(the market_research object with market_sizing, competitors[], and trends[]). A 1-2 sentence intro is fine, but the json ' +
      "block is mandatory — do NOT replace it with a prose-only or markdown report. This json is parsed downstream to populate " +
      "the founder's research and knowledge graph. Keep the json COMPACT (at most 2 sources per item, at most 6 competitors) so it " +
      "stays within length limits and closes properly; emit market_sizing and competitors FIRST.";
  }

  // Language directive LAST (after the output contract) so recency keeps it
  // salient. The contract stays English on purpose — JSON keys must stay
  // English, and the directive itself exempts structured field keys.
  const directive = languageDirective(locale);
  if (directive) systemPrompt += `\n\n${directive}`;

  const startedAt = Date.now();

  const { text, usage } = await runAgent(userMsg, {
    systemPrompt,
    timeout: opts.timeoutMs ?? 120_000,
    task: 'skill-invoke',
    onDelta: opts.onDelta,
    // Attribute paid web_search / read_url (Exa/Jina) spend to this project.
    projectId,
    step: skillId,
  });
  const latencyMs = Date.now() - startedAt;

  if (!text || !text.trim()) {
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
    step: 'heartbeat-executor',
    provider,
    model,
    usage: executorUsage as typeof usage,
    latency_ms: latencyMs,
    skip_credit_debit: incomplete,
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
  if (skillId === 'startup-scoring' && !incomplete) {
    try {
      // force: a deliberate re-score must refresh the stored overall/dimensions.
      if (await persistScoreFromSummary(projectId, text, { force: true })) artifactsPersisted++;
    } catch (err) {
      console.warn(`[skill-executor] score fallback failed for ${skillId}:`, (err as Error).message);
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

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { completeSimple, getModel, getEnvApiKey } from '@mariozechner/pi-ai';
import type { TextContent } from '@mariozechner/pi-ai';
import { pickModel, type TaskLabel } from './llm/router';
import { recordEvent } from './memory/events';
import { recordUsage } from './cost-meter';
import { estimateCost } from './telemetry';
import { run, get } from './db';
import { generateId } from './api-helpers';
import { computeSectionScoresFromSummary } from './section-scoring';

/**
 * Skills-as-tools — converts every launchpad-skills/<skill>/SKILL.md into an
 * AgentTool the chat agent can auto-invoke.
 *
 * Auto-invocation (enabled per plan decision): the agent decides during a
 * chat turn whether to invoke e.g. skill_market-research. Cost safety is
 * enforced by the budget gate in src/lib/cost-meter.ts — a runaway chain of
 * skill invocations crosses the cap, the NEXT turn is refused.
 *
 * One-level-deep: skill-internal LLM calls do NOT get skill tools (they get
 * only the default generic tools). Prevents recursion.
 */

const SKILLS_DIR = join(process.cwd(), 'launchpad-skills');

interface SkillFrontmatter {
  name: string;
  description: string;
  model_tier?: 'cheap' | 'balanced' | 'premium';
}

interface ParsedSkill {
  id: string;              // folder name, used as tool suffix (skill_<id>)
  frontmatter: SkillFrontmatter;
  body: string;            // markdown after the frontmatter — used as system prompt
}

// Module-level cache: skills are filesystem-static per process. Restart picks
// up new SKILL.md files (same convention as agent-prompt.ts).
let cachedSkills: ParsedSkill[] | null = null;

/**
 * Minimal YAML-frontmatter parser. SKILL.md files use only flat key:value
 * pairs, no nested maps, so a hand-written parser avoids pulling in gray-matter.
 */
function parseSkillFile(path: string, dirName: string): ParsedSkill | null {
  const raw = readFileSync(path, 'utf-8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const [, fmRaw, body] = match;
  const fm: Partial<SkillFrontmatter> = {};
  for (const line of fmRaw.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+?)\s*$/);
    if (!kv) continue;
    const [, key, value] = kv;
    (fm as Record<string, string>)[key] = value;
  }

  if (!fm.name || !fm.description) return null;

  return {
    id: dirName,
    frontmatter: fm as SkillFrontmatter,
    body: body.trim(),
  };
}

/** Load and cache all parseable SKILL.md files under launchpad-skills/. */
function loadSkills(): ParsedSkill[] {
  if (cachedSkills) return cachedSkills;
  cachedSkills = [];

  if (!existsSync(SKILLS_DIR)) return cachedSkills;

  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const skillPath = join(SKILLS_DIR, ent.name, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    const parsed = parseSkillFile(skillPath, ent.name);
    if (parsed) cachedSkills.push(parsed);
  }
  return cachedSkills;
}

/**
 * Public: get the set of skill tools for a project/user context. The chat
 * route adds these to `extraTools` alongside project-scoped tools.
 *
 * Each tool's execute() runs an isolated Pi agent with:
 *  - System prompt = skill body
 *  - User message = {context} from the tool call parameters
 *  - Model = pickModel('skill-invoke') override'd by skill frontmatter tier
 *  - NO skill tools (prevents recursion — one level deep only)
 *
 * Writes memory_event(skill_invoked) for observability + preference-learning.
 */
export interface SkillToolOptions {
  userId: string;
  projectId: string;
}

export function getSkillTools(opts: SkillToolOptions): AgentTool[] {
  const skills = loadSkills();
  return skills.map((skill) => buildSkillTool(skill, opts));
}

/**
 * Compact a skill's frontmatter.description into a prompt-efficient
 * tool description. Full frontmatter descriptions are often 100-200
 * tokens each — at 11 skills that's 1,100-2,200 tokens of prompt
 * overhead on every chat turn. The first-sentence version keeps the
 * agent informed enough to decide without drowning it.
 */
function compactDescription(fm: SkillFrontmatter): string {
  const raw = fm.description.trim();
  // First sentence (up to period, question, exclamation) OR first 120 chars.
  const firstSentence = raw.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? raw;
  const short = firstSentence.length > 120 ? firstSentence.slice(0, 117) + '...' : firstSentence;
  return short;
}

function buildSkillTool(skill: ParsedSkill, opts: SkillToolOptions): AgentTool {
  const toolName = `skill_${skill.id.replace(/-/g, '_')}`;
  const description = compactDescription(skill.frontmatter);

  return {
    name: toolName,
    label: skill.frontmatter.name,
    description,
    parameters: Type.Object({
      context: Type.Optional(
        Type.String({
          description:
            'Optional user-facing context or clarification to pass into the skill. If omitted, the skill runs with just its system prompt and project memory.',
        }),
      ),
    }),
    async execute(_id, params): Promise<AgentToolResult<unknown>> {
      const context = (params as { context?: string }).context || '';

      // Record invocation event BEFORE the call — if the skill throws, we
      // still have the trace entry for preference learning.
      await recordEvent({
        userId: opts.userId,
        projectId: opts.projectId,
        eventType: 'skill_invoked',
        payload: {
          skill_id: skill.id,
          invoker: 'agent',
          context_preview: context.slice(0, 200),
        },
      });

      const tier: TaskLabel = 'skill-invoke';
      const { provider, model } = pickModel(
        skill.frontmatter.model_tier
          ? (`skill-${skill.frontmatter.model_tier}` as string)
          : tier,
      );

      // One-shot LLM call via pi-ai's completeSimple — NOT a nested Agent
      // instance. The Agent class is designed for multi-turn tool-using
      // loops; a skill invocation is a single "run this prompt, return
      // text" round-trip and doesn't need that machinery. Using a nested
      // Agent here previously caused stalled chat streams because the
      // outer Agent's subscribe pattern and the inner Agent's subscribe
      // pattern could race in ways pi-agent-core doesn't guarantee safe.
      //
      // Per the AgentTool contract (node_modules/@mariozechner/pi-agent-
      // core/dist/types.d.ts): "Throw on failure instead of encoding
      // errors in content." We throw on missing output or timeout so the
      // outer agent sees a proper error tool_result.
      const userMsg = context || `Run the ${skill.frontmatter.name} skill for the current project.`;
      const apiKey = getEnvApiKey(provider as 'anthropic' | 'openrouter');

      const skillStart = Date.now();
      const assistantMessage = await completeSimple(
        getModel(provider as any, model as any),
        {
          systemPrompt: skill.body,
          messages: [{ role: 'user', content: userMsg, timestamp: Date.now() }],
        },
        {
          apiKey,
          // 120s — was 60s, but most skills (gtm-strategy, market-research,
          // investment-readiness) need >60s under realistic project context
          // (full Idea Canvas + memory facts + competitor data). Hitting 60s
          // routinely produced empty/$0 usage rows that masked timeouts as
          // "successful runs" downstream. The real safety net for runaway
          // cost is project_budgets in cost-meter.ts, not this timeout.
          signal: AbortSignal.timeout(120_000),
        },
      );

      // Log token usage — completeSimple returns pi-ai Usage on assistantMessage,
      // but pi-ai's Usage shape carries only tokens, not cost. Without a cost
      // field, recordUsage's extractCost() silently logs $0 — under-counting
      // spend by the full skill amount. Inject an estimated cost so the row
      // reflects real spend. Mirrors the chat route's pattern at
      // src/app/api/chat/route.ts:550 (streamUsage?.cost ?? estimateCost).
      const u = assistantMessage.usage as unknown as { cost?: { total?: number } };
      const alreadyHasCost = typeof u?.cost?.total === 'number' && u.cost.total > 0;
      const skillUsage = alreadyHasCost
        ? assistantMessage.usage
        : {
            ...assistantMessage.usage,
            cost: {
              total: estimateCost(provider, model, {
                input_tokens: (assistantMessage.usage as { input?: number; inputTokens?: number; input_tokens?: number }).input
                  ?? (assistantMessage.usage as { inputTokens?: number }).inputTokens
                  ?? (assistantMessage.usage as { input_tokens?: number }).input_tokens
                  ?? 0,
                output_tokens: (assistantMessage.usage as { output?: number; outputTokens?: number; output_tokens?: number }).output
                  ?? (assistantMessage.usage as { outputTokens?: number }).outputTokens
                  ?? (assistantMessage.usage as { output_tokens?: number }).output_tokens
                  ?? 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              }),
            },
          };
      recordUsage({
        project_id: opts.projectId,
        skill_id: skill.id,
        step: `skill-tool.${skill.id}`,
        provider,
        model,
        usage: skillUsage as typeof assistantMessage.usage,
        latency_ms: Date.now() - skillStart,
      }).catch((err) => console.warn(`[skill-tools] recordUsage failed for ${skill.id}:`, err));

      // Extract text content blocks from the assistant message.
      const output = assistantMessage.content
        .filter((c): c is TextContent => c.type === 'text')
        .map((c) => c.text)
        .join('\n')
        .trim();

      if (!output) {
        throw new Error(
          `Skill ${skill.id} produced no output (stopReason=${assistantMessage.stopReason ?? 'unknown'})`,
        );
      }

      // Seamless completion — same writes that POST /api/projects/{id}/skills
      // performs when the founder runs a skill from the Readiness UI. Closes
      // the chat→skill_completions gap so stages score in real time without
      // a separate UI step. Non-fatal: if the writes fail (FK violation,
      // schema mismatch), the chat tool still returns the prose output.
      try {
        await persistSkillCompletionFromChat({
          userId: opts.userId,
          projectId: opts.projectId,
          skillId: skill.id,
          summary: output,
        });
      } catch (err) {
        console.warn(
          `[skill-tools] persistSkillCompletion failed for ${skill.id} (non-fatal):`,
          (err as Error).message,
        );
      }

      return {
        content: [{ type: 'text', text: output }],
        details: { skill_id: skill.id, tier: skill.frontmatter.model_tier ?? 'balanced' },
      };
    },
  };
}

/**
 * Mirror of the writes POST /api/projects/{id}/skills performs when the
 * founder runs a skill from the Readiness UI. Invoked from the chat agent's
 * skill_* tools after the skill output completes so stage readiness, section
 * scores, and skill_completions stay in sync with chat-driven runs.
 *
 * Writes performed:
 *   1. UPSERT skill_completions (status=completed, summary, section_scores)
 *   2. Run skill-specific post-processor (e.g. idea-shaping → idea_canvas)
 *   3. Emit memory_event(skill_completed) for the timeline
 *
 * Idempotent: ON CONFLICT(project_id, skill_id) DO UPDATE — re-runs overwrite
 * the prior row. Founder running idea-shaping twice updates the canvas.
 */
async function persistSkillCompletionFromChat(args: {
  userId: string;
  projectId: string;
  skillId: string;
  summary: string;
}): Promise<void> {
  const { userId, projectId, skillId, summary } = args;

  const sectionScores = computeSectionScoresFromSummary(skillId, summary);

  await run(
    `INSERT INTO skill_completions (id, project_id, skill_id, status, summary, section_scores, completed_at)
     VALUES (?, ?, ?, 'completed', ?, ?, ?)
     ON CONFLICT(project_id, skill_id) DO UPDATE SET
       status = excluded.status,
       summary = excluded.summary,
       section_scores = excluded.section_scores,
       completed_at = excluded.completed_at`,
    generateId('skc'),
    projectId,
    skillId,
    summary,
    sectionScores ? JSON.stringify(sectionScores) : null,
    new Date().toISOString(),
  );

  // Skill-specific structured-output post-processors. Each handler upserts
  // into the canonical table that downstream surfaces read (idea_canvas
  // → Stage 1 readiness, etc.). Wrapped individually so one parser failure
  // doesn't block the others.
  try {
    await maybeWriteIdeaCanvas({ projectId, skillId, summary });
  } catch (err) {
    console.warn(
      `[skill-tools] idea_canvas post-processor failed (non-fatal):`,
      (err as Error).message,
    );
  }

  await recordEvent({
    userId,
    projectId,
    eventType: 'skill_completed',
    payload: {
      skill_id: skillId,
      summary_preview: summary.slice(0, 300),
      source: 'chat-skill-tool',
    },
  });
}

/**
 * Parse the JSON `{"idea_canvas": {...}}` block produced by the idea-shaping
 * skill and upsert into the idea_canvas table. Only runs when skillId is
 * 'idea-shaping'. Quiet no-op when the block is missing or malformed —
 * the skill_completions row still got written, founder can re-run.
 *
 * The skill's expected output schema (launchpad-skills/idea-shaping/SKILL.md)
 * has nested objects (problem.statement, solution.description, etc.). The
 * idea_canvas table stores flat strings, so we flatten by picking the most
 * semantically useful field per section.
 */
async function maybeWriteIdeaCanvas(args: {
  projectId: string;
  skillId: string;
  summary: string;
}): Promise<void> {
  if (args.skillId !== 'idea-shaping') return;

  // Find the largest balanced { ... } that contains "idea_canvas" — the
  // skill output usually has prose before/after the JSON block.
  const start = args.summary.indexOf('"idea_canvas"');
  if (start === -1) return;
  // Walk back to the enclosing `{`, then forward to find the matching `}`.
  let openIdx = args.summary.lastIndexOf('{', start);
  if (openIdx === -1) return;
  let depth = 0;
  let endIdx = -1;
  for (let i = openIdx; i < args.summary.length; i++) {
    const c = args.summary[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  if (endIdx === -1) return;

  let parsed: { idea_canvas?: Record<string, unknown> };
  try {
    parsed = JSON.parse(args.summary.slice(openIdx, endIdx + 1));
  } catch {
    return;
  }
  const ic = parsed.idea_canvas;
  if (!ic || typeof ic !== 'object') return;

  // Flatten nested → flat strings. Empty strings are treated as null so
  // COALESCE preserves the previous value on partial re-runs.
  const pickString = (obj: unknown, key: string): string => {
    if (!obj || typeof obj !== 'object') return '';
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === 'string' ? v.trim() : '';
  };
  const problem = pickString(ic.problem, 'statement') || pickString(ic, 'problem');
  const solution = pickString(ic.solution, 'description') || pickString(ic, 'solution');
  const target_market = pickString(ic.target_market, 'primary_segment') || pickString(ic, 'target_market');
  const value_proposition = pickString(ic.value_proposition, 'one_liner') || pickString(ic, 'value_proposition');
  const business_model = pickString(ic.business_model, 'revenue_model') || pickString(ic, 'business_model');
  const competitive_advantage = pickString(ic.competitive_advantage, 'moat_type') || pickString(ic, 'competitive_advantage');

  if (!problem && !solution && !target_market && !value_proposition) {
    return; // Nothing actionable to write.
  }

  await run(
    `INSERT INTO idea_canvas (project_id, problem, solution, target_market, value_proposition, business_model, competitive_advantage)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET
       problem = COALESCE(NULLIF(EXCLUDED.problem, ''), idea_canvas.problem),
       solution = COALESCE(NULLIF(EXCLUDED.solution, ''), idea_canvas.solution),
       target_market = COALESCE(NULLIF(EXCLUDED.target_market, ''), idea_canvas.target_market),
       value_proposition = COALESCE(NULLIF(EXCLUDED.value_proposition, ''), idea_canvas.value_proposition),
       business_model = COALESCE(NULLIF(EXCLUDED.business_model, ''), idea_canvas.business_model),
       competitive_advantage = COALESCE(NULLIF(EXCLUDED.competitive_advantage, ''), idea_canvas.competitive_advantage)`,
    args.projectId,
    problem,
    solution,
    target_market,
    value_proposition,
    business_model,
    competitive_advantage,
  );
}

/**
 * Returns the loaded skill manifest for debugging / listing in /api/health.
 * Useful to sanity-check that SKILL.md files are parseable.
 */
export function listSkillManifest() {
  return loadSkills().map((s) => ({
    id: s.id,
    name: s.frontmatter.name,
    description: s.frontmatter.description,
    tier: s.frontmatter.model_tier ?? 'balanced',
  }));
}

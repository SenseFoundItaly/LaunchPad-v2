import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { recordEvent } from './memory/events';
import { run } from './db';
import { generateId } from './api-helpers';
import { computeSectionScoresFromSummary } from './section-scoring';
import { createPendingAction } from './pending-actions';

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

      // Architecture C (real-time, approve-first): chat PROPOSES the skill; it
      // does NOT run it inline. Create a run_skill pending_action the founder
      // approves (cost shown), then the run_skill executor runs it real-time via
      // the unified runSkill. This keeps the chat turn fast (a DB insert, not a
      // 120s blocking LLM call — the root cause of the 180s chat timeouts) and
      // gives the founder consent + cost transparency before spending budget.
      {
        const propTier = skill.frontmatter.model_tier ?? 'balanced';
        const estCredits = propTier === 'premium' ? 10 : propTier === 'cheap' ? 1 : 4;
        const estEur = (estCredits / 200).toFixed(2);
        try {
          const proposal = await createPendingAction({
            project_id: opts.projectId,
            action_type: 'run_skill',
            title: `Run ${skill.frontmatter.name}? (~€${estEur}, ~${estCredits} credits)`,
            rationale: context ? context.slice(0, 280) : `Kick off ${skill.frontmatter.name} for this project.`,
            payload: { skill_id: skill.id, skill_label: skill.frontmatter.name, owner_user_id: opts.userId, context },
            estimated_impact: 'high',
            priority: 'high',
          });
          return {
            content: [{
              type: 'text',
              text: `Proposed "${skill.frontmatter.name}" (~€${estEur}, ~${estCredits} credits) — queued for the founder's one-click approval in the Inbox. It runs in real time once approved. Tell the founder what it will do and that it's ready to approve; do NOT wait for results this turn. (action ${proposal.id})`,
            }],
            details: { skill_id: skill.id, proposed: true },
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Could not queue ${skill.frontmatter.name}: ${(err as Error).message}` }],
            details: { skill_id: skill.id, proposed: false },
          };
        }
      }

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
  const openIdx = args.summary.lastIndexOf('{', start);
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

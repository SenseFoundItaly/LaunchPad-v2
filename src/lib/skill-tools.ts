import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { completeSimple, getModel, getEnvApiKey } from '@mariozechner/pi-ai';
import type { TextContent } from '@mariozechner/pi-ai';
import { pickModel, type TaskLabel } from './llm/router';
import { recordEvent } from './memory/events';
import { recordUsage } from './cost-meter';
import { run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';

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
          signal: AbortSignal.timeout(60_000),
        },
      );

      // Log token usage — completeSimple returns pi-ai Usage on assistantMessage.
      recordUsage({
        project_id: opts.projectId,
        skill_id: skill.id,
        step: `skill-tool.${skill.id}`,
        provider,
        model,
        usage: assistantMessage.usage,
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

      // Server-side persistence safety net. Skills are run via completeSimple
      // (no tools), so their output is text-only — including any structured
      // JSON the SKILL.md asks them to emit. Without parsing it back into the
      // domain tables, the skill's work stays trapped in chat history.
      //
      // idea-shaping specifically emits `"idea_canvas": { problem: {…}, … }`
      // per its prompt. We detect that block and upsert the columns we map.
      try {
        await persistSkillSideEffects(opts.projectId, skill.id, output);
      } catch (err) {
        console.warn(`[skill-tools] persistSkillSideEffects failed for ${skill.id} (non-fatal):`, (err as Error).message);
      }

      // Upsert skill_completions so the 7-stage readiness reflects this run.
      // Without this, chat-invoked skills (the most common path) never count
      // toward stage scores — the Knowledge page shows "0/2 skills" forever
      // even after the agent runs idea-shaping multiple times. Mirror's the
      // INSERT shape used by skill-executor.ts so both code paths converge.
      try {
        await run(
          `INSERT INTO skill_completions (id, project_id, skill_id, status, summary, completed_at)
           VALUES (?, ?, ?, 'completed', ?, CURRENT_TIMESTAMP)
           ON CONFLICT (project_id, skill_id) DO UPDATE SET
             status = 'completed',
             summary = EXCLUDED.summary,
             completed_at = CURRENT_TIMESTAMP`,
          generateId('sc'),
          opts.projectId,
          skill.id,
          output.slice(0, 10000),
        );
        console.log(`[skill-tools] upserted skill_completions for ${skill.id}`);
      } catch (err) {
        console.warn(`[skill-tools] skill_completions upsert failed for ${skill.id} (non-fatal):`, (err as Error).message);
      }

      return {
        content: [{ type: 'text', text: output }],
        details: { skill_id: skill.id, tier: skill.frontmatter.model_tier ?? 'balanced' },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Skill output → domain table persistence
// ---------------------------------------------------------------------------

/**
 * Parse a skill's text output for structured JSON blocks the SKILL.md asked
 * it to emit, and upsert them into the corresponding tables. Server-side
 * safety net: even if the skill sub-agent has no tools (it can't, because
 * completeSimple is single-turn), the founder's project knowledge still
 * accumulates.
 */
async function persistSkillSideEffects(projectId: string, skillId: string, text: string): Promise<void> {
  if (skillId === 'idea-shaping') {
    const canvas = extractJsonBlock(text, 'idea_canvas');
    if (canvas) await persistIdeaCanvasFromSkill(projectId, canvas);
  }
  // Future: market-research → research table, scientific-validation → graph_nodes, etc.
}

/**
 * Extract the value of `"<key>": { ... }` from the FIRST JSON code block in
 * the text. Skills emit fenced ```json blocks; we also tolerate inline JSON
 * objects with the key at the top level.
 */
function extractJsonBlock(text: string, key: string): Record<string, unknown> | null {
  // Prefer fenced ```json blocks (the SKILL.md uses this format)
  const fenced = text.match(/```json\s*\n([\s\S]*?)\n```/);
  const candidates: string[] = [];
  if (fenced && fenced[1]) candidates.push(fenced[1]);
  // Also try the unfenced full text
  candidates.push(text);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && key in parsed) {
        const v = (parsed as Record<string, unknown>)[key];
        if (v && typeof v === 'object') return v as Record<string, unknown>;
      }
    } catch {
      // not JSON or wrong shape — try the next candidate
    }
  }
  return null;
}

async function persistIdeaCanvasFromSkill(projectId: string, canvas: Record<string, unknown>): Promise<void> {
  // idea-shaping SKILL.md uses nested objects per section (e.g.
  //   problem: { statement: ..., who_affected: ..., ... }
  // ). We collapse each section to a single-paragraph string for the
  // corresponding flat idea_canvas column. Keeps the column model simple
  // and matches what update_idea_canvas accepts.
  const flatten = (section: unknown): string => {
    if (typeof section === 'string') return section.trim().slice(0, 600);
    if (!section || typeof section !== 'object') return '';
    const obj = section as Record<string, unknown>;
    // Prefer a "statement" or "description" field if present
    if (typeof obj.statement === 'string') return obj.statement.trim().slice(0, 600);
    if (typeof obj.description === 'string') return obj.description.trim().slice(0, 600);
    if (typeof obj.one_liner === 'string') return obj.one_liner.trim().slice(0, 600);
    // Otherwise join key:value pairs
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.trim()) parts.push(`${k}: ${v.trim()}`);
    }
    return parts.join(' · ').slice(0, 600);
  };

  const fields = [
    { col: 'problem', val: flatten(canvas.problem) },
    { col: 'solution', val: flatten(canvas.solution) },
    { col: 'target_market', val: flatten(canvas.target_market) },
    { col: 'business_model', val: flatten(canvas.business_model) },
    { col: 'competitive_advantage', val: flatten(canvas.competitive_advantage) },
    { col: 'value_proposition', val: flatten(canvas.value_proposition) },
    { col: 'unfair_advantage', val: flatten(canvas.unfair_advantage) },
  ].filter((f) => f.val);

  if (fields.length === 0) return;

  const cols = ['project_id', ...fields.map((f) => f.col)];
  const placeholders = ['?', ...fields.map(() => '?')];
  const setClauses = fields
    .map((f) => `${f.col} = COALESCE(NULLIF(EXCLUDED.${f.col}, ''), idea_canvas.${f.col})`)
    .join(', ');

  await run(
    `INSERT INTO idea_canvas (${cols.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (project_id) DO UPDATE SET
       ${setClauses},
       updated_at = CURRENT_TIMESTAMP`,
    projectId, ...fields.map((f) => f.val),
  );
  console.log(`[skill-tools] persisted idea_canvas fields:`, fields.map((f) => f.col));
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

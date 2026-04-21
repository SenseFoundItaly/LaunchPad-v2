import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { streamSimple, getModel, getEnvApiKey } from '@mariozechner/pi-ai';
import type { Message } from '@mariozechner/pi-ai';
import { Agent } from '@mariozechner/pi-agent-core';
import { pickModel, type TaskLabel } from './llm/router';
import { recordEvent } from './memory/events';

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

function buildSkillTool(skill: ParsedSkill, opts: SkillToolOptions): AgentTool {
  const toolName = `skill_${skill.id.replace(/-/g, '_')}`;
  const description = `${skill.frontmatter.description} (Skill: ${skill.frontmatter.name})`;

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
      recordEvent({
        userId: opts.userId,
        projectId: opts.projectId,
        eventType: 'skill_invoked',
        payload: {
          skill_id: skill.id,
          invoker: 'agent',
          context_preview: context.slice(0, 200),
        },
      });

      try {
        const tier: TaskLabel = 'skill-invoke';
        const { provider, model } = pickModel(
          skill.frontmatter.model_tier
            ? (`skill-${skill.frontmatter.model_tier}` as string)
            : tier,
        );

        // Run an isolated inner agent. No skill tools = no recursion.
        const innerAgent = new Agent({
          streamFn: streamSimple,
          getApiKey: (p) => getEnvApiKey(p),
        });
        innerAgent.state.model = getModel(provider as any, model as any);
        innerAgent.state.systemPrompt = skill.body;
        innerAgent.state.tools = []; // one-level-deep invariant

        const userMsg = context || `Run the ${skill.frontmatter.name} skill for the current project.`;
        let output = '';
        innerAgent.subscribe((event) => {
          if (
            event.type === 'message_update' &&
            event.assistantMessageEvent.type === 'text_delta'
          ) {
            output += event.assistantMessageEvent.delta;
          }
        });

        await innerAgent.prompt(userMsg);
        await innerAgent.waitForIdle();

        return {
          content: [{ type: 'text', text: output || '(skill produced no output)' }],
          details: { skill_id: skill.id, tier: skill.frontmatter.model_tier ?? 'balanced' },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Skill ${skill.id} failed: ${msg}` }],
          details: { skill_id: skill.id, error: true },
        };
      }
    },
  };
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

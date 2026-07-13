import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { recordEvent } from './memory/events';
import { run } from './db';
import { estimateSkillCredits } from '@/lib/credits';
import { stageSequenceLock } from '@/lib/journey/stage-lock';

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

      // STAGE-SEQUENCE LOCK (2026-07-13): Build & Launch / Fundraise / Operate
      // skills are locked until earlier stages are done. Tell the agent up front
      // so it EXPLAINS the lock and steers to the open stage, rather than
      // proposing a runnable option the run gate would then 422. No skill_invoked
      // event — nothing was really proposed.
      const lock = await stageSequenceLock(opts.projectId, skill.id);
      if (lock.locked) {
        return {
          content: [{
            type: 'text',
            text:
              `"${skill.frontmatter.name}" is LOCKED. ${lock.message} ` +
              `Do NOT offer it as a runnable option. Instead, briefly tell the founder it unlocks ` +
              `once the earlier stages are complete, and steer them to the current open stage's work.`,
          }],
          details: { skill_id: skill.id, locked: true, blocking_stage: lock.blockingStage },
        };
      }

      // Record invocation event BEFORE the call — if the skill throws, we
      // still have the trace entry for preference learning. The returned id is
      // the PROPOSAL id: we thread it through the option → run POST →
      // skill_completed payload so a run can be correlated back to the proposal
      // that suggested it (open vs. acted-on vs. lapsed). PR-A. recordEvent
      // returns '' on write failure — we simply omit proposal_id in that case.
      const proposalId = await recordEvent({
        userId: opts.userId,
        projectId: opts.projectId,
        eventType: 'skill_invoked',
        payload: {
          skill_id: skill.id,
          invoker: 'agent',
          context_preview: context.slice(0, 200),
        },
      });

      // Ephemeral inline proposal (founder directive 2026-06-11): chat PROPOSES
      // the skill in this chat turn. It does NOT run the skill inline, and
      // creates NO pending_action and NO DB row of any kind. If the founder
      // ignores the proposal, nothing persists; it lives only in the chat
      // transcript. If they click the option, the chat page POSTs to
      // /api/projects/{id}/skills?run=1 which runs the skill in real time
      // (skill_completions + section_scores), still without a pending_action.
      //
      // Surfacing (2026-06-16): the proposal is now ONE OPTION inside the
      // turn's trailing option-set (an option with `skill_id` runs the skill on
      // click via the `skill:run` streaming path), NOT a separate
      // skill-suggestion "Run" card. This kills the old double-affordance (a Run
      // card layered with a redundant "Run it now" option). We hand the agent a
      // ready-to-paste option object so it folds the skill straight into its
      // option-set — tool RESULTS aren't streamed to the client, so the agent
      // must place the option itself.
      //
      // NOTE: action_type 'run_skill' is now LEGACY. The executor + DB CHECK are
      // kept for back-compat with any pre-existing rows, but this tool no longer
      // CREATES run_skill rows and the Inbox is no longer the path to run a
      // skill. See src/lib/action-executors.ts (runSkillExecutor).
      const propTier = skill.frontmatter.model_tier ?? 'balanced';
      // Credits are the ONLY founder-facing money unit (matches the TopBar
      // badge). EUR/USD stays internal accounting. A2b: the estimate is now the
      // REAL median of this skill's recent metered runs (llm_usage_logs), not a
      // flat 1/4/10 tier guess that under-quoted by 30-66× — falls back to the
      // tier default only when the skill has no history yet.
      const estCredits = await estimateSkillCredits(skill.id, propTier);
      const rationale = context
        ? context.slice(0, 280)
        : `Kick off ${skill.frontmatter.name} for this project.`;
      // Escape for embedding inside a single-line JSON string: backslash, quote,
      // and the control chars that would otherwise break the option JSON.
      const safe = (s: string) =>
        s.replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
      const optionId = `run_${skill.id.replace(/[^a-z0-9]/gi, '_')}`;
      // The option object the agent drops into its trailing option-set's
      // options[]. `skill_id` makes the click RUN the skill; `credits` shows the
      // cost before the click. label is verb-first ≤6 words; description is the
      // one-line "what this will do".
      // `proposal_id` correlates the eventual run back to THIS proposal (PR-A).
      // Only emitted when the skill_invoked write succeeded (non-empty id) — a
      // valid crypto.randomUUID needs no escaping.
      const proposalIdField = proposalId ? `,"proposal_id":"${proposalId}"` : '';
      const optionSnippet =
        `{"id":"${optionId}","label":"Run ${safe(skill.frontmatter.name)}",` +
        `"description":"${safe(rationale)}","credits":${estCredits},"skill_id":"${safe(skill.id)}"${proposalIdField}}`;
      return {
        content: [{
          type: 'text',
          text:
            `Proposing "${skill.frontmatter.name}" (≈${estCredits} credits). This is EPHEMERAL — ` +
            `no Inbox row, nothing persists unless the founder runs it. Surface it as ONE OPTION in ` +
            `your turn's trailing option-set (do NOT emit a separate card). Add this option object to ` +
            `your option-set's options[] array (tweak the label/description wording to fit, but KEEP ` +
            `"skill_id", "credits"${proposalId ? ' and "proposal_id"' : ''} exactly — "skill_id" is what makes the click run the skill` +
            `${proposalId ? ', "proposal_id" links the run back to this suggestion' : ''}):\n\n` +
            `${optionSnippet}\n\n` +
            `Do NOT claim or invent the skill's findings — it has not run yet. One coherent option-set: ` +
            `the skill is just one of the choices, never a duplicate Run card plus a "run it now" option.`,
        }],
        details: { skill_id: skill.id, proposed: true, ephemeral: true },
      };
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

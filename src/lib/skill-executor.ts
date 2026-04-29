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
import { query, run } from '@/lib/db';
import { runAgent } from '@/lib/pi-agent';
import { recordUsage } from '@/lib/cost-meter';
import { pickModel } from '@/lib/llm/router';
import { recordEvent } from '@/lib/memory/events';
import { persistArtifact } from '@/lib/artifact-persistence';
import { parseMessageContent } from '@/lib/artifact-parser';
import { SKILL_KICKOFFS } from '@/lib/stages';

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

const SKILLS_DIR = join(process.cwd(), 'launchpad-skills');

interface SkillFrontmatter {
  name: string;
  description: string;
  model_tier?: 'cheap' | 'balanced' | 'premium';
}

interface ParsedSkillBody {
  body: string;
  frontmatter: SkillFrontmatter;
}

/**
 * Load a skill's SKILL.md, return its body (post-frontmatter) + frontmatter.
 * Mirror of skill-tools.ts loader, kept inline so this module has no import
 * cycle with the chat tool path.
 */
function loadSkillBody(skillId: string): ParsedSkillBody | null {
  const path = join(SKILLS_DIR, skillId, 'SKILL.md');
  if (!existsSync(path)) return null;
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
  return { body: body.trim(), frontmatter: fm as SkillFrontmatter };
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
}

export interface RunSkillResult {
  skill_id: string;
  summary: string;
  latency_ms: number;
  completed_at: string;
  artifacts_persisted: number;
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
  if (!SAFE_AUTO_RERUN_SKILL_IDS.includes(skillId)) {
    throw new Error(`runSkill: ${skillId} is not in the safe auto-rerun whitelist`);
  }
  const loaded = loadSkillBody(skillId);
  if (!loaded) {
    throw new Error(`runSkill: SKILL.md not found or unparseable for ${skillId}`);
  }

  const userMsg = opts.prompt || SKILL_KICKOFFS[skillId] || `Run the ${skillId} skill for the current project.`;
  const startedAt = Date.now();

  const { text, usage } = await runAgent(userMsg, {
    systemPrompt: loaded.body,
    timeout: opts.timeoutMs ?? 120_000,
    task: 'skill-invoke',
  });
  const latencyMs = Date.now() - startedAt;

  if (!text || !text.trim()) {
    throw new Error(`runSkill ${skillId}: empty output`);
  }

  // Cost meter — log against the actual provider/model from the router so
  // the slug matches what was called.
  const { provider, model } = pickModel('skill-invoke');
  recordUsage({
    project_id: projectId,
    skill_id: skillId,
    step: 'heartbeat-executor',
    provider,
    model,
    usage,
    latency_ms: latencyMs,
  }).catch(err =>
    console.warn('[skill-executor] recordUsage failed:', (err as Error).message),
  );

  // Persist any structured artifacts the skill emitted (gauge-chart →
  // scores, comparison-table → research.competitors, etc.). Non-fatal — the
  // skill_completions row writes either way.
  let artifactsPersisted = 0;
  try {
    const segments = parseMessageContent(text);
    for (const seg of segments) {
      if (seg.type !== 'artifact') continue;
      const result = await persistArtifact({ userId: opts.ownerUserId, projectId }, seg.artifact);
      if (result.persisted) artifactsPersisted++;
    }
  } catch (err) {
    console.warn(`[skill-executor] artifact persist failed for ${skillId}:`, (err as Error).message);
  }

  // UPSERT skill_completions — same shape as the POST /skills route.
  const completedAt = new Date().toISOString();
  await run(
    `INSERT INTO skill_completions (id, project_id, skill_id, status, summary, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, skill_id) DO UPDATE SET
       status = excluded.status,
       summary = excluded.summary,
       completed_at = excluded.completed_at`,
    generateId('skc'),
    projectId,
    skillId,
    'completed',
    text,
    completedAt,
  );

  // Timeline event. Heartbeat narration uses memory_events.
  try {
    recordEvent({
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
    summary: text,
    latency_ms: latencyMs,
    completed_at: completedAt,
    artifacts_persisted: artifactsPersisted,
  };
}

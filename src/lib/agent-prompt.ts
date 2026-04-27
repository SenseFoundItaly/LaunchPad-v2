/**
 * Agent Prompt Composer — loads SOUL, AGENTS, and optionally HEARTBEAT.md
 * from disk and composes them into the system prompt passed to the Pi Agent.
 *
 * Locale selection: when a project has `locale='it'`, the loader looks for
 * `SOUL.it.md` / `AGENTS.it.md` / `HEARTBEAT.it.md` first and falls back to
 * the English versions if missing. This lets us ship English first and
 * incrementally add Italian translations without code changes.
 *
 * Prompt caching note: the current Pi Agent SDK accepts systemPrompt as a
 * plain string, so Anthropic `cache_control: {type: 'ephemeral'}` blocks
 * cannot be attached here directly. The static portion returned by this
 * module is designed to be cache-friendly (first N thousand tokens, stable
 * per locale), so when we later either (a) upgrade pi-ai to support
 * structured system prompts, or (b) add a direct-Anthropic path for cron
 * ecosystem calls, caching can be layered on without changes to callers.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export type Locale = 'en' | 'it';
export type PromptContext = 'chat' | 'cron' | 'monitor' | 'skill';

const AGENTS_DIR = join(process.cwd(), 'agents');
const SKILLS_DIR = join(process.cwd(), 'launchpad-skills');

// Module-level cache keyed by file path. Invalidated on process restart.
// We don't hot-reload SOUL/AGENTS in dev mode — restart is expected when
// editing personality files.
const fileCache = new Map<string, string>();

function loadMarkdown(dir: string, baseName: string, locale: Locale): string | null {
  const localized = locale === 'it' ? join(dir, `${baseName}.it.md`) : null;
  const fallback = join(dir, `${baseName}.md`);

  for (const path of [localized, fallback].filter((p): p is string => p !== null)) {
    if (fileCache.has(path)) {
      const cached = fileCache.get(path)!;
      if (cached) return cached;
      continue;
    }
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8');
      fileCache.set(path, content);
      return content;
    }
    fileCache.set(path, '');
  }
  return null;
}

function loadSkill(skillId: string, locale: Locale): string | null {
  const skillDir = join(SKILLS_DIR, skillId);
  return loadMarkdown(skillDir, 'SKILL', locale);
}

// =============================================================================
// Public API
// =============================================================================

export interface BuildSystemPromptInput {
  locale?: Locale;
  /** Which call site this system prompt is for — changes what's included. */
  context?: PromptContext;
  /** Active skill id, e.g. 'idea-shaping' — prepends the skill's SKILL.md */
  activeSkillId?: string;
  /** Per-project context string (name, description) */
  projectContext?: string;
  /** ARTIFACT_INSTRUCTIONS or similar — passed in verbatim, appended at the end */
  tail?: string;
}

export interface SystemPromptParts {
  /**
   * The static portion that is identical across calls for a given (locale, context).
   * Designed to be cache-eligible under Anthropic prompt caching (>= 1024 tokens typical).
   */
  staticPrefix: string;
  /** Per-project / per-session tail that varies per call. */
  dynamicTail: string;
  /** Fully composed prompt (staticPrefix + dynamicTail). */
  full: string;
  /** Estimated token count of staticPrefix (approx chars/4) — useful for deciding if caching is worth enabling. */
  staticTokensEstimate: number;
}

/**
 * Compose the system prompt. Returns both the static and dynamic pieces so
 * a future cache-aware caller can attach cache_control to the static half.
 */
export function buildSystemPrompt(input: BuildSystemPromptInput = {}): SystemPromptParts {
  const locale: Locale = input.locale === 'it' ? 'it' : 'en';
  const context: PromptContext = input.context || 'chat';

  const parts: string[] = [];

  const soul = loadMarkdown(AGENTS_DIR, 'SOUL', locale);
  if (soul) parts.push(soul);

  const agents = loadMarkdown(AGENTS_DIR, 'AGENTS', locale);
  if (agents) parts.push(agents);

  // Only include HEARTBEAT for cron/monitor contexts — chat agents don't need
  // the weekly-cycle operational rules in their system prompt.
  if (context === 'cron' || context === 'monitor') {
    const heartbeat = loadMarkdown(AGENTS_DIR, 'HEARTBEAT', locale);
    if (heartbeat) parts.push(heartbeat);
  }

  if (input.activeSkillId) {
    const skill = loadSkill(input.activeSkillId, locale);
    if (skill) parts.push(skill);
  }

  const staticPrefix = parts.join('\n\n---\n\n');

  const tailParts: string[] = [];
  if (input.tail) tailParts.push(input.tail);
  if (input.projectContext) tailParts.push(input.projectContext);
  const dynamicTail = tailParts.join('\n\n');

  return {
    staticPrefix,
    dynamicTail,
    full: dynamicTail ? `${staticPrefix}\n\n---\n\n${dynamicTail}` : staticPrefix,
    staticTokensEstimate: Math.ceil(staticPrefix.length / 4),
  };
}

/**
 * Convenience: returns just the full string for callers that don't care
 * about the static/dynamic split.
 */
export function buildSystemPromptString(input: BuildSystemPromptInput = {}): string {
  return buildSystemPrompt(input).full;
}

/**
 * Resolve a project's locale from the DB. Returns 'en' if the project is
 * not found or has no locale set.
 */
export async function resolveProjectLocale(projectId: string, queryFn: (sql: string, ...params: unknown[]) => Promise<Array<{ locale: string | null }>>): Promise<Locale> {
  const rows = await queryFn('SELECT locale FROM projects WHERE id = ?', projectId);
  return rows[0]?.locale === 'it' ? 'it' : 'en';
}

/**
 * Clear the in-memory cache. Useful in tests or when SOUL/AGENTS files are
 * edited and the process is long-lived.
 */
export function clearPromptCache(): void {
  fileCache.clear();
}

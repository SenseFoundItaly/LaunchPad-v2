/**
 * Assumptions Registry — Franzagos-inspired living premortem layer.
 *
 * An assumption is something the project rests on whether the founder
 * declared it or not. We extract them once per project context (typically at
 * onboarding or after a major canvas update), then *link* them to skill
 * outputs as the founder validates or invalidates each one through actual
 * work. The static registry becomes a living one — the bit Franzagos can't
 * do because it's stateless.
 *
 * Two LLM passes live here:
 *   1. `extractAssumptions` — analytical, balanced tier (Sonnet). Reads
 *      project context, emits a numbered JSON array with category +
 *      criticality. Writes one row per assumption.
 *   2. `linkSkillCompletionToAssumptions` — per-completion classification,
 *      cheap tier (Haiku). For each open assumption, asks "does this skill
 *      output validate/invalidate this assumption?" and records the link.
 *
 * Both are non-fatal at the call site — failures must never block a chat
 * turn or a skill completion write.
 */

import { query, run, get } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { runAgent } from '@/lib/pi-agent';
import { recordAgentUsage } from '@/lib/cost-meter';
import { resolveLocale } from '@/lib/i18n/resolve-locale';

export type AssumptionCategory =
  | 'market'
  | 'user_behavior'
  | 'execution'
  | 'financial'
  | 'competitive'
  | 'org'
  | 'external';

export type AssumptionCriticality = 'high' | 'medium' | 'low';
export type AssumptionStatus = 'open' | 'validated' | 'invalidated' | 'accepted_risk';

export interface AssumptionRow {
  id: string;
  project_id: string;
  number: number;
  category: AssumptionCategory;
  text: string;
  source: string | null;
  explicit: boolean;
  criticality: AssumptionCriticality;
  status: AssumptionStatus;
  validated_by_skill_completion_id: string | null;
  validated_at: string | null;
  invalidated_at: string | null;
  invalidated_reason: string | null;
  validation_evidence: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  'market', 'user_behavior', 'execution', 'financial',
  'competitive', 'org', 'external',
]);
const VALID_CRITICALITIES: ReadonlySet<string> = new Set(['high', 'medium', 'low']);

// ─── Extraction ──────────────────────────────────────────────────────────────

const EXTRACTOR_SYSTEM = `You are an applied epistemologist for early-stage startups.

Your job: read a project context and surface every assumption the project rests on. The most dangerous assumptions are the ones nobody noticed as assumptions — find those.

For each statement, ask "what must be true for this to hold?" — that answer is an assumption.

Categories (use exactly these slugs):
- market — beliefs about market size, demand, willingness to pay, timing
- user_behavior — how the target user thinks, decides, acts
- execution — team's ability to ship in time with available resources
- financial — CAC, LTV, margins, burn assumptions
- competitive — competitor behavior, defensibility, moat
- org — internal alignment, key-person risk, decision velocity
- external — regulation, macro, tech infrastructure

Criticality:
- high — if false, the project collapses
- medium — if false, the project suffers but survives
- low — if false, needs minor adjustment

Return STRICT JSON only — no prose, no markdown fences. Schema:
{
  "assumptions": [
    {
      "text": "string — clear, specific, falsifiable statement",
      "category": "market | user_behavior | execution | financial | competitive | org | external",
      "criticality": "high | medium | low",
      "explicit": false,
      "source": "string — which part of the brief this came from"
    }
  ]
}

Aim for 12-25 assumptions for a typical project. Skip restating the project verbatim — surface the implicit beliefs underneath.`;

export interface ExtractAssumptionsResult {
  inserted: number;
  skipped: number;
  errors: string[];
}

/**
 * Extract assumptions from a free-form project context (idea canvas, chat
 * summary, brief). Idempotent on `(project_id, number)` — re-running
 * appends new numbers continuing from the project's current max.
 */
export async function extractAssumptions(
  projectId: string,
  context: string,
): Promise<ExtractAssumptionsResult> {
  const result: ExtractAssumptionsResult = { inserted: 0, skipped: 0, errors: [] };

  // Founders read these in the Inbox — write the human-readable `text` in the
  // project language. JSON keys and the `category`/`criticality` enums stay
  // English (they're matched against VALID_CATEGORIES/VALID_CRITICALITIES).
  const locale = await resolveLocale('', projectId);
  const langLine = locale === 'it'
    ? '\n\nWrite each assumption\'s "text" value in Italian. Keep the JSON keys and the category/criticality enum values in English.'
    : '';
  const prompt = `Project context:\n\n${context}\n\nExtract assumptions. Return JSON only.${langLine}`;

  const startedAt = Date.now();
  const agentResult = await runAgent(prompt, {
    systemPrompt: EXTRACTOR_SYSTEM,
    task: 'assumption-extract',
    tools: false,
    timeout: 60000,
    maxToolCalls: 0,
  });
  await recordAgentUsage({
    project_id: projectId,
    step: 'assumption-extract',
    task: 'assumption-extract',
    usage: agentResult.usage,
    latency_ms: Date.now() - startedAt,
  });

  const parsed = parseExtractorOutput(agentResult.text);
  if (!parsed) {
    result.errors.push('Extractor returned non-JSON output');
    return result;
  }

  const existingMax = await get<{ max: number | null }>(
    'SELECT MAX(number) AS max FROM assumptions WHERE project_id = ?',
    projectId,
  );
  let nextNumber = (existingMax?.max ?? 0) + 1;

  for (const item of parsed) {
    if (!VALID_CATEGORIES.has(item.category) || !VALID_CRITICALITIES.has(item.criticality)) {
      result.skipped++;
      continue;
    }
    try {
      await run(
        `INSERT INTO assumptions
          (id, project_id, number, category, text, source, explicit, criticality, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
         ON CONFLICT (project_id, number) DO NOTHING`,
        generateId('asm'),
        projectId,
        nextNumber,
        item.category,
        item.text,
        item.source ?? null,
        item.explicit === true,
        item.criticality,
      );
      result.inserted++;
      nextNumber++;
    } catch (err) {
      result.errors.push((err as Error).message);
    }
  }

  return result;
}

/**
 * Fire-and-forget backstop that seeds the premortem assumptions registry the
 * FIRST time a project accumulates real idea context — so the feature no longer
 * depends on the chat agent remembering to call the extract_assumptions tool
 * (which it rarely did, leaving the registry empty in every project).
 *
 * Guarded to run AT MOST ONCE per project: extractAssumptions appends by
 * `number`, so a second run on the same context would duplicate the registry.
 * If any assumption already exists we return immediately. Thin context (<40
 * chars) is skipped. The extraction itself is an LLM call, so it is detached —
 * callers must never await meaningful latency on it.
 */
export async function seedAssumptionsIfEmpty(projectId: string, context: string): Promise<void> {
  try {
    if (context.trim().length < 40) return;
    const existing = await get<{ one: number }>(
      'SELECT 1 AS one FROM assumptions WHERE project_id = ? LIMIT 1',
      projectId,
    );
    if (existing) return; // once-per-project — never duplicate the registry
    void extractAssumptions(projectId, context).catch((err) => {
      console.warn(`[assumptions] background seed failed for ${projectId}:`, (err as Error).message);
    });
  } catch (err) {
    console.warn('[assumptions] seed guard failed (non-fatal):', (err as Error).message);
  }
}

interface ExtractorItem {
  text: string;
  category: string;
  criticality: string;
  explicit?: boolean;
  source?: string | null;
}

function parseExtractorOutput(text: string): ExtractorItem[] | null {
  // Tolerate optional ```json fences and surrounding prose.
  const stripped = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*$/g, '')
    .trim();
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  const slice = stripped.slice(firstBrace, lastBrace + 1);
  try {
    const obj = JSON.parse(slice);
    if (!obj || !Array.isArray(obj.assumptions)) return null;
    return obj.assumptions.filter((a: unknown): a is ExtractorItem =>
      typeof a === 'object' && a !== null &&
      typeof (a as ExtractorItem).text === 'string' &&
      typeof (a as ExtractorItem).category === 'string' &&
      typeof (a as ExtractorItem).criticality === 'string'
    );
  } catch {
    return null;
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export interface ListFilter {
  status?: AssumptionStatus | AssumptionStatus[];
  criticality?: AssumptionCriticality;
  category?: AssumptionCategory;
}

export async function listAssumptions(
  projectId: string,
  filter: ListFilter = {},
): Promise<AssumptionRow[]> {
  const clauses: string[] = ['project_id = ?'];
  const params: unknown[] = [projectId];

  if (filter.status) {
    if (Array.isArray(filter.status)) {
      clauses.push(`status IN (${filter.status.map(() => '?').join(',')})`);
      params.push(...filter.status);
    } else {
      clauses.push('status = ?');
      params.push(filter.status);
    }
  }
  if (filter.criticality) {
    clauses.push('criticality = ?');
    params.push(filter.criticality);
  }
  if (filter.category) {
    clauses.push('category = ?');
    params.push(filter.category);
  }

  return query<AssumptionRow>(
    `SELECT * FROM assumptions WHERE ${clauses.join(' AND ')} ORDER BY number ASC`,
    ...params,
  );
}

export async function getAssumption(id: string): Promise<AssumptionRow | undefined> {
  return get<AssumptionRow>('SELECT * FROM assumptions WHERE id = ?', id);
}

/**
 * Lightweight aggregate counts for stage-readiness signaling. One round-trip,
 * one row. Used by formatReadinessForPrompt to inject a warning line when
 * the founder is moving across stages with unproven high-criticality bets.
 */
export interface AssumptionCounts {
  total: number;
  open_high: number;
  open_total: number;
  validated: number;
  invalidated: number;
}

export async function countAssumptions(projectId: string): Promise<AssumptionCounts> {
  const row = await get<{
    total: string | number;
    open_high: string | number;
    open_total: string | number;
    validated: string | number;
    invalidated: string | number;
  }>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'open' AND criticality = 'high') AS open_high,
       COUNT(*) FILTER (WHERE status = 'open') AS open_total,
       COUNT(*) FILTER (WHERE status = 'validated') AS validated,
       COUNT(*) FILTER (WHERE status = 'invalidated') AS invalidated
     FROM assumptions WHERE project_id = ?`,
    projectId,
  );
  if (!row) {
    return { total: 0, open_high: 0, open_total: 0, validated: 0, invalidated: 0 };
  }
  return {
    total: Number(row.total) || 0,
    open_high: Number(row.open_high) || 0,
    open_total: Number(row.open_total) || 0,
    validated: Number(row.validated) || 0,
    invalidated: Number(row.invalidated) || 0,
  };
}

export async function markValidated(
  id: string,
  skillCompletionId: string | null,
  evidence: string,
): Promise<void> {
  await run(
    `UPDATE assumptions
     SET status = 'validated',
         validated_by_skill_completion_id = ?,
         validated_at = CURRENT_TIMESTAMP,
         validation_evidence = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    skillCompletionId,
    evidence,
    id,
  );
}

export async function markInvalidated(id: string, reason: string): Promise<void> {
  await run(
    `UPDATE assumptions
     SET status = 'invalidated',
         invalidated_at = CURRENT_TIMESTAMP,
         invalidated_reason = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    reason,
    id,
  );
}

// ─── Linker (skill_completions → assumptions) ────────────────────────────────

const LINKER_SYSTEM = `You judge whether a skill output validates, invalidates, or is irrelevant to a specific assumption.

Return STRICT JSON only:
{ "verdict": "validates" | "invalidates" | "irrelevant", "evidence": "string — one sentence quoting or paraphrasing the relevant part of the output. Empty string if irrelevant." }

Rules:
- "validates" only when the output provides concrete evidence the assumption holds. Weak or implicit support is "irrelevant".
- "invalidates" only when the output provides concrete evidence the assumption is false.
- Default to "irrelevant" when in doubt. False positives are worse than false negatives — a wrong validation hides risk.`;

interface LinkerVerdict {
  verdict: 'validates' | 'invalidates' | 'irrelevant';
  evidence: string;
}

function parseLinkerVerdict(text: string): LinkerVerdict | null {
  const stripped = text.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) return null;
  try {
    const obj = JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
    if (!obj || typeof obj.verdict !== 'string') return null;
    if (obj.verdict !== 'validates' && obj.verdict !== 'invalidates' && obj.verdict !== 'irrelevant') return null;
    return { verdict: obj.verdict, evidence: typeof obj.evidence === 'string' ? obj.evidence : '' };
  } catch {
    return null;
  }
}

export interface LinkResult {
  checked: number;
  validated: number;
  invalidated: number;
}

/**
 * After a skill_completions row is written, ask the LLM whether the output
 * validates or invalidates any of the project's open assumptions. Cheap-tier
 * per-assumption classification. Idempotent — already-resolved assumptions
 * are skipped, so re-running on the same skill_completion is a no-op.
 *
 * Caller is responsible for try/catch — this throws on DB failure.
 */
export async function linkSkillCompletionToAssumptions(
  projectId: string,
  skillCompletionId: string,
  skillId: string,
  summary: string,
): Promise<LinkResult> {
  const result: LinkResult = { checked: 0, validated: 0, invalidated: 0 };
  if (!summary || summary.trim().length < 20) return result;

  const open = await listAssumptions(projectId, { status: 'open' });
  if (open.length === 0) return result;

  // Cap fan-out: only the top-N high-criticality opens get LLM judgement on
  // each completion. Prevents runaway cost when a project has 50+ open
  // assumptions and a chatty skill fires every few minutes.
  const ordered = [...open].sort((a, b) => {
    const rank = (c: AssumptionCriticality) => (c === 'high' ? 0 : c === 'medium' ? 1 : 2);
    return rank(a.criticality) - rank(b.criticality);
  });
  const candidates = ordered.slice(0, 8);

  for (const assumption of candidates) {
    const prompt = `Assumption #${assumption.number} [${assumption.category}, ${assumption.criticality}]:
"${assumption.text}"

Skill output (skill_id=${skillId}):
${summary.slice(0, 4000)}

Verdict?`;

    let verdict: LinkerVerdict | null = null;
    try {
      const startedAt = Date.now();
      const agentResult = await runAgent(prompt, {
        systemPrompt: LINKER_SYSTEM,
        task: 'classify',
        tools: false,
        timeout: 30000,
        maxToolCalls: 0,
      });
      await recordAgentUsage({
        project_id: projectId,
        skill_id: skillId,
        step: 'assumption-linker',
        task: 'classify',
        usage: agentResult.usage,
        latency_ms: Date.now() - startedAt,
      });
      verdict = parseLinkerVerdict(agentResult.text);
    } catch (err) {
      console.warn(
        `[assumptions] linker LLM failed for #${assumption.number}:`,
        (err as Error).message,
      );
      continue;
    }

    result.checked++;
    if (!verdict || verdict.verdict === 'irrelevant') continue;

    if (verdict.verdict === 'validates') {
      await markValidated(assumption.id, skillCompletionId, verdict.evidence);
      result.validated++;
    } else {
      await markInvalidated(assumption.id, verdict.evidence);
      result.invalidated++;
    }
  }

  return result;
}

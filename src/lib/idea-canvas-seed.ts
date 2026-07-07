/**
 * Deterministic Idea Canvas seeding from the project description.
 *
 * A brand-new project already carries the founder's own idea in its
 * `description` (typed at creation). The chat agent is SUPPOSED to turn that
 * into canvas fields on turn 1, but first-turn behaviour is unreliable — it
 * often just orients/converses, leaving Stage 0 (Idea Canvas) empty until a
 * later nudge (verified in the Italian founder sim, 2026-06-30: turn 1 only
 * called get_project_summary; the canvas stayed null).
 *
 * This closes that gap INDEPENDENTLY of model steering: at creation we extract
 * the canvas fields from the description with ONE structured LLM pass and route
 * them through the SAME founder-first auto-capture path the chat artifacts use
 * (autoStageValidationFromArtifact), so the founder finds a one-click "approve
 * your canvas" card waiting the moment they open the project.
 *
 * Gate-respecting: it only PROPOSES (pending) — nothing greens without the
 * founder's approval click. Never throws (mirrors ensureStartupRootNode) and is
 * time-bounded, so it can be awaited in the creation route without breaking OR
 * stalling project creation.
 */

import { query } from '@/lib/db';
import { chatJSONByTask } from '@/lib/llm';
import { autoStageValidationFromArtifact } from '@/lib/auto-stage-validation';
import type { IdeaCanvasArtifact, Source } from '@/types/artifacts';

const CANVAS_FIELDS = ['problem', 'solution', 'target_market', 'value_proposition', 'competitive_advantage', 'business_model', 'channels'] as const;
type CanvasField = (typeof CANVAS_FIELDS)[number];

// A description shorter than this is just a name echo / placeholder — not enough
// signal to extract a canvas from. Skip rather than hallucinate one.
const MIN_DESCRIPTION_CHARS = 50;

// Bound the extraction. The seed is AWAITED on the creation response path, and
// the LLM SDKs default to ~10-minute timeouts; without this a slow/hung provider
// would hold project creation open until the serverless wall-clock kills it (and
// the user, seeing a "failed" creation, retries → duplicate projects). Degrade
// to {seeded:false} fast instead — the chat agent's turn-1 steering is the
// backstop when the seed is skipped. Tier stays balanced/Sonnet (router default
// for the unmapped 'idea-canvas-seed' label): a single-shot 7-field JSON extract
// is reliable there; cheap/Haiku is a possible future cost lever, not assumed.
const EXTRACT_TIMEOUT_MS = 8_000;
const TIMEOUT = Symbol('idea-canvas-seed-timeout');

function langName(locale: string): string {
  return locale === 'it' ? 'Italian' : 'English';
}

/** True when the project has no canvas content yet (no row, or all fields blank).
 *  On query error we treat it as empty (logged) — the downstream auto-stage is
 *  itself a no-op if there's nothing to add, and the open-proposal dedup guards
 *  against a stray duplicate card. Exported: the knowledge-upload route uses it
 *  to skip the canvas-draft LLM pass when the founder already has a canvas. */
export async function canvasIsEmpty(projectId: string): Promise<boolean> {
  const rows = await query<Record<string, string | null>>(
    'SELECT problem, solution, target_market, value_proposition, competitive_advantage, business_model, channels FROM idea_canvas WHERE project_id = ?',
    projectId,
  ).catch((e) => {
    console.warn(`[idea-canvas-seed] canvasIsEmpty query failed for ${projectId}:`, (e as Error).message);
    return [] as Record<string, string | null>[];
  });
  if (rows.length === 0) return true;
  return !CANVAS_FIELDS.some((f) => (rows[0][f] ?? '').trim().length > 0);
}

/** Cheap dedup pre-check: is there already an OPEN auto-proposal for this
 *  project? Mirrors the dedup inside autoStageValidationFromArtifact, but runs
 *  BEFORE the paid LLM call so we don't pay for an extraction that would just be
 *  dropped. */
async function hasOpenProposal(projectId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    "SELECT id FROM pending_actions WHERE project_id = ? AND action_type = 'validation_proposal' AND status IN ('pending','edited') LIMIT 1",
    projectId,
  ).catch(() => [] as { id: string }[]);
  return rows.length > 0;
}

/**
 * Seed a PENDING Idea Canvas proposal from the project's name + description.
 * Returns {seeded:false} when skipped (thin description, canvas already has
 * content, an open proposal already exists, the extraction timed out/failed, or
 * it produced no fields). Never throws.
 */
export async function seedIdeaCanvasFromDescription(opts: {
  projectId: string;
  name: string;
  description: string;
  locale: string;
}): Promise<{ seeded: boolean; itemCount?: number }> {
  const { projectId, name, locale } = opts;
  const description = (opts.description ?? '').trim();
  try {
    if (description.length < MIN_DESCRIPTION_CHARS) return { seeded: false };
    if (!(await canvasIsEmpty(projectId))) return { seeded: false };
    if (await hasOpenProposal(projectId)) return { seeded: false };

    const lang = langName(locale);
    const system =
      "You extract Lean/Idea Canvas fields from a founder's startup description. "
      + 'Return STRICT JSON with exactly these keys: problem, solution, target_market, '
      + 'value_proposition, competitive_advantage, business_model, channels. For each key, write a '
      + 'concise (≤300 char) value ONLY if the description gives you confident signal for it; '
      + 'otherwise use an empty string "". Do NOT invent facts the description does not support '
      + `— an empty string is the correct answer when unknown. Write every value in ${lang}. `
      + 'Output ONLY the JSON object, no prose, no markdown fences.';
    const userMsg = `Project name: ${name}\n\nDescription:\n${description}`;

    // Time-bounded extraction. The LLM promise never rejects (its own .catch logs
    // + returns null); a timer resolves to a sentinel so we can tell a timeout
    // apart from a genuine failure for the logs.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const llmP = chatJSONByTask<Partial<Record<CanvasField, string>>>(
      [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
      'idea-canvas-seed',
      { projectId },
    ).catch((e) => {
      console.warn(`[idea-canvas-seed] extraction failed for ${projectId}:`, (e as Error).message);
      return null;
    });
    const timeoutP = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), EXTRACT_TIMEOUT_MS);
    });
    const extracted = await Promise.race([llmP, timeoutP]);
    if (timer) clearTimeout(timer);
    if (extracted === TIMEOUT) {
      console.warn(`[idea-canvas-seed] extraction exceeded ${EXTRACT_TIMEOUT_MS}ms for ${projectId} — skipping seed`);
      return { seeded: false };
    }
    if (!extracted || typeof extracted !== 'object') return { seeded: false };

    // Provenance: honestly mark these as AI-EXTRACTED from the founder's own
    // description (not the founder's verbatim words) — the approval card shows it.
    const source: Source = {
      type: 'inference',
      title: 'AI-extracted from your project description',
      based_on: [{ type: 'user', title: 'Founder — project description', quote: description.slice(0, 800) }],
      reasoning: 'Idea Canvas fields drafted from the description you wrote at project creation — review, refine, and approve.',
    };
    const artifact: IdeaCanvasArtifact = {
      type: 'idea-canvas',
      id: `ic_seed_${projectId}`,
      title: name.slice(0, 200),
      sources: [source],
    };

    let fieldCount = 0;
    for (const f of CANVAS_FIELDS) {
      const raw = extracted[f];
      const v = typeof raw === 'string' ? raw.trim() : '';
      if (v.length > 0) {
        artifact[f] = v.slice(0, 1200); // typed write — `f` is a CanvasField key of IdeaCanvasArtifact
        fieldCount++;
      }
    }
    if (fieldCount === 0) return { seeded: false };

    const res = await autoStageValidationFromArtifact(projectId, artifact);
    return { seeded: res.staged, itemCount: res.itemCount };
  } catch (e) {
    console.warn(`[idea-canvas-seed] unexpected failure for ${projectId}:`, (e as Error).message);
    return { seeded: false };
  }
}

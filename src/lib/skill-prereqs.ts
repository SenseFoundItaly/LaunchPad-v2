import { get, query } from '@/lib/db';
import { buildProjectSnapshot } from '@/lib/journey';
import { validationTracksABMissing } from '@/lib/journey/stage-2-market-validation';

/**
 * Idea-canvas prerequisites for skills — the single source of truth shared by
 * BOTH gates that keep a scoring/modeling/build skill from firing on an empty
 * idea:
 *   - proposal-time (chat route): canvas-dependent skill TOOLS are removed from
 *     the agent's tool list, so it can't even offer them;
 *   - run-time (skills route): a clean 422 if one is invoked anyway.
 *
 * Keeping the list in one place means the two gates can never disagree.
 *
 * PENDING-AWARENESS (17/06 — item 1.5): a canvas field the founder has defined
 * but not yet APPROVED lives in a `validation_proposal` pending_action, not in
 * the `idea_canvas` table (update_idea_canvas only stages; applyValidationProposal
 * writes on approval). The old gate read only the applied table, so it told a
 * founder who had just defined their value proposition that it was "missing" and
 * hid scoring. Now a STAGED field counts as "pending": it no longer hides the
 * skill (proposal-time), and the run-time gate returns an actionable "approve
 * your pending X" message instead of "missing" — while still requiring the
 * APPLIED value before the skill actually runs (skills read the applied table,
 * so running on a merely-pending field would score an empty canvas).
 */

/**
 * Skills that CANNOT produce a usable result on a bare idea — they score,
 * model, or build off a solution + value proposition that must already exist.
 * Firing one on an empty canvas burns credits on a clarification-only output.
 *
 * NOT listed (these HELP fill the canvas, so they must stay available early):
 * idea-shaping, market-research, startup-advisor.
 */
export const CANVAS_DEPENDENT_SKILLS = new Set<string>([
  'startup-scoring',
  'risk-scoring',
  'business-model',
  'financial-model',
  'simulation',
  'investment-readiness',
  'investor-relations',
  'gtm-strategy',
  'growth-optimization',
  'build-pitch-deck',
  'pitch-coaching',
  'build-landing-page',
  'build-one-pager',
  'prototype-spec',
  'scientific-validation',
  'weekly-metrics',
]);

export function isCanvasDependentSkill(skillId: string): boolean {
  return CANVAS_DEPENDENT_SKILLS.has(skillId);
}

/** Per-field readiness: in the applied canvas, staged-but-unapproved, or absent. */
export type CanvasFieldState = 'applied' | 'pending' | 'missing';

/** The idea-canvas fields a canvas-dependent skill needs before it can run. */
const CORE_CANVAS_FIELDS = ['solution', 'value_proposition'] as const;
type CoreCanvasField = (typeof CORE_CANVAS_FIELDS)[number];

/** Founder-facing label for a canvas field. */
function fieldLabel(field: string): string {
  return field === 'value_proposition' ? 'value proposition' : field;
}

/** The two idea-canvas fields a canvas-dependent skill needs, as APPLIED. */
async function readAppliedCanvasCore(
  projectId: string,
): Promise<{ solution: string | null; value_proposition: string | null } | undefined> {
  return get<{ solution: string | null; value_proposition: string | null }>(
    'SELECT solution, value_proposition FROM idea_canvas WHERE project_id = ?',
    projectId,
  );
}

function parseJsonb(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value !== 'string') return value; // postgres.js returns JSONB as objects
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Canvas field VALUES the founder has STAGED via an open `validation_proposal`
 * (defined but not yet approved). Open = status IN ('pending','edited') — once
 * applied the value lands in idea_canvas and is read as applied instead. Newest
 * proposal wins per field (ORDER BY created_at DESC + first-write). Exported so
 * the Canvas can paint pending fields "man mano" (item 9) — distinct from applied.
 */
export async function readStagedCanvasFieldValues(projectId: string): Promise<Record<string, string>> {
  const rows = await query<{ payload: unknown; edited_payload: unknown }>(
    `SELECT payload, edited_payload FROM pending_actions
       WHERE project_id = ? AND action_type = 'validation_proposal'
         AND status IN ('pending', 'edited')
       ORDER BY created_at DESC`,
    projectId,
  );
  const staged: Record<string, string> = {};
  for (const row of rows) {
    const payload = parseJsonb(row.edited_payload) ?? parseJsonb(row.payload);
    const items = Array.isArray((payload as { items?: unknown[] })?.items)
      ? (payload as { items: unknown[] }).items
      : [];
    for (const raw of items) {
      const it = raw as { kind?: string; field?: string; value?: string };
      const value = (it?.value ?? '').trim();
      if (it?.kind === 'canvas_field' && typeof it.field === 'string' && value && !staged[it.field]) {
        staged[it.field] = value; // newest (DESC) wins
      }
    }
  }
  return staged;
}

/** Just the names of staged canvas fields (for the prereq gate). */
async function readStagedCanvasFields(projectId: string): Promise<Set<string>> {
  return new Set(Object.keys(await readStagedCanvasFieldValues(projectId)));
}

/** Resolve the state of each core canvas field (applied / pending / missing). */
async function coreCanvasStates(projectId: string): Promise<Record<CoreCanvasField, CanvasFieldState>> {
  const [canvas, staged] = await Promise.all([
    readAppliedCanvasCore(projectId),
    readStagedCanvasFields(projectId),
  ]);
  const stateFor = (applied: string | null | undefined, field: string): CanvasFieldState =>
    applied?.trim() ? 'applied' : staged.has(field) ? 'pending' : 'missing';
  return {
    solution: stateFor(canvas?.solution, 'solution'),
    value_proposition: stateFor(canvas?.value_proposition, 'value_proposition'),
  };
}

/** What a run-time gate needs to decide whether to block and how to phrase it. */
export interface CanvasRunPrereqs {
  /** Fields that block the run (truly missing OR staged-but-unapproved). Empty ⇒ runnable. */
  blocking: string[];
  /** Of the blocking fields, those staged in an open proposal (need the founder to approve). */
  pending: string[];
  /** Of the blocking fields, those not defined at all. */
  missing: string[];
}

/**
 * Run-time gate input for a specific skill. A skill reads the APPLIED canvas, so
 * BOTH missing and pending fields block the run — but they get different,
 * actionable messages (approve vs. define).
 */
export async function canvasRunPrereqs(projectId: string, skillId: string): Promise<CanvasRunPrereqs> {
  if (!CANVAS_DEPENDENT_SKILLS.has(skillId)) return { blocking: [], pending: [], missing: [] };
  const states = await coreCanvasStates(projectId);
  const pending: string[] = [];
  const missing: string[] = [];
  for (const field of CORE_CANVAS_FIELDS) {
    if (states[field] === 'pending') pending.push(fieldLabel(field));
    else if (states[field] === 'missing') missing.push(fieldLabel(field));
  }
  // Missing first so the message leads with "define" over "approve" when both apply.
  return { blocking: [...missing, ...pending], pending, missing };
}

/**
 * True when the idea canvas is too empty to even OFFER a canvas-dependent skill —
 * i.e. a core field is genuinely MISSING (not defined and not staged). A staged
 * (pending-approval) field does NOT hide the skill: the founder has defined it,
 * so we let the agent offer it and let the run-time gate ask for approval.
 */
export async function canvasLacksCorePrereqs(projectId: string): Promise<boolean> {
  const states = await coreCanvasStates(projectId);
  return CORE_CANVAS_FIELDS.some((field) => states[field] === 'missing');
}

/**
 * Skills that belong to Validation-Gate track 1C (Problem-Solution Fit) —
 * locked until every 1A (Market) + 1B (Technical) check passes. Mirrors the
 * canvas gate's 3-layer structure: proposal-time tool strip (chat route),
 * availability list (GET /skills?availability=1), and run-time 422 (POST /skills).
 */
export const GATE_1C_DEPENDENT_SKILLS = new Set<string>(['customer-interviews']);

export function isGate1CDependentSkill(skillId: string): boolean {
  return GATE_1C_DEPENDENT_SKILLS.has(skillId);
}

/** What the 1C run-time gate needs: blocked + the unmet 1A/1B check labels. */
export interface ValidationGatePrereqs {
  blocked: boolean;
  /** Labels of the 1A/1B checks still open (empty ⇒ 1C unlocked). */
  missing: string[];
}

/** Project-level 1C lock state, independent of any specific skill. */
export async function validationGatePrereqs(projectId: string): Promise<ValidationGatePrereqs> {
  try {
    const snapshot = await buildProjectSnapshot(projectId);
    const missing = validationTracksABMissing(snapshot);
    return { blocked: missing.length > 0, missing };
  } catch {
    // Snapshot failure (fresh project, schema drift) must never hard-block a
    // founder-initiated run — fail open, matching the chat route's tolerance.
    return { blocked: false, missing: [] };
  }
}

/**
 * Run-time 1C gate for a specific skill: non-1C skills are always runnable;
 * a 1C skill is blocked while tracks 1A+1B have open checks.
 */
export async function validationGateRunPrereqs(projectId: string, skillId: string): Promise<ValidationGatePrereqs> {
  if (!GATE_1C_DEPENDENT_SKILLS.has(skillId)) return { blocked: false, missing: [] };
  return validationGatePrereqs(projectId);
}

import { NextRequest } from 'next/server';
import { get, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { readStagedCanvasFieldValues } from '@/lib/skill-prereqs';
import { seedAssumptionsIfEmpty } from '@/lib/assumptions';
import { persistCanvasDetails } from '@/lib/canvas-details';

const CANVAS_FIELDS = [
  'problem', 'solution', 'target_market', 'value_proposition', 'business_model', 'competitive_advantage',
] as const;

/**
 * GET /api/projects/{projectId}/idea-canvas
 *
 * Returns the 5 idea_canvas fields surfaced in the Canvas header
 * (problem / solution / target_market / value_proposition / business_model).
 * Returns null fields when no row exists yet.
 */

interface IdeaCanvasRow {
  problem: string | null;
  solution: string | null;
  target_market: string | null;
  value_proposition: string | null;
  business_model: string | null;
  competitive_advantage: string | null;
  unfair_advantage: string | null;
  key_metrics: string[] | null;
  revenue_streams: string[] | null;
  cost_structure: string[] | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const row = await get<IdeaCanvasRow>(
    `SELECT problem, solution, target_market, value_proposition, business_model,
            competitive_advantage, unfair_advantage, key_metrics, revenue_streams, cost_structure
     FROM idea_canvas
     WHERE project_id = ?`,
    projectId,
  );

  // Staged-but-unapproved fields (open validation_proposals). Surfaced as
  // `pending` so the Canvas can paint them progressively while the founder is
  // still reviewing (item 9) — distinct from applied, and only for fields the
  // applied canvas doesn't already have.
  const staged = await readStagedCanvasFieldValues(projectId);
  const pending: Record<string, string> = {};
  for (const [field, value] of Object.entries(staged)) {
    const appliedVal = (row as Record<string, string | null> | undefined)?.[field];
    if (!appliedVal || !appliedVal.trim()) pending[field] = value;
  }

  return json({
    ...(row ?? {
      problem: null,
      solution: null,
      target_market: null,
      value_proposition: null,
      business_model: null,
      competitive_advantage: null,
      unfair_advantage: null,
      key_metrics: null,
      revenue_streams: null,
      cost_structure: null,
    }),
    pending,
  });
}

/**
 * POST /api/projects/{projectId}/idea-canvas
 *
 * Applies a set of canvas fields — used by the create-from-documents flow to
 * commit the canvas DRAFTED from uploaded docs once the founder confirms it on
 * the populating screen. Same COALESCE-non-empty upsert as the agent's
 * update_idea_canvas tool (project-tools.ts), so a partial fill never wipes
 * fields the founder already has.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error('Body must be JSON', 400);
  }

  const clean = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, 1200) : '');
  const fields = Object.fromEntries(CANVAS_FIELDS.map((k) => [k, clean(body[k])])) as Record<
    (typeof CANVAS_FIELDS)[number], string
  >;
  if (CANVAS_FIELDS.every((k) => fields[k].length === 0)) {
    return error('At least one non-empty canvas field is required', 400);
  }

  await run(
    `INSERT INTO idea_canvas (project_id, problem, solution, target_market, value_proposition, business_model, competitive_advantage)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET
       problem               = COALESCE(NULLIF(EXCLUDED.problem, ''),               idea_canvas.problem),
       solution              = COALESCE(NULLIF(EXCLUDED.solution, ''),              idea_canvas.solution),
       target_market         = COALESCE(NULLIF(EXCLUDED.target_market, ''),         idea_canvas.target_market),
       value_proposition     = COALESCE(NULLIF(EXCLUDED.value_proposition, ''),     idea_canvas.value_proposition),
       business_model        = COALESCE(NULLIF(EXCLUDED.business_model, ''),        idea_canvas.business_model),
       competitive_advantage = COALESCE(NULLIF(EXCLUDED.competitive_advantage, ''), idea_canvas.competitive_advantage)`,
    projectId,
    fields.problem, fields.solution, fields.target_market,
    fields.value_proposition, fields.business_model, fields.competitive_advantage,
  );

  // Seed the assumptions/premortem registry off the freshly-committed canvas —
  // mirrors applyValidationProposal so a deterministic commit (commit option or
  // create-from-documents) gets the SAME seeding as the card-approval path.
  // Best-effort + no-op once assumptions exist; never blocks the write.
  const seedContext = CANVAS_FIELDS
    .filter((k) => fields[k].length > 0)
    .map((k) => `${k}: ${fields[k]}`)
    .join('\n\n');
  if (seedContext) void seedAssumptionsIfEmpty(projectId, seedContext);

  // Soft Lean Canvas fields (unfair_advantage + the array fields) persist directly
  // (ungated) — they carry no stage gate, unlike the 6 core fields above.
  const extras = await persistCanvasDetails(projectId, body).catch(() => [] as string[]);

  return json({ applied: [...CANVAS_FIELDS.filter((k) => fields[k].length > 0), ...extras] }, 201);
}

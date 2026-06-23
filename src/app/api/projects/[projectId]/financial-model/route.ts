import { NextRequest } from 'next/server';
import { get, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { computeFinancialModel } from '@/lib/financial-projection';

/**
 * GET /api/projects/{projectId}/financial-model
 *
 * The detailed financial projections (changelog 17/06 item 13: financial
 * projections should be downloadable + editable). Returns the JSON the
 * financial-model skill stored on the workflow row; the client offers a CSV
 * download (editable in Excel/Sheets) via buildFinancialExport.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const row = await get<{ financial_model: unknown }>(
    'SELECT financial_model FROM workflow WHERE project_id = ?',
    projectId,
  );
  let model = row?.financial_model ?? null;
  if (typeof model === 'string') {
    try { model = JSON.parse(model); } catch { /* leave as-is */ }
  }
  return json({ financial_model: model });
}

/**
 * POST /api/projects/{projectId}/financial-model
 *
 * Edit-and-persist (changelog 17/06 item 13). Two modes:
 *   { assumptions } → recompute the full 36-month × 3-scenario model
 *                     deterministically (no LLM) from the edited assumptions.
 *   { financial_model } → persist a model object as-is (e.g. direct cell edits).
 *
 * Persists to workflow.financial_model as a RAW object (postgres.js single-encodes
 * it — never JSON.stringify into a JSONB bind; see src/lib/jsonb.ts).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  let body: { assumptions?: Record<string, unknown>; financial_model?: unknown };
  try { body = await request.json(); } catch { return error('invalid JSON body'); }

  let model: unknown;
  if (body?.assumptions && typeof body.assumptions === 'object') {
    model = computeFinancialModel(body.assumptions);
  } else if (body?.financial_model && typeof body.financial_model === 'object') {
    model = body.financial_model;
  } else {
    return error('provide `assumptions` (to recompute) or `financial_model` (to persist)');
  }

  const now = new Date().toISOString();
  await run(
    `INSERT INTO workflow (project_id, financial_model, generated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (project_id) DO UPDATE SET financial_model = ?, generated_at = ?`,
    projectId, model, now, model, now, // model bound RAW (object) — JSONB single-encode
  );

  return json({ financial_model: model });
}

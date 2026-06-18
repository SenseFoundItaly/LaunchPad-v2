import { NextRequest } from 'next/server';
import { get } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

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

import { NextRequest } from 'next/server';
import { get } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

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
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const row = await get<IdeaCanvasRow>(
    `SELECT problem, solution, target_market, value_proposition, business_model
     FROM idea_canvas
     WHERE project_id = ?`,
    projectId,
  );

  return json({
    success: true,
    data: row ?? {
      problem: null,
      solution: null,
      target_market: null,
      value_proposition: null,
      business_model: null,
    },
  });
}

import { NextRequest } from 'next/server';
import { get } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

/**
 * GET /api/projects/{projectId}/score
 *
 * The latest PROJECT SCORE (0–100 idea-potential, from the startup-scoring skill)
 * for the Home dashboard (changelog 17/06: score lives on Home, runnable anytime).
 * This is distinct from IRL (Investment Readiness Level = venture-building stage
 * progress), which Home derives from /stages — the two answer different questions:
 * project score = "how good is the idea, given what the founder has done"; IRL =
 * "how far through the journey toward investor-readiness".
 */

interface ScoreRow {
  overall_score: number | null;
  dimensions: unknown;
  benchmark: string | null;
  recommendation: string | null;
  scored_at: string | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const row = await get<ScoreRow>(
    `SELECT overall_score, dimensions, benchmark, recommendation, scored_at
     FROM scores WHERE project_id = ?`,
    projectId,
  );

  return json(
    row ?? {
      overall_score: null,
      dimensions: null,
      benchmark: null,
      recommendation: null,
      scored_at: null,
    },
  );
}

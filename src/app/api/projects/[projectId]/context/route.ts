import { NextRequest } from 'next/server';
import { run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

/**
 * POST /api/projects/{projectId}/context
 *
 * Cold-start writer for the Today page's "tell me about you" card. Upserts:
 *   - idea_canvas.{problem, solution}    (the founder's stated moat)
 *   - research.competitors               (JSON array of {name})
 *
 * Both tables use project_id as PK, so a single ON CONFLICT clause is enough.
 * Keywords are intentionally NOT writable here — they come from the graph
 * (graph_nodes of type market_segment/technology/trend), populated by other
 * surfaces. The card asks for the two things a fresh project genuinely lacks.
 *
 * Idempotent. Empty strings are treated as "no change for this field".
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return error('Request body required');

  const problem = typeof body.problem === 'string' ? body.problem.trim().slice(0, 600) : '';
  const solution = typeof body.solution === 'string' ? body.solution.trim().slice(0, 600) : '';
  const competitors: string[] = Array.isArray(body.competitors)
    ? (body.competitors as unknown[])
        .filter((c): c is string => typeof c === 'string')
        .map((c) => c.trim())
        .filter((c) => c.length > 0 && c.length <= 80)
        .slice(0, 10)
    : [];

  if (!problem && !solution && competitors.length === 0) {
    return error('At least one field must be provided');
  }

  // idea_canvas upsert — COALESCE preserves any field the founder leaves blank.
  if (problem || solution) {
    await run(
      `INSERT INTO idea_canvas (project_id, problem, solution)
       VALUES (?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET
         problem  = COALESCE(NULLIF(EXCLUDED.problem, ''),  idea_canvas.problem),
         solution = COALESCE(NULLIF(EXCLUDED.solution, ''), idea_canvas.solution)`,
      projectId, problem || '', solution || '',
    );
  }

  // research.competitors upsert — overwrites with the new list when given.
  // Each entry stored as {name} so it matches the existing shape consumed by
  // loadMonitorContext (which reads `parsed.map(c => c.name)`).
  if (competitors.length > 0) {
    const payload = JSON.stringify(competitors.map((name) => ({ name })));
    await run(
      `INSERT INTO research (project_id, competitors)
       VALUES (?, ?::jsonb)
       ON CONFLICT (project_id) DO UPDATE SET
         competitors = EXCLUDED.competitors`,
      projectId, payload,
    );
  }

  return json({
    saved: {
      problem: !!problem,
      solution: !!solution,
      competitors: competitors.length,
    },
  });
}

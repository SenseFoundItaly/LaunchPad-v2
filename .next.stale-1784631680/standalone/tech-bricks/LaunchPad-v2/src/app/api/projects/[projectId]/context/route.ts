import { NextRequest } from 'next/server';
import { run, get } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { extractAssumptions } from '@/lib/assumptions';
import { syncBusinessEssentialNodes } from '@/lib/business-essentials-sync';
import { cleanEntityName } from '@/lib/ecosystem-alert-parser';

/**
 * POST /api/projects/{projectId}/context
 *
 * Cold-start writer for the Today page's "tell me about you" card. Upserts:
 *   - idea_canvas.{problem, solution}    (the founder's stated moat)
 *   - research.competitors               (JSON array of {name})
 *   - graph_nodes                        (one APPLIED competitor node per name)
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
    // Mirror the business fields into the graph's BUSINESS ESSENTIALS satellite.
    // Awaited: post-response async work is frozen on serverless (PR #182 class).
    await syncBusinessEssentialNodes(projectId);
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
    // Also land each name as an APPLIED competitor graph_node — the founder
    // TYPED these (an explicit yes), and the Stage-2 competitors_mapped gate
    // reads applied competitor graph_nodes, never research.competitors.
    // Mirrors applyValidationProposal's competitor upsert (atomic on
    // (project_id, LOWER(name)) per migration 018).
    for (const raw of competitors) {
      const name = cleanEntityName(raw) || raw;
      await run(
        `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, reviewed_state)
         VALUES (?, ?, ?, 'competitor', '', 'applied')
         ON CONFLICT (project_id, LOWER(name)) DO UPDATE SET
           reviewed_state = 'applied'`,
        generateId('gnode'), projectId, name,
      );
    }
  }

  // Cold-start premortem trigger. When a project saves context and has zero
  // assumptions, fire the extractor in the background. Idempotent: the LIMIT 1
  // check stops re-runs on subsequent saves, so editing the canvas twice in
  // five minutes doesn't burn tokens twice. Fire-and-forget — the founder
  // shouldn't wait 20s for an LLM call to ack their save.
  try {
    const existing = await get<{ exists: number }>(
      'SELECT 1 AS exists FROM assumptions WHERE project_id = ? LIMIT 1',
      projectId,
    );
    const hasContext = !!(problem || solution || competitors.length > 0);
    if (!existing && hasContext) {
      const context = [
        problem ? `Problem: ${problem}` : null,
        solution ? `Solution: ${solution}` : null,
        competitors.length > 0 ? `Competitors: ${competitors.join(', ')}` : null,
      ].filter(Boolean).join('\n\n');

      if (context.length >= 40) {
        // Detach from the request lifecycle. A failed background extract
        // must not surface as a 500 — the save itself succeeded.
        void extractAssumptions(projectId, context).catch((err) => {
          console.warn(
            `[context] background extractAssumptions failed for ${projectId}:`,
            (err as Error).message,
          );
        });
      }
    }
  } catch (err) {
    console.warn('[context] assumption trigger check failed:', (err as Error).message);
  }

  return json({
    saved: {
      problem: !!problem,
      solution: !!solution,
      competitors: competitors.length,
    },
  });
}

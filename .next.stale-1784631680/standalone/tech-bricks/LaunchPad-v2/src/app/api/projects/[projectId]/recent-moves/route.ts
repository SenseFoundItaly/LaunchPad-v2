import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { AuthError } from '@/lib/auth/require-user';
import { requireProjectAccess } from '@/lib/auth/require-project-access';

export interface RecentMove {
  node_id: string;
  node_name: string;
  node_type: string;
  headline: string;
  date: string | null;
  source_url: string | null;
  relevance: number | null;
  alert_id: string | null;
}

/**
 * GET /api/projects/{projectId}/recent-moves
 *
 * The "Recent moves" awareness feed: a reverse-chronological, cross-node view of
 * every dated entry in each APPLIED entity node's attributes.timeline. This is
 * the read surface that keeps the founder aware of what the watchers surfaced —
 * the good half of the old inbox (situational awareness) WITHOUT the per-item
 * approval gate. Read-only; reuses the timeline data the nodes already hold, so
 * there is no new store.
 *
 * The CASE guard on jsonb_typeof survives legacy double-encoded attributes (a
 * jsonb string scalar) — those simply contribute no rows instead of erroring.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  try {
    await requireProjectAccess(projectId);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const moves = await query<RecentMove>(
    `SELECT n.id AS node_id,
            n.name AS node_name,
            n.node_type,
            elem ->> 'headline'   AS headline,
            elem ->> 'date'       AS date,
            elem ->> 'source_url' AS source_url,
            (elem ->> 'relevance')::float AS relevance,
            elem ->> 'alert_id'   AS alert_id
       FROM graph_nodes n
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(n.attributes -> 'timeline') = 'array'
              THEN n.attributes -> 'timeline' ELSE '[]'::jsonb END
       ) AS elem
      WHERE n.project_id = ?
        AND n.reviewed_state = 'applied'
        AND elem ->> 'headline' IS NOT NULL
      ORDER BY elem ->> 'date' DESC NULLS LAST
      LIMIT 60`,
    projectId,
  );

  return json({ moves });
}

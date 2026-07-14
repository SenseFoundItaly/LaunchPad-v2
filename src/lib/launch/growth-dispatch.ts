/**
 * Growth-loop dispatch (launch pipeline W4) — closes the iterate → act gap.
 * A growth iteration's proposed_changes[] (ITERATE_PROMPT, prompts.ts) is
 * already channel-action-shaped; this maps each change's `area` onto a
 * founder-approvable pending_action. PROPOSALS ONLY — every dispatched action
 * runs its own executor on Inbox Apply, so the loop can never act alone.
 *
 *   copy | design | funnel | feature → republish the landing page with the
 *     change note (publish_landing_page) when one is published; else skip.
 *   distribution | targeting → a click-to-send draft seeded with the change.
 *   pricing | other → a founder task.
 */

import { get } from '@/lib/db';
import { createPendingAction } from '@/lib/pending-actions';

interface ProposedChange {
  area?: string;
  description?: string;
  rationale?: string;
}

export async function dispatchIterationChanges(
  projectId: string,
  iterationId: string,
  changes: ProposedChange[],
): Promise<{ proposed: number }> {
  let proposed = 0;
  if (!Array.isArray(changes) || changes.length === 0) return { proposed };

  const publishedPage = await get<{ source_artifact_id: string | null }>(
    `SELECT source_artifact_id FROM published_assets
      WHERE project_id = ? AND asset_type = 'landing_page' AND is_active = true
      ORDER BY published_at DESC LIMIT 1`,
    projectId,
  ).catch(() => null);

  for (const change of changes.slice(0, 5)) {
    const area = String(change.area || 'other');
    const description = String(change.description || '').slice(0, 600);
    if (!description) continue;
    try {
      if (['copy', 'design', 'funnel', 'feature'].includes(area)) {
        if (!publishedPage?.source_artifact_id) continue; // nothing live to iterate on
        await createPendingAction({
          project_id: projectId,
          action_type: 'publish_landing_page',
          title: `Growth loop: republish page with ${area} change`.slice(0, 200),
          rationale: `${description}${change.rationale ? ` — ${change.rationale}` : ''} (apply the edit to the landing artifact first, then Apply to republish; same URL).`.slice(0, 400),
          payload: {
            source_artifact_id: publishedPage.source_artifact_id,
            growth_iteration_id: iterationId,
            iteration_note: description,
          },
          estimated_impact: 'medium',
        });
      } else if (['distribution', 'targeting'].includes(area)) {
        await createPendingAction({
          project_id: projectId,
          action_type: 'draft_linkedin_post',
          title: 'Growth loop: distribution experiment'.slice(0, 200),
          rationale: `${description}${change.rationale ? ` — ${change.rationale}` : ''}`.slice(0, 400),
          payload: { draft_seed: description, growth_iteration_id: iterationId },
          estimated_impact: 'medium',
        });
      } else {
        await createPendingAction({
          project_id: projectId,
          action_type: 'task',
          title: `Growth loop: ${area} change`.slice(0, 200),
          rationale: description.slice(0, 400),
          payload: { description, growth_iteration_id: iterationId },
          estimated_impact: 'low',
        });
      }
      proposed++;
    } catch (err) {
      console.warn('[launch:growth-dispatch] propose failed (non-fatal):', (err as Error).message);
    }
  }
  return { proposed };
}

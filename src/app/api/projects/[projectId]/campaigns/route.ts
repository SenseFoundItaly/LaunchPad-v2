import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { listCampaigns } from '@/lib/launch/campaigns';

/**
 * GET /api/projects/{projectId}/campaigns — campaigns with message/sent counts
 * (LaunchPanel + Data Room surfaces). Campaign CREATION happens at artifact
 * persistence (capture-at-persist in artifact-persistence.ts) — there is no
 * create endpoint: a campaign always originates from a founder-visible
 * deliverable, never from a bare API call.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  try {
    return json(await listCampaigns(projectId));
  } catch (e) {
    return error((e as Error).message, 500);
  }
}

import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { listPublishedAssets } from '@/lib/launch/publish';

/**
 * GET /api/projects/{projectId}/launch/assets
 * Published assets (real URLs) for the launch surfaces: the HtmlPreviewCard
 * "published" pill, the Data Room publish state, the future LaunchPanel.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  return json(await listPublishedAssets(projectId));
}

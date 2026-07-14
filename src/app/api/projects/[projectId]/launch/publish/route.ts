import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { publishLandingPage } from '@/lib/launch/publish';

/**
 * POST /api/projects/{projectId}/launch/publish  { artifact_id, slug? }
 * Founder-initiated publish of a generated html-preview artifact to a real
 * URL via the active publisher driver (LAUNCH_PUBLISHER; stub without keys).
 * This click IS the founder gate — same posture as the Build Hub's Generate.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { artifact_id?: string; slug?: string };
  if (!body.artifact_id) return error('artifact_id is required', 400);

  try {
    const result = await publishLandingPage({
      projectId,
      sourceArtifactId: body.artifact_id,
      slug: body.slug,
    });
    return json(result);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith('LAUNCH_DISABLED:')) return error(msg.slice('LAUNCH_DISABLED:'.length).trim(), 503);
    if (msg.startsWith('LAUNCH_CAPPED:')) return error(msg.slice('LAUNCH_CAPPED:'.length).trim(), 402);
    if (msg.startsWith('LAUNCH_NOT_FOUND:')) return error(msg.slice('LAUNCH_NOT_FOUND:'.length).trim(), 404);
    if (msg.startsWith('LAUNCH_UNSUPPORTED:')) return error(msg.slice('LAUNCH_UNSUPPORTED:'.length).trim(), 400);
    if (msg.startsWith('LAUNCH_FAILED:')) return error(msg.slice('LAUNCH_FAILED:'.length).trim(), 502);
    throw e;
  }
}

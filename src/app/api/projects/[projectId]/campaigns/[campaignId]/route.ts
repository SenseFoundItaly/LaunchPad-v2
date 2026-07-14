import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { getCampaignWithMessages, activateCampaign, pauseCampaign } from '@/lib/launch/campaigns';

/**
 * GET  /campaigns/{campaignId}           — campaign + ordered messages
 * PATCH /campaigns/{campaignId}
 *   { action: 'activate', config: { recipients?: string[] } } — founder
 *     activation: stores the founder-provided recipients and stamps
 *     scheduled_at per message. Scheduling makes messages eligible for CRON
 *     PROPOSAL only — every send still needs an Inbox Apply.
 *   { action: 'pause' } — freezes proposal of the remaining messages.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; campaignId: string }> },
) {
  const { projectId, campaignId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const data = await getCampaignWithMessages(projectId, campaignId);
  if (!data) return error('campaign not found', 404);
  return json(data);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; campaignId: string }> },
) {
  const { projectId, campaignId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { action?: string; config?: Record<string, unknown> };

  try {
    if (body.action === 'activate') {
      const result = await activateCampaign(projectId, campaignId, body.config ?? {});
      return json(result);
    }
    if (body.action === 'pause') {
      await pauseCampaign(projectId, campaignId);
      return json({ paused: true });
    }
    return error(`Unknown action: ${String(body.action)}. Must be 'activate' or 'pause'.`, 400);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith('LAUNCH_NOT_FOUND:')) return error(msg.slice('LAUNCH_NOT_FOUND:'.length).trim(), 404);
    if (msg.startsWith('LAUNCH_UNSUPPORTED:')) return error(msg.slice('LAUNCH_UNSUPPORTED:'.length).trim(), 400);
    throw e;
  }
}

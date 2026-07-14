/**
 * Send proposer (launch pipeline) — the cron side of the campaign lifecycle.
 * Turns DUE campaign messages into founder-approvable Inbox proposals.
 * PROPOSES ONLY: the only code path that ever sends is the
 * send_campaign_message / draft executors, which run on founder Apply.
 *
 * Email messages → send_campaign_message pending_action (editable
 * subject/body in the Inbox; edited_payload wins via effectivePayload).
 * Social messages → the EXISTING click-to-send draft types
 * (draft_linkedin_post / draft_email) carrying campaign_message_id, unless
 * the Ayrshare driver is configured — then they ride send_campaign_message
 * too and the executor routes by channel.
 *
 * Dedup: a message flips to status='proposed' the moment its action is
 * created, so a second cron tick can never double-propose it (same posture
 * as maybeProposeMvpIteration's open-action guard, belt-and-braces both).
 */

import { query, run } from '@/lib/db';
import { createPendingAction } from '@/lib/pending-actions';
import { getActiveSocial } from './social';

interface DueMessage {
  id: string;
  campaign_id: string;
  project_id: string;
  channel: string;
  position: number;
  subject: string | null;
  body: string;
  campaign_title: string;
  campaign_kind: string;
  recipients: unknown;
  total: number;
}

async function dueMessages(limit: number): Promise<DueMessage[]> {
  return query<DueMessage>(
    `SELECT m.id, m.campaign_id, m.project_id, m.channel, m.position, m.subject, m.body,
            c.title AS campaign_title, c.kind AS campaign_kind, c.config->'recipients' AS recipients,
            (SELECT count(*)::int FROM campaign_messages x WHERE x.campaign_id = c.id) AS total
       FROM campaign_messages m
       JOIN campaigns c ON c.id = m.campaign_id
      WHERE m.status = 'draft'
        AND m.scheduled_at IS NOT NULL AND m.scheduled_at <= CURRENT_TIMESTAMP
        AND c.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM pending_actions pa
           WHERE pa.project_id = m.project_id
             AND pa.status IN ('pending','edited')
             AND pa.payload->>'campaign_message_id' = m.id
        )
      ORDER BY m.scheduled_at ASC
      LIMIT ?`,
    limit,
  );
}

export async function proposeDueCampaignSends(limit = 20): Promise<number> {
  let proposed = 0;
  const due = await dueMessages(limit).catch((err) => {
    console.warn('[launch:send-proposer] due query failed:', (err as Error).message);
    return [] as DueMessage[];
  });
  const socialConfigured = getActiveSocial().id !== 'clicktosend';

  for (const m of due) {
    try {
      if (m.channel === 'email') {
        const recipients = Array.isArray(m.recipients) ? (m.recipients as string[]) : [];
        if (recipients.length === 0) continue; // active but unconfigured — skip, never guess
        await createPendingAction({
          project_id: m.project_id,
          action_type: 'send_campaign_message',
          title: `Send email ${m.position}/${m.total}: ${m.subject ?? m.campaign_title}`.slice(0, 200),
          rationale: `Scheduled message from campaign "${m.campaign_title}" is due. Review (and edit) the copy, then Apply to send to ${recipients.length} recipient(s). Reject to skip it.`.slice(0, 400),
          payload: {
            campaign_message_id: m.id,
            campaign_id: m.campaign_id,
            channel: 'email',
            subject: m.subject ?? '',
            body_html: m.body,
            recipients,
            recipient_count: recipients.length,
          },
          estimated_impact: 'high',
        });
      } else if (socialConfigured) {
        // Real social driver available → same action type, channel-routed executor.
        await createPendingAction({
          project_id: m.project_id,
          action_type: 'send_campaign_message',
          title: `Post to ${m.channel === 'x' ? 'X' : 'LinkedIn'} (${m.position}/${m.total}): ${m.campaign_title}`.slice(0, 200),
          rationale: `Scheduled post from "${m.campaign_title}" is due. Review the copy, then Apply to publish via ${getActiveSocial().label}.`.slice(0, 400),
          payload: {
            campaign_message_id: m.id,
            campaign_id: m.campaign_id,
            channel: m.channel,
            body_html: m.body,
          },
          estimated_impact: 'medium',
        });
      } else {
        // Click-to-send fallback: the founder's click IS the send.
        await createPendingAction({
          project_id: m.project_id,
          action_type: m.channel === 'linkedin' ? 'draft_linkedin_post' : 'draft_email',
          title: `Post ${m.position}/${m.total} from "${m.campaign_title}"`.slice(0, 200),
          rationale: 'Scheduled social post is due — Apply to open it ready-to-publish in your own account.'.slice(0, 400),
          payload: {
            campaign_message_id: m.id,
            campaign_id: m.campaign_id,
            draft: m.body,
            content: m.body,
          },
          estimated_impact: 'medium',
        });
      }
      await run(`UPDATE campaign_messages SET status = 'proposed' WHERE id = ?`, m.id);
      proposed++;
    } catch (err) {
      console.warn(`[launch:send-proposer] propose failed for ${m.id} (non-fatal):`, (err as Error).message);
    }
  }
  return proposed;
}

/**
 * Campaigns data layer (launch pipeline W2/W3) — capture-at-persist + lifecycle.
 *
 * A skill emits an email-sequence / social-calendar / ad-pack artifact; the
 * persistence layer calls captureCampaignFromArtifact so the deliverable
 * becomes a DRAFT campaigns row + per-message drafts. Nothing here sends:
 * activation stamps schedules, the cron proposer turns due messages into
 * Inbox proposals, and only the founder's Apply executes a send.
 *
 * Idempotent on source_artifact_id — re-persisting the same artifact (skill
 * re-run snapshot, digest sweep) never duplicates a campaign.
 */

import { query, run, get } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import type { EmailSequenceArtifact, SocialCalendarArtifact, AdPackArtifact } from '@/types/artifacts';

export type CampaignKind = 'email_sequence' | 'social_calendar' | 'ad_pack';

export interface CampaignRow {
  id: string;
  project_id: string;
  kind: CampaignKind;
  title: string;
  source_artifact_id: string | null;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
  config: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignMessageRow {
  id: string;
  campaign_id: string;
  project_id: string;
  channel: string;
  position: number;
  subject: string | null;
  body: string;
  scheduled_at: string | null;
  status: 'draft' | 'proposed' | 'sent' | 'skipped' | 'failed';
  sent_at: string | null;
  send_ref: string | null;
  recipient_count: number | null;
  metadata: Record<string, unknown> | null;
}

async function existingCampaignFor(projectId: string, sourceArtifactId: string): Promise<string | null> {
  const row = await get<{ id: string }>(
    `SELECT id FROM campaigns WHERE project_id = ? AND source_artifact_id = ? LIMIT 1`,
    projectId, sourceArtifactId,
  );
  return row?.id ?? null;
}

async function insertCampaign(input: {
  projectId: string;
  kind: CampaignKind;
  title: string;
  sourceArtifactId: string;
  status?: 'draft' | 'completed';
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const id = generateId('cmp');
  await run(
    `INSERT INTO campaigns (id, project_id, kind, title, source_artifact_id, status, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, input.projectId, input.kind, input.title.slice(0, 200), input.sourceArtifactId,
    input.status ?? 'draft', input.metadata ?? {},
  );
  return id;
}

/** Capture an email-sequence artifact → draft campaign + message drafts.
 *  send_offset_days rides message metadata until activation stamps real
 *  scheduled_at timestamps. Returns the campaign id (existing on re-persist). */
export async function captureEmailSequence(
  projectId: string, sourceArtifactId: string, a: EmailSequenceArtifact,
): Promise<string | null> {
  if (!Array.isArray(a.messages) || a.messages.length === 0) return null;
  const existing = await existingCampaignFor(projectId, sourceArtifactId);
  if (existing) return existing;
  const campaignId = await insertCampaign({
    projectId, kind: 'email_sequence', title: a.title || 'Email sequence',
    sourceArtifactId, metadata: { goal: a.goal, audience_notes: a.audience_notes ?? null },
  });
  let pos = 0;
  for (const m of a.messages) {
    pos += 1;
    await run(
      `INSERT INTO campaign_messages (id, campaign_id, project_id, channel, position, subject, body, metadata)
       VALUES (?, ?, ?, 'email', ?, ?, ?, ?)`,
      generateId('cmsg'), campaignId, projectId,
      Number.isFinite(m.position) ? m.position : pos,
      (m.subject || `Email ${pos}`).slice(0, 300),
      m.body_html || '',
      { send_offset_days: Number.isFinite(m.send_offset_days) ? m.send_offset_days : (pos - 1) * 3 },
    );
  }
  return campaignId;
}

/** Capture a social-calendar artifact → draft campaign + one message per post. */
export async function captureSocialCalendar(
  projectId: string, sourceArtifactId: string, a: SocialCalendarArtifact,
): Promise<string | null> {
  if (!Array.isArray(a.posts) || a.posts.length === 0) return null;
  const existing = await existingCampaignFor(projectId, sourceArtifactId);
  if (existing) return existing;
  const campaignId = await insertCampaign({
    projectId, kind: 'social_calendar', title: a.title || 'Social calendar', sourceArtifactId,
  });
  let pos = 0;
  for (const p of a.posts) {
    pos += 1;
    await run(
      `INSERT INTO campaign_messages (id, campaign_id, project_id, channel, position, subject, body, metadata)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      generateId('cmsg'), campaignId, projectId,
      p.channel === 'x' ? 'x' : 'linkedin',
      Number.isFinite(p.position) ? p.position : pos,
      p.body || '',
      { day_offset: Number.isFinite(p.day_offset) ? p.day_offset : pos - 1, best_time_hint: p.best_time_hint ?? null },
    );
  }
  return campaignId;
}

/** Capture an ad-pack artifact → a completed campaign row (export-only: the
 *  deliverable is downloaded, never sent — no messages, no lifecycle). */
export async function captureAdPack(
  projectId: string, sourceArtifactId: string, a: AdPackArtifact,
): Promise<string | null> {
  const existing = await existingCampaignFor(projectId, sourceArtifactId);
  if (existing) return existing;
  return insertCampaign({
    projectId, kind: 'ad_pack', title: a.title || 'Ad campaign pack', sourceArtifactId,
    status: 'completed',
    metadata: {
      platform_targets: a.platform_targets ?? [],
      audiences: (a.audiences ?? []).length,
      total_monthly_usd: a.budget?.total_monthly_usd ?? null,
    },
  });
}

/** Activate a campaign: store founder-provided config (recipients for email)
 *  and stamp scheduled_at on every draft message from its stored offset.
 *  The schedule makes messages ELIGIBLE for cron proposal — not for sending. */
export async function activateCampaign(
  projectId: string, campaignId: string, config: Record<string, unknown>,
): Promise<{ scheduled: number }> {
  const campaign = await get<CampaignRow>(
    `SELECT * FROM campaigns WHERE id = ? AND project_id = ?`, campaignId, projectId,
  );
  if (!campaign) throw new Error('LAUNCH_NOT_FOUND: campaign not found in this project.');
  if (campaign.kind === 'email_sequence') {
    const recipients = Array.isArray(config.recipients) ? (config.recipients as string[]).filter((r) => /\S+@\S+\.\S+/.test(r)) : [];
    if (recipients.length === 0) throw new Error('LAUNCH_UNSUPPORTED: an email campaign needs at least one valid recipient.');
    config = { ...config, recipients };
  }
  await run(
    `UPDATE campaigns SET status = 'active', config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    config, campaignId,
  );
  const drafts = await query<{ id: string; metadata: Record<string, unknown> | null }>(
    `SELECT id, metadata FROM campaign_messages WHERE campaign_id = ? AND status = 'draft'`, campaignId,
  );
  const now = Date.now();
  for (const m of drafts) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    const offsetDays = Number(meta.send_offset_days ?? meta.day_offset ?? 0);
    const when = new Date(now + Math.max(0, offsetDays) * 86_400_000).toISOString();
    await run(`UPDATE campaign_messages SET scheduled_at = ? WHERE id = ?`, when, m.id);
  }
  return { scheduled: drafts.length };
}

export async function pauseCampaign(projectId: string, campaignId: string): Promise<void> {
  await run(
    `UPDATE campaigns SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?`,
    campaignId, projectId,
  );
}

export async function listCampaigns(projectId: string): Promise<Array<CampaignRow & { message_count: number; sent_count: number }>> {
  return query<CampaignRow & { message_count: number; sent_count: number }>(
    `SELECT c.*,
            (SELECT count(*)::int FROM campaign_messages m WHERE m.campaign_id = c.id) AS message_count,
            (SELECT count(*)::int FROM campaign_messages m WHERE m.campaign_id = c.id AND m.status = 'sent') AS sent_count
       FROM campaigns c WHERE c.project_id = ? ORDER BY c.created_at DESC`,
    projectId,
  );
}

export async function getCampaignWithMessages(
  projectId: string, campaignId: string,
): Promise<{ campaign: CampaignRow; messages: CampaignMessageRow[] } | null> {
  const campaign = await get<CampaignRow>(
    `SELECT * FROM campaigns WHERE id = ? AND project_id = ?`, campaignId, projectId,
  );
  if (!campaign) return null;
  const messages = await query<CampaignMessageRow>(
    `SELECT * FROM campaign_messages WHERE campaign_id = ? ORDER BY position ASC`, campaignId,
  );
  return { campaign, messages };
}

/** Mark the campaign completed when no undelivered messages remain. */
export async function maybeCompleteCampaign(campaignId: string): Promise<void> {
  await run(
    `UPDATE campaigns SET status = 'completed', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'active'
        AND NOT EXISTS (SELECT 1 FROM campaign_messages m
                         WHERE m.campaign_id = campaigns.id AND m.status IN ('draft','proposed'))`,
    campaignId,
  );
}

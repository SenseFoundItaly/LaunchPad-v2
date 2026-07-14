/**
 * SocialAdapter — the launch pipeline's social-posting driver contract.
 * 'clicktosend' is the zero-key fallback (posts surface as the existing
 * draft_linkedin_post/draft_email click-to-send actions — the founder's click
 * IS the send). 'ayrshare' posts programmatically through ONE API key; the
 * founder links their accounts once in Ayrshare's dashboard.
 *
 * INVARIANT: post() has exactly ONE production call site — the
 * send_campaign_message executor (founder Apply). Never call from cron.
 */

export type SocialId = 'clicktosend' | 'ayrshare';
export type SocialChannel = 'linkedin' | 'x';

export interface SocialPostInput {
  projectId: string;
  channel: SocialChannel;
  body: string;
}

export interface SocialPostOutcome {
  ok: boolean;
  stubbed: boolean;
  /** ayrshare post id when real. */
  postRef?: string;
  /** Public URL when the platform returns one. */
  url?: string;
  error?: string;
}

export interface SocialAdapter {
  id: SocialId;
  label: string;
  isConfigured(): boolean;
  post(input: SocialPostInput): Promise<SocialPostOutcome>;
}

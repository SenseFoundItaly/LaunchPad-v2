/**
 * SenderAdapter — the launch pipeline's campaign-email driver contract.
 * Registry + isConfigured() key-gating + stub fallback, like publishers/.
 *
 * INVARIANT (validation-gate): SenderAdapter.send has exactly ONE production
 * call site — the send_campaign_message executor, which only runs on founder
 * Apply of an Inbox proposal. Never call send() from cron, chat, or skills.
 */

export type SenderId = 'stub' | 'resend';

export interface SendInput {
  projectId: string;
  /** Founder-provided recipients (campaigns.config.recipients). */
  to: string[];
  subject: string;
  html: string;
  from?: string;
}

export interface SendOutcome {
  ok: boolean;
  stubbed: boolean;
  /** Resend broadcast id / 'stub'. */
  providerRef?: string;
  error?: string;
}

export interface SenderAdapter {
  id: SenderId;
  label: string;
  isConfigured(): boolean;
  send(input: SendInput): Promise<SendOutcome>;
}

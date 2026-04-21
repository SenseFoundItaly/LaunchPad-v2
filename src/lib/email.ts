/**
 * Email channel — Monday Brief delivery.
 *
 * Today's behavior: STUBBED. If RESEND_API_KEY is unset (the current case),
 * sendBrief() logs "would have emailed X" and returns {stubbed: true} without
 * making any network calls. Drop in RESEND_API_KEY + change FROM_ADDRESS to
 * your verified sender and real email starts flowing on the very next cron
 * tick — no other code changes needed.
 *
 * Why stub: the chat + agent work is the in-app loop we want to validate
 * first. Email is optional for M1 — Monday Brief has an in-app page
 * (/project/[id]/brief). Email is additive reach, not the critical path.
 */

import { query } from '@/lib/db';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.LAUNCHPAD_MAIL_FROM || 'launchpad@example.com';
const APP_URL = process.env.LAUNCHPAD_APP_URL || 'http://localhost:3000';

export interface BriefEmailInput {
  userId: string;
  projectId: string;
  projectName: string;
  pendingActions: { id: string; title: string; rationale?: string }[];
  ecosystemAlerts: { headline: string; body?: string; relevance_score: number }[];
  heartbeatSummary?: string;
}

export interface SendResult {
  stubbed: boolean;
  ok: boolean;
  error?: string;
  id?: string;
  to?: string;
}

/**
 * Send the Monday Brief email. Stubbed when RESEND_API_KEY is absent.
 *
 * Looks up the user's email from the shadow `users` table. Returns without
 * attempting to send if the user has no email on file (shouldn't happen once
 * Supabase auth round-trip is in place).
 */
export async function sendBrief(input: BriefEmailInput): Promise<SendResult> {
  const user = query<{ email: string | null }>(
    'SELECT email FROM users WHERE id = ?', input.userId,
  )[0];
  const to = user?.email ?? null;

  if (!to) {
    return { stubbed: true, ok: false, error: 'No email on file for user' };
  }

  const html = renderBriefHtml(input);

  if (!RESEND_API_KEY) {
    console.log(
      `[email/stub] Would have sent Monday Brief to ${to} ` +
      `(project=${input.projectName}, pending=${input.pendingActions.length}, ` +
      `alerts=${input.ecosystemAlerts.length}, html=${html.length}b). ` +
      `Set RESEND_API_KEY + LAUNCHPAD_MAIL_FROM to flip from stub to real delivery.`,
    );
    return { stubbed: true, ok: true, to };
  }

  // Real send path. Kept as a conditional branch so the stub case has no
  // dependency on the resend package (no import cost when unused).
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to,
        subject: `Monday Brief — ${input.projectName}`,
        html,
      }),
    });
    if (!resp.ok) {
      return { stubbed: false, ok: false, error: `Resend HTTP ${resp.status}`, to };
    }
    const data = (await resp.json()) as { id?: string };
    return { stubbed: false, ok: true, id: data.id, to };
  } catch (err) {
    return { stubbed: false, ok: false, error: (err as Error).message, to };
  }
}

/**
 * Minimal HTML template. No external CSS framework — just inline styles so
 * every mail client renders consistently.
 */
function renderBriefHtml(input: BriefEmailInput): string {
  const actionsBlock = input.pendingActions.length > 0
    ? `<h3 style="font-size:15px;margin:18px 0 8px 0;color:#111;">Pending actions (${input.pendingActions.length})</h3>
       <ul style="padding-left:18px;margin:0;">
         ${input.pendingActions.slice(0, 5).map(a =>
           `<li style="margin-bottom:6px;"><strong>${escapeHtml(a.title)}</strong>${a.rationale ? `<br/><span style="color:#666;font-size:13px;">${escapeHtml(a.rationale)}</span>` : ''}</li>`,
         ).join('')}
       </ul>`
    : '<p style="color:#888;">No pending actions this week.</p>';

  const alertsBlock = input.ecosystemAlerts.length > 0
    ? `<h3 style="font-size:15px;margin:18px 0 8px 0;color:#111;">Ecosystem alerts</h3>
       <ul style="padding-left:18px;margin:0;">
         ${input.ecosystemAlerts.slice(0, 3).map(a =>
           `<li style="margin-bottom:6px;">${escapeHtml(a.headline)} <span style="color:#999;font-size:12px;">(relevance ${a.relevance_score.toFixed(2)})</span></li>`,
         ).join('')}
       </ul>`
    : '';

  const heartbeatBlock = input.heartbeatSummary
    ? `<div style="padding:12px 14px;background:#f7f7f7;border-radius:6px;margin:18px 0;color:#333;font-size:14px;">
         <strong>Daily reflection</strong><br/>${escapeHtml(input.heartbeatSummary)}
       </div>`
    : '';

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#222;background:#fafafa;">
  <div style="max-width:560px;margin:0 auto;padding:24px;background:#fff;">
    <h1 style="font-size:22px;margin:0 0 8px 0;">Monday Brief</h1>
    <p style="color:#666;margin:0 0 18px 0;">${escapeHtml(input.projectName)}</p>
    ${heartbeatBlock}
    ${actionsBlock}
    ${alertsBlock}
    <p style="margin:24px 0 0 0;">
      <a href="${APP_URL}/project/${input.projectId}/actions"
         style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;">
        Open approval inbox
      </a>
    </p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

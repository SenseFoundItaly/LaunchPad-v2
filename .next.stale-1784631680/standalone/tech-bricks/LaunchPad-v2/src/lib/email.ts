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
const FROM_ADDRESS = process.env.SENSEFOUND_MAIL_FROM || process.env.LAUNCHPAD_MAIL_FROM || 'brief@sensefound.io';
const APP_URL = process.env.SENSEFOUND_APP_URL || process.env.LAUNCHPAD_APP_URL || 'http://localhost:3000';

export interface BriefEmailInput {
  userId: string;
  projectId: string;
  projectName: string;
  pendingActions: { id: string; title: string; rationale?: string }[];
  ecosystemAlerts: { headline: string; body?: string; relevance_score: number }[];
  heartbeatSummary?: string;
  intelligenceBriefs?: { title: string; narrative: string; temporal_prediction: string | null }[];
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
  const rows = await query<{ email: string | null }>(
    'SELECT email FROM users WHERE id = ?', input.userId,
  );
  const user = rows[0];
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
      `Set RESEND_API_KEY + SENSEFOUND_MAIL_FROM to flip from stub to real delivery.`,
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
        subject: `Your Monday Brief — ${input.projectName}`,
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
 * SenseFound-branded HTML template. Table-based layout with inline styles
 * for consistent rendering across all mail clients.
 */
function renderBriefHtml(input: BriefEmailInput): string {
  const actionsBlock = input.pendingActions.length > 0
    ? `<h3 style="font-size:15px;margin:18px 0 8px 0;color:#16140F;">Pending actions (${input.pendingActions.length})</h3>
       <ul style="padding-left:18px;margin:0;">
         ${input.pendingActions.slice(0, 5).map(a =>
           `<li style="margin-bottom:6px;color:#2A2620;"><strong>${escapeHtml(a.title)}</strong>${a.rationale ? `<br/><span style="color:#6B6558;font-size:13px;">${escapeHtml(a.rationale)}</span>` : ''}</li>`,
         ).join('')}
       </ul>`
    : '<p style="color:#8F897A;">No pending actions this week.</p>';

  const alertsBlock = input.ecosystemAlerts.length > 0
    ? `<h3 style="font-size:15px;margin:18px 0 8px 0;color:#16140F;">Ecosystem alerts</h3>
       <ul style="padding-left:18px;margin:0;">
         ${input.ecosystemAlerts.slice(0, 3).map(a =>
           `<li style="margin-bottom:6px;color:#2A2620;">${escapeHtml(a.headline)} <span style="color:#8F897A;font-size:12px;">(relevance ${a.relevance_score.toFixed(2)})</span></li>`,
         ).join('')}
       </ul>`
    : '';

  const heartbeatBlock = input.heartbeatSummary
    ? `<div style="padding:12px 14px;background:#F5E6DC;border-radius:6px;margin:18px 0;color:#2A2620;font-size:14px;">
         <strong style="color:#16140F;">Daily reflection</strong><br/>${escapeHtml(input.heartbeatSummary)}
       </div>`
    : '';

  const briefsBlock = input.intelligenceBriefs && input.intelligenceBriefs.length > 0
    ? `<h3 style="font-size:15px;margin:18px 0 8px 0;color:#16140F;">Intelligence briefs</h3>
       ${input.intelligenceBriefs.slice(0, 2).map(b =>
         `<div style="padding:10px 12px;background:#E8F0EB;border-radius:6px;margin-bottom:8px;border-left:3px solid #6B9B80;">
           <strong style="font-size:13px;color:#16140F;">${escapeHtml(b.title)}</strong>
           ${b.temporal_prediction ? `<br/><span style="font-size:11px;color:#6B6558;font-style:italic;">Prediction: ${escapeHtml(b.temporal_prediction)}</span>` : ''}
           <br/><span style="font-size:12px;color:#2A2620;">${escapeHtml(b.narrative.slice(0, 200))}${b.narrative.length > 200 ? '\u2026' : ''}</span>
         </div>`,
       ).join('')}`
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:#FAF5EE;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF5EE;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#FFFFFF;border:1px solid #E5DFCF;border-radius:8px;overflow:hidden;">
          <!-- Gradient bar -->
          <tr>
            <td style="height:4px;background:linear-gradient(to right,#D4896A,#FAF5EE,#6B9B80);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <!-- Bracket motif + wordmark -->
          <tr>
            <td align="center" style="padding:24px 40px 0 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:28px;font-weight:300;color:#6B9B80;padding-right:6px;vertical-align:middle;font-family:Georgia,serif;">&#91;</td>
                  <td style="font-size:16px;font-weight:600;letter-spacing:3px;color:#16140F;vertical-align:middle;">SENSEFOUND</td>
                  <td style="font-size:28px;font-weight:300;color:#6B9B80;padding-left:6px;vertical-align:middle;font-family:Georgia,serif;">&#93;</td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Content area -->
          <tr>
            <td style="padding:24px 40px 0 40px;">
              <h1 style="font-size:22px;margin:0 0 4px 0;color:#16140F;">Your Monday Brief</h1>
              <p style="color:#6B6558;margin:0 0 4px 0;font-size:14px;">Here's what matters for <strong style="color:#2A2620;">${escapeHtml(input.projectName)}</strong> this week.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px;">
              ${heartbeatBlock}
              ${briefsBlock}
              ${actionsBlock}
              ${alertsBlock}
              <p style="margin:24px 0 0 0;">
                <a href="${APP_URL}/project/${input.projectId}/actions"
                   style="display:inline-block;padding:12px 24px;background:#6B9B80;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">
                  Open your workspace &#8599;
                </a>
              </p>
            </td>
          </tr>
          <!-- Divider -->
          <tr>
            <td style="padding:24px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid #E5DFCF;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 40px 28px 40px;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#B4AE9F;text-align:center;">
                Courage through clarity &middot; AI-powered, human-protected
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Magic-link email — locale-aware, SenseFound branded
// ---------------------------------------------------------------------------

type SupportedLocale = 'en' | 'it';

const MAGIC_LINK_STRINGS: Record<SupportedLocale, {
  subject: string;
  heading: string;
  body: string;
  cta: string;
  security: string;
  tagline: string;
  subtitle: string;
}> = {
  en: {
    subject: 'Your Magic Link',
    heading: 'Your Magic Link',
    body: 'Click the button below to securely sign in to your workspace. This link expires in 10 minutes and can only be used once.',
    cta: 'Log In',
    security: "If you didn\u2019t request this link, you can safely ignore this email.",
    tagline: 'Courage through clarity',
    subtitle: 'AI-powered, human-protected',
  },
  it: {
    subject: 'Il tuo Magic Link',
    heading: 'Il tuo Magic Link',
    body: 'Clicca il pulsante qui sotto per accedere in modo sicuro al tuo workspace. Questo link scade tra 10 minuti e pu\u00f2 essere usato una sola volta.',
    cta: 'Accedi',
    security: 'Se non hai richiesto questo link, puoi ignorare questa email.',
    tagline: 'Coraggio attraverso la chiarezza',
    subtitle: "Potenziato dall\u2019AI, protetto dall\u2019uomo",
  },
};

function resolveLocale(raw?: string): SupportedLocale {
  const code = (raw || 'en').slice(0, 2).toLowerCase();
  return code in MAGIC_LINK_STRINGS ? code as SupportedLocale : 'en';
}

export function renderMagicLinkHtml(confirmationUrl: string, locale?: string): string {
  const t = MAGIC_LINK_STRINGS[resolveLocale(locale)];
  const lang = resolveLocale(locale);
  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#FAF5EE;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAF5EE;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background-color:#FFFFFF;border:1px solid #E5DFCF;border-radius:8px;overflow:hidden;">
          <tr><td style="height:4px;background:linear-gradient(to right,#D4896A,#FAF5EE,#6B9B80);font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr>
            <td align="center" style="padding:32px 40px 0 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:28px;font-weight:300;color:#6B9B80;padding-right:6px;vertical-align:middle;font-family:Georgia,'Times New Roman',serif;">&#91;</td>
                  <td style="font-size:15px;font-weight:600;letter-spacing:3px;color:#16140F;vertical-align:middle;">SENSEFOUND</td>
                  <td style="font-size:28px;font-weight:300;color:#6B9B80;padding-left:6px;vertical-align:middle;font-family:Georgia,'Times New Roman',serif;">&#93;</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td align="center" style="padding:28px 40px 0 40px;"><h1 style="margin:0;font-size:22px;font-weight:600;color:#16140F;">${escapeHtml(t.heading)}</h1></td></tr>
          <tr><td align="center" style="padding:12px 40px 0 40px;"><p style="margin:0;font-size:15px;line-height:1.6;color:#6B6558;">${escapeHtml(t.body)}</p></td></tr>
          <tr>
            <td align="center" style="padding:28px 40px 0 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="background-color:#6B9B80;border-radius:6px;">
                    <a href="${escapeHtml(confirmationUrl)}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;font-family:Inter,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">${escapeHtml(t.cta)} &#8599;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td align="center" style="padding:24px 40px 0 40px;"><p style="margin:0;font-size:13px;line-height:1.5;color:#8F897A;">${escapeHtml(t.security)}</p></td></tr>
          <tr>
            <td style="padding:28px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid #E5DFCF;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <tr><td align="center" style="padding:16px 40px 32px 40px;"><p style="margin:0;font-size:12px;line-height:1.5;color:#B4AE9F;">${escapeHtml(t.tagline)} &middot; ${escapeHtml(t.subtitle)}</p></td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function getMagicLinkSubject(locale?: string): string {
  return MAGIC_LINK_STRINGS[resolveLocale(locale)].subject;
}

/**
 * Send a branded magic-link email via Resend. Called from the Supabase
 * Auth Hook endpoint (/api/auth/hook/send-email). Stubbed when
 * RESEND_API_KEY is absent — Supabase's default email still goes out.
 */
export async function sendMagicLink(
  to: string,
  confirmationUrl: string,
  locale?: string,
): Promise<SendResult> {
  const html = renderMagicLinkHtml(confirmationUrl, locale);
  const subject = getMagicLinkSubject(locale);

  if (!RESEND_API_KEY) {
    console.log(
      `[email/stub] Would have sent magic link to ${to} ` +
      `(locale=${locale || 'en'}, html=${html.length}b). ` +
      `Set RESEND_API_KEY + SENSEFOUND_MAIL_FROM to enable.`,
    );
    return { stubbed: true, ok: true, to };
  }

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

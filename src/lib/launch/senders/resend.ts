/**
 * Resend sender — campaign sends via Broadcasts + Audiences (NOT raw /emails):
 * create an audience, add the founder-provided recipients as contacts, create
 * a broadcast, send it. Resend injects managed unsubscribe links into
 * broadcasts, so list-email compliance is handled by the platform and
 * unsubscribes are honored on Resend's side on every subsequent send.
 *
 * Reuses the API surface (bearer key, api.resend.com) already proven by the
 * transactional client in src/lib/email.ts.
 */

import type { SenderAdapter, SendInput, SendOutcome } from './types';

const API = 'https://api.resend.com';

async function resendJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`resend POST ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export const resendSender: SenderAdapter = {
  id: 'resend',
  label: 'Resend (Broadcasts)',
  isConfigured: () => !!process.env.RESEND_API_KEY,

  async send(input: SendInput): Promise<SendOutcome> {
    try {
      const from = input.from
        || process.env.LAUNCH_MAIL_FROM
        || process.env.LAUNCHPAD_MAIL_FROM
        || 'launch@sensefound.io';

      // 1. Audience per send batch. Contact-level dedup is Resend's job.
      const audience = await resendJson<{ id: string }>('/audiences', {
        name: `launchpad-${input.projectId}-${Date.now().toString(36)}`,
      });
      for (const email of input.to) {
        await resendJson(`/audiences/${audience.id}/contacts`, { email, unsubscribed: false })
          .catch((err) => console.warn(`[launch:resend] contact add failed (continuing): ${(err as Error).message}`));
      }

      // 2. Broadcast → send. Managed unsubscribe requires the marker in the body.
      const html = input.html.includes('{{{RESEND_UNSUBSCRIBE_URL}}}')
        ? input.html
        : `${input.html}\n<p style="font-size:11px;color:#888"><a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a></p>`;
      const broadcast = await resendJson<{ id: string }>('/broadcasts', {
        audience_id: audience.id,
        from,
        subject: input.subject,
        html,
      });
      await resendJson(`/broadcasts/${broadcast.id}/send`, {});

      return { ok: true, stubbed: false, providerRef: broadcast.id };
    } catch (err) {
      return { ok: false, stubbed: false, error: (err as Error).message };
    }
  },
};

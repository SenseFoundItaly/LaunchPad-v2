import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { renderWelcomeHtml } from './email';

/**
 * The founder onboarding chain: login → auth email → callback → first project
 * → tour (2026-08-08 onboarding audit, 24 confirmed findings).
 *
 * The chain's central defect was that its two halves disagreed on the token
 * format — the branded email minted `token_hash`, the callback only redeemed
 * `code` — so enabling the hook would have killed login for 100% of founders
 * while looking perfectly implemented. These tests pin the seams, not the
 * prose, because every seam here spans two files that can drift apart.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

describe('the emailed link is redeemable by our own callback', () => {
  const hook = read('src/app/api/auth/hook/send-email/route.ts');
  const callback = read('src/app/api/auth/callback/route.ts');

  it('the hook mints token_hash + type, and the callback verifies exactly that', () => {
    expect(hook).toMatch(/token_hash=\$\{encodeURIComponent\(email_data\.token_hash\)\}/);
    expect(hook).toMatch(/type=\$\{encodeURIComponent\(actionType\)\}/);
    // The redemption half: without verifyOtp the emailed link is inert.
    expect(callback).toContain('supabase.auth.verifyOtp({');
    expect(callback).toContain('token_hash: tokenHash');
  });

  it('the PKCE path (Supabase default template) still works', () => {
    expect(callback).toContain('exchangeCodeForSession(code)');
  });

  it('handles the canonical Supabase type spelling and the signup case', () => {
    // 'magic_link' (underscore) matches nothing real — EmailOtpType is
    // 'magiclink'; and a brand-new founder's FIRST email is type 'signup'.
    expect(hook).toMatch(/HANDLED_TYPES = new Set\(\[[^\]]*'magiclink'[^\]]*'signup'/);
    // No COMPARISON against the underscored spelling may survive (the prose
    // above still names it as the bug that was fixed).
    expect(hook).not.toMatch(/[!=]==\s*'magic_link'/);
  });

  it('never answers a Send Email hook with a non-2xx it can avoid', () => {
    // A non-2xx aborts the founder's auth request — Supabase does NOT fall
    // back to its own template, so an unhandled type must still be 200.
    expect(hook).toMatch(/HANDLED_TYPES\.has\(actionType\)[\s\S]{0,400}success: true, skipped/);
  });
});

describe('the auth hook is not an open email relay', () => {
  const hook = read('src/app/api/auth/hook/send-email/route.ts');

  it('fails CLOSED when the signing secret is missing', () => {
    // Verified live on prod 2026-08-08: an unauthenticated POST reached the
    // type branch because verification was skipped when the secret was unset.
    expect(hook).toMatch(/if \(!HOOK_SECRET\)[\s\S]{0,300}status: 500/);
    // The old shape — verification only when a secret happens to exist.
    expect(hook).not.toMatch(/if \(HOOK_SECRET\) \{\s*\n\s*const sig/);
  });

  it('builds the link from our own APP_URL, never the payload site_url', () => {
    expect(hook).toMatch(/const confirmationUrl =\s*\n?\s*`\$\{APP_URL\}\/api\/auth\/callback/);
  });

  it('reports a stubbed (unsent) email as a failure, not as delivery', () => {
    expect(hook).toMatch(/result\.stubbed[\s\S]{0,600}status: 500/);
  });
});

describe('the founder locale survives the front door', () => {
  it('the callback persists the signup locale and seeds the UI cookie', () => {
    const callback = read('src/app/api/auth/callback/route.ts');
    expect(callback).toMatch(/UPDATE users SET locale = \? WHERE id = \? AND locale IS NULL/);
    expect(callback).toContain("response.cookies.set('lp_locale'");
  });

  it('the hook prefers the durable users.locale over stale auth metadata', () => {
    // user_metadata is only ever written at account creation, so a founder who
    // later picked Italian in Settings would otherwise keep getting English.
    expect(read('src/app/api/auth/hook/send-email/route.ts'))
      .toMatch(/SELECT locale FROM users WHERE id = \?/);
  });
});

describe('a failed login link explains itself', () => {
  it('the login page reads the error the callback sets', () => {
    const login = read('src/app/login/page.tsx');
    expect(login).toContain("search.get('error')");
    expect(login).toContain("t('login.link-failed')");
  });

  it('the sent state offers resend and a way to fix a typo', () => {
    const login = read('src/app/login/page.tsx');
    expect(login).toContain("t('login.resend')");
    expect(login).toContain("t('login.change-email')");
  });
});

describe('the tour is not spent before the founder sees it', () => {
  it('the zero-project stub never marks the account onboarded', () => {
    const ctrl = read('src/components/onboarding/TourController.tsx');
    expect(ctrl).toContain('const isStub = !pid;');
    expect(ctrl).toContain('markDone({ keepOffer: isStub })');
    expect(ctrl).toMatch(/const markDone = \(\{ keepOffer = false \} = \{\}\)/);
  });

  it('navigating away defers the tour instead of burning it', () => {
    const ctrl = read('src/components/onboarding/TourController.tsx');
    expect(ctrl).toContain('navAbandon.current = true;');
    expect(ctrl).toMatch(/navAbandon\.current[\s\S]{0,200}deferTourForSession\(\)[\s\S]{0,120}keepOffer: true/);
    expect(ctrl).toContain('!isTourDeferred()');
  });

  it('relaunchTour works from a project page (the Home card entry point)', () => {
    // It writes step 0 for the DASHBOARD chapter; called from /project/* the
    // controller used to read that, see the wrong pathname, and mark done.
    expect(read('src/components/onboarding/tour-state.ts'))
      .toMatch(/window\.location\.pathname !== '\/'[\s\S]{0,120}window\.location\.assign\('\/'\)/);
  });

  it('the create-a-project step is actually clickable', () => {
    expect(read('src/components/onboarding/tour-steps.ts')).toMatch(/id: 'create-empty'[\s\S]{0,400}allowInteraction: true/);
    expect(read('src/components/onboarding/TourController.tsx'))
      .toContain('...(s.allowInteraction ? { disableActiveInteraction: false } : {})');
  });
});

describe('the welcome email', () => {
  it('is sent on first login only, and never blocks getting in', () => {
    const callback = read('src/app/api/auth/callback/route.ts');
    // Existence is read BEFORE requireUser() creates the row — that ordering
    // IS the first-login test; inverting it would mail every single login.
    expect(callback).toMatch(/SELECT id FROM users WHERE id = \?[\s\S]{0,300}await requireUser\(\)/);
    expect(callback).toContain('if (authUser?.email && !preexisting)');
  });

  it('renders in both locales and announces the weekly brief', () => {
    const it = renderWelcomeHtml('it');
    expect(it).toContain('Benvenuto in LaunchPad');
    expect(it).toContain('Monday Brief');
    expect(it).toContain('<html lang="it">');

    const en = renderWelcomeHtml('en');
    expect(en).toContain('Welcome to LaunchPad');
    expect(en).toContain('Monday Brief');
    // Unknown locale degrades to English rather than throwing.
    expect(renderWelcomeHtml('zz')).toContain('Welcome to LaunchPad');
  });

  it('the tour finish copy also names the weekly email', () => {
    for (const f of ['src/lib/i18n/messages/it.ts', 'src/lib/i18n/messages/en.ts']) {
      expect(read(f)).toMatch(/'tour\.finish\.desc':[^\n]*Monday Brief/);
    }
  });
});

describe('the hook verifies signatures the way Supabase actually signs', () => {
  // Supabase Send Email hooks use Standard Webhooks: the signed content is
  // `{webhook-id}.{webhook-timestamp}.{body}`, the secret is base64 behind a
  // `whsec_` prefix, and the signature is base64. A hex-HMAC-over-the-body
  // check (the first version of this route) rejects EVERY genuine call — i.e.
  // 401 on every login the moment the hook is switched on. Exercise the real
  // verifier rather than asserting on its source text.
  const load = async (secret: string) => {
    process.env.SUPABASE_AUTH_HOOK_SECRET = secret;
    process.env.SENSEFOUND_APP_URL = 'https://launchpad.sensefound.io';
    vi.resetModules();
    return await import('@/app/api/auth/hook/send-email/route');
  };

  const rawSecret = Buffer.from('supersecretkeymaterial').toString('base64');
  const body = JSON.stringify({
    user: { id: 'u1', email: 'founder@example.com' },
    email_data: {
      token: 't', token_hash: 'th', redirect_to: '/', email_action_type: 'magiclink',
      site_url: 'https://launchpad.sensefound.io',
    },
  });

  const signed = (secret: string, id: string, ts: string) =>
    createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64'))
      .update(`${id}.${ts}.${body}`)
      .digest('base64');

  const post = (headers: Record<string, string>) =>
    new NextRequest('https://launchpad.sensefound.io/api/auth/hook/send-email', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
    });

  it('accepts a correctly Standard-Webhooks-signed request', async () => {
    const { POST } = await load(`whsec_${rawSecret}`);
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await POST(post({
      'webhook-id': 'msg_1',
      'webhook-timestamp': ts,
      'webhook-signature': `v1,${signed(`whsec_${rawSecret}`, 'msg_1', ts)}`,
    }));
    // Past the 401 gate. Delivery itself is stubbed here (no RESEND_API_KEY),
    // which the route reports as 500 — the point is that it is NOT rejected.
    expect(res.status).not.toBe(401);
  });

  it('rejects a valid signature computed over a DIFFERENT id/timestamp (replay)', async () => {
    const { POST } = await load(`whsec_${rawSecret}`);
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await POST(post({
      'webhook-id': 'msg_1',
      'webhook-timestamp': ts,
      'webhook-signature': `v1,${signed(`whsec_${rawSecret}`, 'msg_OTHER', ts)}`,
    }));
    expect(res.status).toBe(401);
  });

  it('rejects a stale timestamp even when the signature matches it', async () => {
    const { POST } = await load(`whsec_${rawSecret}`);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const res = await POST(post({
      'webhook-id': 'msg_1',
      'webhook-timestamp': old,
      'webhook-signature': `v1,${signed(`whsec_${rawSecret}`, 'msg_1', old)}`,
    }));
    expect(res.status).toBe(401);
  });

  it('refuses everything when no secret is configured', async () => {
    delete process.env.SUPABASE_AUTH_HOOK_SECRET;
    vi.resetModules();
    const { POST } = await import('@/app/api/auth/hook/send-email/route');
    const res = await POST(post({}));
    expect(res.status).toBe(500);
  });
});

/**
 * "INIZIA DA QUI" — the changelog 4/08 REVIEW ONBOARDING copy.
 *
 * The MINI TOUR half of that block shipped verbatim in #401; the checklist half
 * did not. Row 2 had its detail welded into the title, and rows 1 and 4 lost
 * their detail entirely — including the line that does the most work in the
 * whole card: the default watchers switch themselves on, so creating one now is
 * optional. These pin the SHAPE (a question + an optional detail line, in both
 * locales), not the wording, which is the founder's to change.
 */
describe('the Start-here checklist follows the founder\'s two-line shape', () => {
  const en = read('src/lib/i18n/messages/en.ts');
  const itMsgs = read('src/lib/i18n/messages/it.ts');
  const card = read('src/components/onboarding/OnboardingCard.tsx');

  it.each(['step-tour', 'step-knowledge', 'step-watcher'])('%s carries a detail line in both locales', (row) => {
    expect(en).toContain(`'onboarding.${row}-hint'`);
    expect(itMsgs).toContain(`'onboarding.${row}-hint'`);
  });

  it('row 3 deliberately has no detail line — the action explains itself', () => {
    expect(en).not.toContain("'onboarding.step-canvas-hint'");
    expect(itMsgs).not.toContain("'onboarding.step-canvas-hint'");
  });

  it('the watcher row says the default watchers start themselves', () => {
    // The reassurance is the point of that row: without it, "create a watcher"
    // reads as a chore the founder must do before anything works.
    expect(itMsgs).toMatch(/quelli di base si attivano da soli/);
    expect(en).toMatch(/default ones switch themselves on/);
  });

  it('both row shells render the same body, so the copy cannot drift', () => {
    // A button (relaunch tour) and a Link (navigate) — the two-renderer trap.
    expect(card).toMatch(/const stepBody = /);
    expect(card.match(/\{stepBody\(s, i\)\}/g)?.length).toBe(2);
  });

  it('the hint renders only when the row has one', () => {
    expect(card).toMatch(/\{s\.hint && \(/);
  });
});

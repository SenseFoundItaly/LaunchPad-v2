import { describe, it, expect } from 'vitest';
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

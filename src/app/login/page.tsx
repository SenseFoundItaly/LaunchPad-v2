'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/auth/supabase-browser';
import { useT } from '@/components/providers/LocaleProvider';

/**
 * Next.js 16 requires any client component that reads URL search params during
 * render to be wrapped in a Suspense boundary so the outer page can still be
 * statically prerendered. Splitting the form into a separate component lets
 * the parent render a static shell while the form streams in.
 */

function LoginForm() {
  const t = useT();
  const search = useSearchParams();
  const nextPath = search.get('next') || '/';
  // The callback redirects every auth failure here as ?error=<reason> (expired
  // link, already-used link, opened on another device). Until the 2026-08-08
  // audit nothing read it, so a founder in that loop saw a pristine form with
  // no explanation and could re-request links forever.
  const callbackError = search.get('error');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function send(target: string) {
    setStatus('sending');
    setError(null);
    const supabase = getSupabaseBrowser();
    const redirectTo = `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(nextPath)}`;
    const locale = navigator.language.slice(0, 2);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: target,
      options: { emailRedirectTo: redirectTo, data: { locale } },
    });
    if (err) {
      setStatus('error');
      setError(err.message);
    } else {
      setStatus('sent');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    await send(email.trim());
  }

  if (status === 'sent') {
    return (
      <div className="space-y-3">
        <div className="rounded border border-moss/30 bg-moss-wash p-4 text-sm">
          {t('login.sent-check-prefix')} <span className="font-medium">{email}</span> {t('login.sent-check-suffix')}
        </div>
        {/* "Check your inbox" used to be terminal: a typo'd address or a mail
            that never arrived left no way forward but guessing at a reload. */}
        <p className="text-xs text-ink-5">{t('login.sent-spam-hint')}</p>
        <div className="flex gap-3 text-xs">
          <button type="button" onClick={() => send(email)} className="text-ink-3 underline underline-offset-2">
            {t('login.resend')}
          </button>
          <button
            type="button"
            onClick={() => { setStatus('idle'); setError(null); }}
            className="text-ink-3 underline underline-offset-2"
          >
            {t('login.change-email')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {callbackError && !error && (
        <div className="rounded border border-clay/30 bg-clay-wash p-3 text-sm text-ink-2">
          {t('login.link-failed')}
        </div>
      )}
      <input
        type="email"
        required
        autoComplete="email"
        placeholder={t('login.email-placeholder')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded bg-surface border border-line-2 px-3 py-2 text-sm text-ink outline-none focus:border-ink-4"
        disabled={status === 'sending'}
      />
      <button
        type="submit"
        disabled={status === 'sending'}
        className="w-full rounded bg-ink text-paper py-2 text-sm font-medium disabled:opacity-50"
      >
        {status === 'sending' ? t('login.sending') : t('login.send-button')}
      </button>
      {error && (
        <div className="text-sm text-clay">{error}</div>
      )}
    </form>
  );
}

export default function LoginPage() {
  const t = useT();
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper text-ink px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-2">LaunchPad</h1>
        <p className="text-sm text-ink-4 mb-6">
          {t('login.subtitle')}
        </p>
        <Suspense fallback={<div className="text-sm text-ink-5">{t('common.loading')}</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}

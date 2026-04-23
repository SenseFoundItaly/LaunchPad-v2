'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/auth/supabase-browser';

export default function LoginPage() {
  const search = useSearchParams();
  const nextPath = search.get('next') || '/';
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    setError(null);
    const supabase = getSupabaseBrowser();
    const redirectTo = `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(nextPath)}`;
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });
    if (err) {
      setStatus('error');
      setError(err.message);
    } else {
      setStatus('sent');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-2">LaunchPad</h1>
        <p className="text-sm text-neutral-400 mb-6">
          Sign in with a magic link. We&apos;ll email you a one-time login.
        </p>

        {status === 'sent' ? (
          <div className="rounded border border-emerald-800 bg-emerald-950/50 p-4 text-sm">
            Check <span className="font-medium">{email}</span> — we sent a login link.
            Open it on this device to finish signing in.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm outline-none focus:border-neutral-600"
              disabled={status === 'sending'}
            />
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full rounded bg-neutral-100 text-neutral-900 py-2 text-sm font-medium disabled:opacity-50"
            >
              {status === 'sending' ? 'Sending...' : 'Email me a login link'}
            </button>
            {error && (
              <div className="text-sm text-red-400">{error}</div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

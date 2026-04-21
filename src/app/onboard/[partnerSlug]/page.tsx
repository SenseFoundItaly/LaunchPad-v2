'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PartnerConfig } from '@/types';

interface PartnerResponse {
  success: boolean;
  data: PartnerConfig | null;
  error?: string;
}

interface CreateProjectResponse {
  success: boolean;
  data?: { project_id: string; name: string };
  error?: string;
}

export default function PartnerOnboardingPage({
  params,
}: {
  params: Promise<{ partnerSlug: string }>;
}) {
  const { partnerSlug } = use(params);
  const router = useRouter();
  const [partner, setPartner] = useState<PartnerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/partner-configs/${partnerSlug}`);
        const body: PartnerResponse = await res.json();
        if (body.success && body.data) {
          setPartner(body.data);
        }
      } catch {
        // Unknown partner — fall through to generic onboarding
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [partnerSlug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          partner_slug: partnerSlug,
          locale: partner?.locale || 'en',
        }),
      });
      const body: CreateProjectResponse = await res.json();
      if (!body.success || !body.data) throw new Error(body.error || 'Creazione progetto fallita');
      router.push(`/project/${body.data.project_id}/brief`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const brand = (partner?.brand || {}) as Record<string, unknown>;
  const primary = typeof brand.primary === 'string' ? brand.primary : '#2563eb';
  const partnerName = partner?.display_name || prettifySlug(partnerSlug);
  const locale = partner?.locale || 'en';

  if (loading) {
    return <div className="h-screen flex items-center justify-center text-zinc-500 text-sm">Caricamento…</div>;
  }

  const copy = locale === 'it' ? COPY_IT : COPY_EN;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-lg">
        <header className="mb-8 text-center">
          <div
            className="inline-block px-4 py-1.5 rounded-full text-xs uppercase tracking-widest mb-4"
            style={{ backgroundColor: `${primary}20`, color: primary, border: `1px solid ${primary}40` }}
          >
            {partnerName}
          </div>
          <h1 className="text-3xl font-semibold text-zinc-100 mb-3">{copy.title}</h1>
          <p className="text-zinc-400 leading-relaxed">
            {copy.subtitle(partnerName)}
          </p>
        </header>

        {!partner && (
          <div className="mb-6 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">
            {copy.unknownPartner}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">
              {copy.nameLabel}
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={copy.namePlaceholder}
              required
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">
              {copy.descLabel}
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={copy.descPlaceholder}
              rows={3}
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600 resize-none"
            />
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-500">
            <div className="mb-1 text-zinc-400">{copy.languageLabel}</div>
            <div>{locale === 'it' ? 'Italiano' : 'English'} · {copy.languageNote(partnerName)}</div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="w-full py-3 rounded-lg text-white font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: primary }}
          >
            {submitting ? copy.submitting : copy.submit}
          </button>
        </form>

        <footer className="mt-8 text-center text-xs text-zinc-600">
          {copy.footer}
        </footer>
      </div>
    </div>
  );
}

const COPY_EN = {
  title: 'Start your Startup OS',
  subtitle: (p: string) => `You're onboarding via ${p}. Your co-founder is about to start running the weekly cadence — Monday Briefs, ecosystem scans, draft work for your approval.`,
  nameLabel: 'Project name',
  namePlaceholder: 'e.g. Acme SaaS',
  descLabel: 'One-liner (optional)',
  descPlaceholder: 'What are you building, in one sentence?',
  languageLabel: 'Language',
  languageNote: (p: string) => `preconfigured by ${p}. You can change this later in settings.`,
  unknownPartner: 'This partner slug is not configured yet. You can still create a project — you\'ll just miss the partner-specific knowledge seed and branding.',
  submit: 'Create project & open Monday Brief',
  submitting: 'Creating…',
  footer: 'Next step: you\'ll land on your Monday Brief. The first scan takes 1-2 minutes.',
};

const COPY_IT = {
  title: 'Avvia il tuo Startup OS',
  subtitle: (p: string) => `Stai facendo onboarding via ${p}. Il tuo co-founder sta per iniziare la cadenza settimanale — Monday Brief, scan dell'ecosistema, bozze di lavoro per la tua approvazione.`,
  nameLabel: 'Nome del progetto',
  namePlaceholder: 'es. Acme SaaS',
  descLabel: 'One-liner (opzionale)',
  descPlaceholder: 'Cosa stai costruendo, in una frase?',
  languageLabel: 'Lingua',
  languageNote: (p: string) => `preconfigurata da ${p}. Puoi cambiarla più tardi nelle impostazioni.`,
  unknownPartner: 'Questo partner slug non è ancora configurato. Puoi comunque creare un progetto — perderai solo il knowledge seed specifico del partner e il branding.',
  submit: 'Crea progetto & apri il Monday Brief',
  submitting: 'Creazione…',
  footer: 'Prossimo passo: atterrerai sul tuo Monday Brief. Il primo scan richiede 1-2 minuti.',
};

function prettifySlug(slug: string): string {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

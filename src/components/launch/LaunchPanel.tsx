'use client';

/**
 * LaunchPanel (launch pipeline W5) — the read/act surface for the growth lane:
 * published assets, campaigns (activate/pause), and growth loops — the FIRST
 * UI consumer of the growth_loops/growth_iterations engine.
 *
 * Mounted on /project/[projectId]/launch. When PR #218 (Build Hub) merges,
 * mount this same component inside BuildHub's Growth lane tab (one line).
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useT } from '@/components/providers/LocaleProvider';
import { Icon, I } from '@/components/design/primitives';

// ── shared bits ──────────────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-l)', overflow: 'hidden' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ink-3)' }}>{title}</h2>
        {hint && <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>{hint}</span>}
      </header>
      <div style={{ padding: '4px 16px 12px' }}>{children}</div>
    </section>
  );
}

function EmptyHint({ text, href, cta }: { text: string; href?: string; cta?: string }) {
  return (
    <p style={{ margin: '10px 0 4px', fontSize: 12, color: 'var(--ink-4)' }}>
      {text}{' '}
      {href && cta && <a href={href} style={{ color: 'var(--accent-ink)' }}>{cta}</a>}
    </p>
  );
}

const statusColor: Record<string, string> = {
  draft: 'var(--ink-4)', active: 'var(--moss)', paused: 'var(--accent)',
  completed: 'var(--ink-3)', sent: 'var(--moss)', proposed: 'var(--accent)',
  skipped: 'var(--ink-5)', failed: 'var(--clay)', archived: 'var(--ink-5)',
};

function StatusPill({ value }: { value: string }) {
  const c = statusColor[value] ?? 'var(--ink-4)';
  return (
    <span className="lp-mono" style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 0.4, color: c, border: `1px solid ${c}`, borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' }}>
      {value}
    </span>
  );
}

// ── published assets ─────────────────────────────────────────────────────────

interface AssetRow { id: string; slug: string; url: string | null; publisher: string | null; watch_source_id: string | null; published_at: string; metadata: Record<string, unknown> | null }

function PublishedAssetsPanel({ projectId }: { projectId: string }) {
  const t = useT();
  const { data: assets } = useQuery<AssetRow[]>({
    queryKey: ['launch-assets', projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/launch/assets`);
      return ((await res.json())?.data ?? []) as AssetRow[];
    },
  });
  return (
    <Section title={t('launch.assets-title')} hint={t('launch.assets-hint')}>
      {(assets ?? []).length === 0 && (
        <EmptyHint text={t('launch.assets-empty')} href={`/project/${projectId}/chat?skill=build-landing-page`} cta={t('launch.assets-empty-cta')} />
      )}
      {(assets ?? []).map((a) => {
        const live = a.url && /^https?:\/\//.test(a.url);
        const signups = a.metadata && typeof a.metadata.signups === 'number' ? a.metadata.signups : null;
        return (
          <div key={a.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <span style={{ fontSize: 12.5, color: 'var(--ink-1)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {String(a.metadata?.title ?? a.slug)}
            </span>
            {signups !== null && <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{t('launch.signups', { count: signups })}</span>}
            {a.watch_source_id && <span className="lp-mono" style={{ fontSize: 10, color: 'var(--moss)' }}>{t('launch.watched')}</span>}
            <StatusPill value={a.publisher ?? 'stub'} />
            {live ? (
              <a href={a.url!} target="_blank" rel="noopener noreferrer" className="lp-mono" style={{ fontSize: 10, color: 'var(--accent-ink)' }}>
                {t('launch.live')}
              </a>
            ) : (
              <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>{t('launch.recorded')}</span>
            )}
          </div>
        );
      })}
    </Section>
  );
}

// ── campaigns ────────────────────────────────────────────────────────────────

interface CampaignListRow { id: string; kind: string; title: string; status: string; message_count: number; sent_count: number }

function ActivateModal({ projectId, campaign, onClose }: { projectId: string; campaign: CampaignListRow; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [recipientsText, setRecipientsText] = useState('');
  const needsRecipients = campaign.kind === 'email_sequence';
  const activate = useMutation({
    mutationFn: async () => {
      const recipients = recipientsText.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      const res = await fetch(`/api/projects/${projectId}/campaigns/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'activate', config: needsRecipients ? { recipients } : {} }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) throw new Error(body?.error || `HTTP ${res.status}`);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['campaigns', projectId] }); onClose(); },
  });
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-l)', padding: 20, width: 440, maxWidth: '90vw' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 14, color: 'var(--ink-1)' }}>{t('launch.activate-title', { title: campaign.title })}</h3>
        <p style={{ margin: '0 0 10px', fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.5 }}>{t('launch.activate-note')}</p>
        {needsRecipients && (
          <textarea
            value={recipientsText}
            onChange={(e) => setRecipientsText(e.target.value)}
            placeholder={t('launch.recipients-placeholder')}
            rows={5}
            style={{ width: '100%', fontSize: 12, fontFamily: 'var(--f-mono)', border: '1px solid var(--line)', borderRadius: 6, padding: 8, background: 'var(--paper)', color: 'var(--ink-1)', resize: 'vertical' }}
          />
        )}
        {activate.isError && <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--clay)' }}>{(activate.error as Error)?.message}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onClose} style={{ fontSize: 11, padding: '5px 12px', border: '1px solid var(--line)', background: 'transparent', borderRadius: 5, cursor: 'pointer', color: 'var(--ink-3)' }}>
            {t('common.cancel')}
          </button>
          <button
            onClick={() => activate.mutate()}
            disabled={activate.isPending || (needsRecipients && !recipientsText.trim())}
            style={{ fontSize: 11, padding: '5px 12px', border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', borderRadius: 5, cursor: 'pointer' }}
          >
            {activate.isPending ? t('launch.activating') : t('launch.activate')}
          </button>
        </div>
      </div>
    </div>
  );
}

function CampaignsPanel({ projectId }: { projectId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [activating, setActivating] = useState<CampaignListRow | null>(null);
  const { data: campaigns } = useQuery<CampaignListRow[]>({
    queryKey: ['campaigns', projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/campaigns`);
      return ((await res.json())?.data ?? []) as CampaignListRow[];
    },
  });
  const pause = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/projects/${projectId}/campaigns/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'pause' }),
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['campaigns', projectId] }),
  });
  const KIND_KEY: Record<string, string> = { email_sequence: 'launch.kind-email', social_calendar: 'launch.kind-social', ad_pack: 'launch.kind-adpack' };
  return (
    <Section title={t('launch.campaigns-title')} hint={t('launch.campaigns-hint')}>
      {(campaigns ?? []).length === 0 && (
        <EmptyHint text={t('launch.campaigns-empty')} href={`/project/${projectId}/chat?skill=email-sequence`} cta={t('launch.campaigns-empty-cta')} />
      )}
      {(campaigns ?? []).map((c) => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
          <span className="lp-mono" style={{ fontSize: 9.5, color: 'var(--ink-5)', whiteSpace: 'nowrap' }}>
            {t((KIND_KEY[c.kind] ?? 'launch.kind-adpack') as Parameters<typeof t>[0])}
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--ink-1)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
          {c.kind !== 'ad_pack' && (
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{c.sent_count}/{c.message_count}</span>
          )}
          <StatusPill value={c.status} />
          {c.status === 'draft' && c.kind !== 'ad_pack' && (
            <button onClick={() => setActivating(c)} style={{ fontSize: 10.5, padding: '3px 9px', border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', borderRadius: 5, cursor: 'pointer' }}>
              {t('launch.activate')}
            </button>
          )}
          {c.status === 'active' && (
            <button onClick={() => pause.mutate(c.id)} style={{ fontSize: 10.5, padding: '3px 9px', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink-3)', borderRadius: 5, cursor: 'pointer' }}>
              {t('launch.pause')}
            </button>
          )}
        </div>
      ))}
      {activating && <ActivateModal projectId={projectId} campaign={activating} onClose={() => setActivating(null)} />}
    </Section>
  );
}

// ── growth loops (first UI consumer of the growth engine) ────────────────────

interface LoopRow { id: string; metric_name: string; optimization_target: string; status: string; baseline_value: number | null; current_best_value: number | null }

function GrowthLoopsPanel({ projectId }: { projectId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: loops } = useQuery<LoopRow[]>({
    queryKey: ['growth-loops', projectId],
    queryFn: async () => {
      const res = await fetch(`/api/growth/${projectId}/loops`);
      const body = await res.json();
      return (body?.data ?? body ?? []) as LoopRow[];
    },
  });
  const iterate = useMutation({
    mutationFn: async (loopId: string) => {
      const res = await fetch(`/api/growth/${projectId}/loops/${loopId}/iterate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const body = await res.json();
      if (!res.ok || body?.success === false) throw new Error(body?.error || `HTTP ${res.status}`);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['growth-loops', projectId] }),
  });
  return (
    <Section title={t('launch.loops-title')} hint={t('launch.loops-hint')}>
      {(loops ?? []).length === 0 && (
        <EmptyHint text={t('launch.loops-empty')} href={`/project/${projectId}/chat?skill=growth-optimization`} cta={t('launch.loops-empty-cta')} />
      )}
      {(loops ?? []).map((l) => (
        <div key={l.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink-1)', flex: 1, minWidth: 0 }}>{l.metric_name}</span>
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
            {l.baseline_value ?? '—'} → {l.current_best_value ?? '—'}
          </span>
          <StatusPill value={l.status} />
          {l.status === 'active' && (
            <button
              onClick={() => iterate.mutate(l.id)}
              disabled={iterate.isPending}
              title={t('launch.iterate-hint')}
              style={{ fontSize: 10.5, padding: '3px 9px', border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent-ink)', borderRadius: 5, cursor: 'pointer' }}
            >
              {iterate.isPending ? '…' : t('launch.iterate')}
            </button>
          )}
        </div>
      ))}
      {iterate.isError && <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--clay)' }}>{(iterate.error as Error)?.message}</p>}
    </Section>
  );
}

// ── panel ─────────────────────────────────────────────────────────────────────

export function LaunchPanel({ projectId }: { projectId: string }) {
  const t = useT();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon d={I.signal} size={12} stroke={1.4} />
        {t('launch.intro')}
      </p>
      <PublishedAssetsPanel projectId={projectId} />
      <CampaignsPanel projectId={projectId} />
      <GrowthLoopsPanel projectId={projectId} />
    </div>
  );
}

export default LaunchPanel;

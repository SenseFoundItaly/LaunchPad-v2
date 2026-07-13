'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/components/providers/LocaleProvider';
import type { ActiveBuilder, BuildDiffShape, ClientBuild } from './types';
import { primaryBtn, secondaryBtn } from './BuildHub';

export default function CurrentBuildCard({
  build,
  activeBuilder,
  busy,
  onIterate,
  onSetLiveUrl,
  onRegenerate,
}: {
  build: ClientBuild;
  activeBuilder: ActiveBuilder | null;
  busy: boolean;
  onIterate: (message: string) => void;
  onSetLiveUrl: (url: string) => void;
  onRegenerate: () => void;
}) {
  const t = useT();
  const [message, setMessage] = useState('');
  const [liveUrl, setLiveUrl] = useState(build.live_app_url ?? '');
  const [nonce, setNonce] = useState(0); // bump to force-reload the iframe
  const [frameErr, setFrameErr] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const building = build.status === 'building';
  const failed = build.status === 'failed';
  const canIterate = (activeBuilder?.supports_iteration ?? false) && !building;
  const diff = (build.metadata?.diff ?? undefined) as BuildDiffShape | undefined;

  // Tick an elapsed counter while building so the wait feels active, not frozen.
  useEffect(() => {
    if (!building) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [building]);
  const elapsed = Math.max(0, Math.floor((now - new Date(build.created_at).getTime()) / 1000));
  const dots = '.'.repeat((elapsed % 3) + 1);

  // A fresh preview URL means the token/version changed — clear any prior frame error.
  useEffect(() => setFrameErr(false), [build.preview_url]);

  return (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={badge}>
          {t('build.iteration')} {build.iteration}
        </span>
        <span style={statusBadge(build.status)}>{building ? t('build.building.title').replace('…', '') : build.status}</span>
        {/* White-label: never surface the underlying builder (v0/e2b/…) to the founder. */}
      </div>

      <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--ink-4)' }}>{t('build.preview')}</div>

      {building && !build.preview_url ? (
        // Building, no preview yet → live progress panel (v0 builds ~1–2 min).
        <div style={progressPanel}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
            {t('build.building.title')} {dots}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 6 }}>
            {elapsed}s
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 12, maxWidth: 380, textAlign: 'center', lineHeight: 1.5 }}>
            {t('build.building.hint')}
          </div>
        </div>
      ) : build.preview_url ? (
        <div>
          {building && (
            <div style={buildingBanner}>
              {t('build.building.title')} {dots} ({elapsed}s)
            </div>
          )}
          <iframe
            key={`${build.preview_url}-${nonce}`}
            title={t('build.preview')}
            src={build.preview_url}
            sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            onError={() => setFrameErr(true)}
            style={iframeStyle}
          />
          <div style={{ display: 'flex', gap: 14, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={linkBtn} onClick={() => { setNonce((n) => n + 1); setFrameErr(false); }}>
              ↻ {t('build.preview.reload')}
            </button>
            {/* No "open in new tab" for the preview — the builder's preview URL is
                the one v0/e2b-branded surface, so we keep it inside our iframe only.
                The shareable link is the deployed live app (deploy()), not the preview. */}
            {frameErr && <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{t('build.preview.blocked')}</span>}
          </div>
        </div>
      ) : (
        <div style={previewEmpty}>
          {failed
            ? String((build.metadata as Record<string, unknown> | null)?.error ?? 'Build failed')
            : t('build.preview.none')}
        </div>
      )}

      {build.live_app_url && (
        // Neutral label — never print the raw host (could be *.vercel.app / vendor).
        <a href={build.live_app_url} target="_blank" rel="noreferrer" style={{ ...linkA, display: 'inline-block', marginTop: 6 }}>
          {t('build.liveApp.open')} ↗
        </a>
      )}

      {diff?.files?.length ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 6 }}>{t('build.changes')}</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--ink)' }}>
            {diff.files.slice(0, 12).map((f, i) => (
              <li key={i}>
                <code style={{ fontSize: 12 }}>{f.path}</code> <span style={{ color: 'var(--ink-4)' }}>({f.change})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Iterate box — the two-way loop; disabled while a build is in flight. */}
      {canIterate && (
        <div style={{ marginTop: 16 }}>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('build.iterate.placeholder')}
            rows={2}
            style={textarea}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              style={primaryBtn}
              disabled={busy || !message.trim()}
              onClick={() => { onIterate(message.trim()); setMessage(''); }}
            >
              {busy ? t('build.iterating') : t('build.iterate.button')}
            </button>
            <button style={secondaryBtn} disabled={busy} onClick={onRegenerate}>
              {t('build.generate')}
            </button>
          </div>
        </div>
      )}
      {building && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-4)' }}>
          {t('build.building.title')} {dots}
        </div>
      )}

      {/* Live app URL capture — feeds monitoring + the next iteration's feedback. */}
      <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={liveUrl}
          onChange={(e) => setLiveUrl(e.target.value)}
          placeholder={t('build.liveUrl.label')}
          style={input}
        />
        <button style={secondaryBtn} disabled={busy || !liveUrl.trim()} onClick={() => onSetLiveUrl(liveUrl.trim())}>
          {t('build.liveUrl.save')}
        </button>
      </div>
    </section>
  );
}

const card: React.CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 12,
  padding: 18,
  background: 'var(--paper-2)',
  marginBottom: 18,
};

const badge: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  padding: '3px 10px',
  borderRadius: 6,
  background: 'var(--surface, rgba(255,255,255,0.05))',
  color: 'var(--ink)',
  border: '1px solid var(--line)',
};

function statusBadge(status: string): React.CSSProperties {
  const live = status === 'live';
  const failed = status === 'failed';
  return {
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 999,
    background: 'transparent',
    border: '1px solid var(--line)',
    color: live ? 'var(--moss, #6bbf7b)' : failed ? 'var(--cat-rose, #d98a95)' : 'var(--ink-4)',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  };
}

const iframeStyle: React.CSSProperties = {
  width: '100%',
  height: 440,
  border: '1px solid var(--line)',
  borderRadius: 10,
  background: 'var(--paper)',
};

const progressPanel: React.CSSProperties = {
  width: '100%',
  height: 300,
  border: '1px solid var(--line)',
  borderRadius: 10,
  background: 'var(--paper)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
};

const buildingBanner: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--ink-4)',
  padding: '6px 10px',
  marginBottom: 6,
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'var(--surface, rgba(255,255,255,0.04))',
};

const linkBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--sky, #6aa7ff)',
  fontSize: 12,
  cursor: 'pointer',
  padding: 0,
};

const linkA: React.CSSProperties = { fontSize: 12, color: 'var(--sky, #6aa7ff)' };

const previewEmpty: React.CSSProperties = {
  width: '100%',
  minHeight: 120,
  border: '1px dashed var(--line)',
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--ink-4)',
  fontSize: 13,
  padding: 16,
  textAlign: 'center',
};

const textarea: React.CSSProperties = {
  width: '100%',
  resize: 'vertical',
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  padding: 10,
  fontSize: 13,
  fontFamily: 'inherit',
};

const input: React.CSSProperties = {
  flex: 1,
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  padding: '8px 10px',
  fontSize: 13,
};

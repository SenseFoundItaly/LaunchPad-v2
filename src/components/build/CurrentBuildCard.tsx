'use client';

import { useState } from 'react';
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

  const diff = (build.metadata?.diff ?? undefined) as BuildDiffShape | undefined;
  const canIterate = activeBuilder?.supports_iteration ?? false;

  return (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={badge}>
          {t('build.iteration')} {build.iteration}
        </span>
        <span style={statusBadge(build.status)}>{build.status}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-4)' }}>{build.builder}</span>
      </div>

      {/* Live preview — the founder watches the built app without leaving LaunchPad.
          sandbox scopes the embedded app; real app URLs may set frame-ancestors,
          in which case we fall back to an "open in new tab" link. */}
      <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--ink-4)' }}>{t('build.preview')}</div>
      {build.preview_url ? (
        <iframe
          title="MVP preview"
          src={build.preview_url}
          sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
          style={{
            width: '100%',
            height: 440,
            border: '1px solid var(--line)',
            borderRadius: 10,
            background: 'var(--paper)',
          }}
        />
      ) : (
        <div style={{ ...previewEmpty }}>{t('build.preview.none')}</div>
      )}
      {build.live_app_url && (
        <a href={build.live_app_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--sky, #6aa7ff)' }}>
          {build.live_app_url} ↗
        </a>
      )}

      {/* Change list from the last iteration's diff. */}
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

      {/* Iterate box — the two-way loop: describe a change, the driver applies it. */}
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
              onClick={() => {
                onIterate(message.trim());
                setMessage('');
              }}
            >
              {busy ? t('build.iterating') : t('build.iterate.button')}
            </button>
            <button style={secondaryBtn} disabled={busy} onClick={onRegenerate}>
              {t('build.generate')}
            </button>
          </div>
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
  return {
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 999,
    background: 'transparent',
    border: '1px solid var(--line)',
    color: live ? 'var(--moss, #6bbf7b)' : 'var(--ink-4)',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  };
}

const previewEmpty: React.CSSProperties = {
  width: '100%',
  height: 200,
  border: '1px dashed var(--line)',
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--ink-4)',
  fontSize: 13,
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

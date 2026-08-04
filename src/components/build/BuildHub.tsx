'use client';

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/components/providers/LocaleProvider';
import type { ActiveBuilder, ClientBuild, ClientFeedback } from './types';
import CurrentBuildCard from './CurrentBuildCard';
import IterationTimeline from './IterationTimeline';
import BuildFeedback from './BuildFeedback';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } : init?.headers,
  });
  const jsonBody = await res.json().catch(() => null);
  if (!res.ok || !jsonBody?.success) {
    throw new Error(jsonBody?.error || `Request failed (${res.status})`);
  }
  return jsonBody.data as T;
}

export default function BuildHub({ projectId }: { projectId: string }) {
  const t = useT();
  const [builds, setBuilds] = useState<ClientBuild[]>([]);
  const [feedback, setFeedback] = useState<ClientFeedback[]>([]);
  const [activeBuilder, setActiveBuilder] = useState<ActiveBuilder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [buildsRes, fb] = await Promise.all([
        api<{ builds: ClientBuild[]; active_builder: ActiveBuilder }>(`/api/projects/${projectId}/builds`),
        api<ClientFeedback[]>(`/api/projects/${projectId}/build-feedback`),
      ]);
      setBuilds(buildsRes.builds);
      setActiveBuilder(buildsRes.active_builder);
      setFeedback(fb);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const withBusy = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setErr(null);
      try {
        await fn();
        await refresh();
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  // Update a single build in place (used by the poll loop).
  const updateBuild = useCallback((b: ClientBuild) => {
    setBuilds((prev) => prev.map((x) => (x.id === b.id ? b : x)));
  }, []);

  // Poll the latest build to completion while it's 'building' (async drivers like
  // v0 build for 1–2 min). Each poll hits GET /builds/[id] → refreshBuild → driver
  // getStatus, advancing building → live/failed and refreshing the preview URL.
  const curId = builds[0]?.id;
  const curStatus = builds[0]?.status;
  useEffect(() => {
    if (!curId || curStatus !== 'building') return;
    let stop = false;
    const tick = async () => {
      try {
        const b = await api<ClientBuild>(`/api/projects/${projectId}/builds/${curId}`);
        if (stop) return;
        updateBuild(b);
        if (b.status !== 'building') void refresh(); // sync supersede + feedback state
      } catch {
        /* transient poll error (e.g. v0 propagation) — retry next tick */
      }
    };
    const iv = setInterval(tick, 4000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [curId, curStatus, projectId, updateBuild, refresh]);

  const current = builds[0] ?? null; // listed iteration DESC → [0] is latest

  const generate = () =>
    withBusy(() => api(`/api/projects/${projectId}/builds`, { method: 'POST', body: '{}' }));

  const iterate = (message: string) =>
    withBusy(() =>
      api(`/api/projects/${projectId}/builds/${current!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'iterate', message }),
      }),
    );

  const setLiveUrl = (url: string) =>
    withBusy(() =>
      api(`/api/projects/${projectId}/builds/${current!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ live_app_url: url }),
      }),
    );

  const publish = () =>
    withBusy(() =>
      api(`/api/projects/${projectId}/builds/${current!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'publish' }),
      }),
    );

  const addFeedback = (text: string) =>
    withBusy(() =>
      api(`/api/projects/${projectId}/build-feedback`, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      }),
    );

  return (
    <div style={{ padding: 24, maxWidth: 920, margin: '0 auto', width: '100%' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)', margin: 0 }}>{t('build.title')}</h1>
        <p style={{ color: 'var(--ink-4)', margin: '6px 0 0', fontSize: 14 }}>{t('build.subtitle')}</p>
      </header>

      {/* Lane tabs — Product active; Growth (Ploy) reserved for a later phase. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <span style={pill(true)}>{t('build.lane.product')}</span>
        <span style={{ ...pill(false), opacity: 0.5 }} title={t('build.lane.growth.soon')}>
          {t('build.lane.growth')}
        </span>
      </div>

      {err && (
        <div
          style={{
            background: 'var(--cat-rose, #3a1720)',
            border: '1px solid var(--line)',
            color: 'var(--ink)',
            borderRadius: 8,
            padding: '8px 12px',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {err}
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--ink-4)' }}>…</p>
      ) : !current ? (
        <div
          style={{
            border: '1px dashed var(--line)',
            borderRadius: 12,
            padding: 32,
            textAlign: 'center',
            background: 'var(--paper-2)',
          }}
        >
          <p style={{ color: 'var(--ink-4)', margin: '0 0 16px' }}>{t('build.empty')}</p>
          <button style={primaryBtn} disabled={busy} onClick={generate}>
            {busy ? t('build.generating') : t('build.generate')}
          </button>
        </div>
      ) : (
        <>
          <CurrentBuildCard
            build={current}
            activeBuilder={activeBuilder}
            busy={busy}
            onIterate={iterate}
            onSetLiveUrl={setLiveUrl}
            onRegenerate={generate}
            onPublish={publish}
          />
          <BuildFeedback feedback={feedback} busy={busy} onAdd={addFeedback} />
          <IterationTimeline builds={builds} />
        </>
      )}
    </div>
  );
}

function pill(active: boolean): React.CSSProperties {
  return {
    fontSize: 13,
    padding: '4px 12px',
    borderRadius: 999,
    border: '1px solid var(--line)',
    background: active ? 'var(--ink)' : 'transparent',
    color: active ? 'var(--paper)' : 'var(--ink-4)',
  };
}

export const primaryBtn: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  borderRadius: 8,
  padding: '9px 16px',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

export const secondaryBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
};

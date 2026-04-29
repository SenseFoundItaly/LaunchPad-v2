'use client';

import { useState } from 'react';
import { Pill, Icon, I, IconBtn, type PillKind } from '@/components/design/primitives';
import type { WatchSource } from '@/types';

interface WatchSourceCardProps {
  source: WatchSource & { last_change_at?: string | null; total_changes?: number };
  projectId: string;
  onRefresh: () => void;
}

const STATUS_PILL: Record<string, PillKind> = {
  active: 'ok',
  paused: 'n',
  error: 'warn',
};

export function WatchSourceCard({ source, projectId, onRefresh }: WatchSourceCardProps) {
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<string | null>(null);

  async function handleScrapeNow() {
    setScraping(true);
    setScrapeResult(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/watch-sources/${source.id}/scrape`,
        { method: 'POST' },
      );
      const body = await res.json();
      if (body.success) {
        const d = body.data;
        setScrapeResult(`${d.change_status} · ${d.significance || ''}`);
        onRefresh();
      } else {
        setScrapeResult(`error: ${body.error}`);
      }
    } catch (err) {
      setScrapeResult(`failed: ${(err as Error).message}`);
    } finally {
      setScraping(false);
    }
  }

  async function handleTogglePause() {
    const newStatus = source.status === 'active' ? 'paused' : 'active';
    try {
      await fetch(`/api/projects/${projectId}/watch-sources/${source.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      onRefresh();
    } catch {
      // silent
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete watch source "${source.label}"?`)) return;
    try {
      await fetch(`/api/projects/${projectId}/watch-sources/${source.id}`, {
        method: 'DELETE',
      });
      onRefresh();
    } catch {
      // silent
    }
  }

  return (
    <div
      style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Pill kind={STATUS_PILL[source.status] || 'n'} dot>
          {source.status}
        </Pill>
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase' }}>
          {source.category.replace(/_/g, ' ')}
        </span>
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
          {source.schedule}
        </span>
        <span style={{ flex: 1 }} />
        <IconBtn
          d={I.play}
          title="Scrape now"
          size={24}
          onClick={handleScrapeNow}
          style={scraping ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
        />
        <IconBtn
          d={source.status === 'active' ? I.pause : I.play}
          title={source.status === 'active' ? 'Pause' : 'Resume'}
          size={24}
          onClick={handleTogglePause}
        />
        <IconBtn
          d={I.x}
          title="Delete"
          size={24}
          onClick={handleDelete}
        />
      </div>

      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-1)' }}>
        {source.label}
      </div>

      <div style={{ fontSize: 11, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <Icon d={I.link} size={10} style={{ marginRight: 4 }} />
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit', textDecoration: 'none' }}
        >
          {source.url}
        </a>
      </div>

      <div style={{ display: 'flex', gap: 16, fontSize: 10, color: 'var(--ink-5)' }}>
        <span>{source.total_changes ?? 0} changes detected</span>
        {source.last_scraped_at && (
          <span>last scraped: {formatTimeAgo(source.last_scraped_at)}</span>
        )}
        {source.error_message && (
          <span style={{ color: 'var(--clay)' }}>{source.error_message}</span>
        )}
      </div>

      {scrapeResult && (
        <div className="lp-mono" style={{ fontSize: 10, color: 'var(--accent-ink)', padding: '4px 0' }}>
          {scraping ? 'scraping...' : scrapeResult}
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch {
    return '—';
  }
}

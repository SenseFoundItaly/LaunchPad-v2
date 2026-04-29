'use client';

import { MetricTile } from '@/components/design/primitives';

interface SummaryStripProps {
  activeSources: number;
  changesThisWeek: number;
  highSignals: number;
  lastChecked: string | null;
}

export function SummaryStrip({
  activeSources,
  changesThisWeek,
  highSignals,
  lastChecked,
}: SummaryStripProps) {
  const lastCheckedLabel = lastChecked
    ? formatTimeAgo(lastChecked)
    : 'never';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
      <MetricTile
        label="Active sources"
        value={String(activeSources)}
        kind="n"
      />
      <MetricTile
        label="Changes this week"
        value={String(changesThisWeek)}
        kind={changesThisWeek > 0 ? 'ok' : 'n'}
      />
      <MetricTile
        label="High signals"
        value={String(highSignals)}
        kind={highSignals > 0 ? 'warn' : 'n'}
      />
      <MetricTile
        label="Last checked"
        value={lastCheckedLabel}
        kind="n"
      />
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
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  } catch {
    return '—';
  }
}

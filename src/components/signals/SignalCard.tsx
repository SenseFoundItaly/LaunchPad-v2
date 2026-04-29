'use client';

import { Pill, Icon, I, type PillKind } from '@/components/design/primitives';
import type { SignalTimelineEntry, SignalSignificance } from '@/types';
import { DiffPreview } from './DiffPreview';

interface SignalCardProps {
  signal: SignalTimelineEntry;
}

const SIGNIFICANCE_PILL: Record<SignalSignificance, PillKind> = {
  high: 'warn',
  medium: 'info',
  low: 'n',
  noise: 'n',
};

const SIGNIFICANCE_BORDER: Record<SignalSignificance, string> = {
  high: 'var(--clay)',
  medium: 'var(--sky)',
  low: 'var(--ink-5)',
  noise: 'var(--line-2)',
};

export function SignalCard({ signal }: SignalCardProps) {
  return (
    <div
      style={{
        padding: '12px 14px',
        borderLeft: `3px solid ${SIGNIFICANCE_BORDER[signal.significance]}`,
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Pill kind={SIGNIFICANCE_PILL[signal.significance]} dot>
          {signal.significance}
        </Pill>
        <Pill kind="n">
          {signal.type === 'ecosystem_alert' ? 'monitor' : 'watch'}
        </Pill>
        {signal.alert_type && (
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase' }}>
            {signal.alert_type.replace(/_/g, ' ')}
          </span>
        )}
        {signal.change_status && signal.change_status !== 'same' && (
          <Pill kind={signal.change_status === 'new' ? 'ok' : signal.change_status === 'removed' ? 'warn' : 'info'}>
            {signal.change_status}
          </Pill>
        )}
        <span style={{ flex: 1 }} />
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
          {formatTime(signal.timestamp)}
        </span>
      </div>

      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-1)', lineHeight: 1.4 }}>
        {signal.headline}
      </div>

      {signal.body && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, maxHeight: 60, overflow: 'hidden' }}>
          {signal.body}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--ink-4)' }}>
        <Icon d={I.globe} size={11} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {signal.source_label}
        </span>
        {signal.source_url && (
          <a
            href={signal.source_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent-ink)', textDecoration: 'none', fontSize: 11 }}
          >
            <Icon d={I.external} size={10} />
          </a>
        )}
      </div>

      {signal.diff_preview && (
        <DiffPreview diff={signal.diff_preview} collapsed />
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffH < 24) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

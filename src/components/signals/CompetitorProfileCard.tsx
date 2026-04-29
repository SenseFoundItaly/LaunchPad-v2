'use client';

import { Pill, Icon, I } from '@/components/design/primitives';
import type { CompetitorProfile, TrendDirection } from '@/types';

interface CompetitorProfileCardProps {
  profile: CompetitorProfile;
  projectId: string;
}

const TREND_DISPLAY: Record<TrendDirection, { label: string; arrow: string; kind: 'ok' | 'warn' | 'info' | 'n' }> = {
  expanding: { label: 'expanding', arrow: '\u2197', kind: 'warn' },
  stable: { label: 'stable', arrow: '\u2192', kind: 'n' },
  contracting: { label: 'contracting', arrow: '\u2198', kind: 'ok' },
  pivoting: { label: 'pivoting', arrow: '\u21BB', kind: 'info' },
};

const SIGNAL_TYPE_COLORS: Record<string, string> = {
  competitor_activity: 'var(--clay)',
  hiring_signal: 'var(--moss)',
  customer_sentiment: 'var(--sky)',
  social_signal: 'var(--plum)',
  ip_filing: 'var(--ink-3)',
  trend_signal: 'var(--ink-4)',
  partnership_opportunity: 'var(--sky)',
  regulatory_change: 'var(--clay)',
  funding_event: 'var(--moss)',
};

export function CompetitorProfileCard({ profile, projectId }: CompetitorProfileCardProps) {
  const trend = TREND_DISPLAY[profile.trend_direction] || TREND_DISPLAY.stable;
  const counts = profile.signal_counts || {};
  const totalBar = profile.total_signals || 1;

  // Sort signal types by count desc for the mini-bar
  const sortedTypes = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  return (
    <div
      style={{
        padding: '12px 14px',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: 'var(--ink)',
            color: 'var(--paper)',
            fontSize: 10,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--f-mono)',
            flexShrink: 0,
          }}
        >
          {profile.name.slice(0, 2).toUpperCase()}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-1)' }}>
            {profile.name}
          </div>
        </div>
        <Pill kind={trend.kind} dot>
          {trend.arrow} {trend.label}
        </Pill>
      </div>

      {/* Signal count mini-bar */}
      {sortedTypes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            style={{
              display: 'flex',
              height: 4,
              borderRadius: 2,
              overflow: 'hidden',
              background: 'var(--line-2)',
            }}
          >
            {sortedTypes.map(([type, count]) => (
              <div
                key={type}
                style={{
                  width: `${(count / totalBar) * 100}%`,
                  background: SIGNAL_TYPE_COLORS[type] || 'var(--ink-5)',
                  minWidth: 2,
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--ink-5)', flexWrap: 'wrap' }}>
            {sortedTypes.slice(0, 4).map(([type, count]) => (
              <span key={type} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 2,
                    background: SIGNAL_TYPE_COLORS[type] || 'var(--ink-5)',
                    flexShrink: 0,
                  }}
                />
                {type.replace(/_/g, ' ')} ({count})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--ink-4)' }}>
        <span>{profile.total_signals} total signal{profile.total_signals === 1 ? '' : 's'}</span>
        {profile.last_activity_at && (
          <>
            <span style={{ color: 'var(--line-2)' }}>|</span>
            <span>last activity {formatTimeAgo(profile.last_activity_at)}</span>
          </>
        )}
      </div>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

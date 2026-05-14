'use client';

import { Pill } from '@/components/design/primitives';
import type { PillKind } from '@/components/design/primitives';
import type { SignalTimelineEntry, EcosystemAlertState } from '@/types';

export type SortField = 'timestamp' | 'impact';
export type SortDir = 'asc' | 'desc';

interface SignalsTableProps {
  signals: SignalTimelineEntry[];
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  competitorNames: string[];
  onTriageAlert?: (alertId: string, state: 'acknowledged' | 'dismissed' | 'promoted_to_action') => void;
}

// Impact thresholds from relevance_score
type ImpactLevel = 'critical' | 'notable' | 'normal' | 'informational';

function getImpact(signal: SignalTimelineEntry): { level: ImpactLevel; score: number } {
  // For ecosystem_alerts with relevance_score
  if (signal.relevance_score != null) {
    const s = signal.relevance_score;
    if (s >= 0.9) return { level: 'critical', score: s };
    if (s >= 0.7) return { level: 'notable', score: s };
    if (s >= 0.4) return { level: 'normal', score: s };
    return { level: 'informational', score: s };
  }
  // For source_changes: map significance → impact
  const sigMap: Record<string, ImpactLevel> = {
    high: 'critical',
    medium: 'notable',
    low: 'normal',
    noise: 'informational',
  };
  const scoreMap: Record<string, number> = { high: 0.95, medium: 0.75, low: 0.5, noise: 0.2 };
  return {
    level: sigMap[signal.significance] || 'normal',
    score: scoreMap[signal.significance] || 0.5,
  };
}

const IMPACT_CONFIG: Record<ImpactLevel, { pill: PillKind; border: string; label: string }> = {
  critical:      { pill: 'warn', border: 'var(--clay)',   label: 'Critical' },
  notable:       { pill: 'info', border: 'var(--sky)',    label: 'Notable' },
  normal:        { pill: 'n',    border: 'var(--ink-5)',  label: 'Normal' },
  informational: { pill: 'n',    border: 'var(--line-2)', label: 'Info' },
};

function matchCompetitor(signal: SignalTimelineEntry, names: string[]): string | null {
  const text = `${signal.headline} ${signal.source_label || ''}`.toLowerCase();
  for (const name of names) {
    if (text.includes(name.toLowerCase())) return name;
  }
  return null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffH = diffMs / 3600000;
  if (diffH < 1) return `${Math.max(1, Math.floor(diffMs / 60000))}m ago`;
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function platformLabel(signal: SignalTimelineEntry): string {
  if (signal.type === 'source_change') return 'Watch';
  if (signal.alert_type) {
    return signal.alert_type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .slice(0, 16);
  }
  return 'Monitor';
}

export function SignalsTable({ signals, sortField, sortDir, onSort, competitorNames, onTriageAlert }: SignalsTableProps) {
  const headerStyle: React.CSSProperties = {
    position: 'sticky',
    top: 0,
    background: 'var(--paper-2)',
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: 'var(--ink-4)',
    fontFamily: 'var(--f-mono)',
    padding: '8px 10px',
    borderBottom: '1px solid var(--line)',
    whiteSpace: 'nowrap',
  };

  const sortableHeader = (field: SortField, label: string, width: number | string) => (
    <th
      style={{ ...headerStyle, width, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onSort(field)}
    >
      {label}
      {sortField === field && (
        <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
      )}
    </th>
  );

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12,
          fontFamily: 'var(--f-sans)',
        }}
      >
        <thead>
          <tr>
            {sortableHeader('timestamp', 'Date', 90)}
            <th style={{ ...headerStyle, width: 130 }}>Competitor</th>
            <th style={{ ...headerStyle, width: 110 }}>Platform</th>
            <th style={{ ...headerStyle }}>Signal</th>
            {sortableHeader('impact', 'Impact', 90)}
            <th style={{ ...headerStyle, width: 140 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {signals.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                style={{ padding: 40, textAlign: 'center', color: 'var(--ink-5)', fontSize: 12 }}
              >
                No signals match the current filters.
              </td>
            </tr>
          ) : (
            signals.map((s) => {
              const impact = getImpact(s);
              const cfg = IMPACT_CONFIG[impact.level];
              const comp = matchCompetitor(s, competitorNames);

              return (
                <tr
                  key={s.id}
                  style={{
                    borderLeft: `3px solid ${cfg.border}`,
                    borderBottom: '1px solid var(--line)',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.background = 'var(--paper-2)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.background = 'transparent';
                  }}
                >
                  {/* Date */}
                  <td style={{ padding: '10px 10px', whiteSpace: 'nowrap', color: 'var(--ink-4)', fontSize: 11 }}>
                    {formatDate(s.timestamp)}
                  </td>

                  {/* Competitor */}
                  <td style={{ padding: '10px 10px', fontSize: 12 }}>
                    {comp ? (
                      <span style={{ fontWeight: 500 }}>{comp}</span>
                    ) : (
                      <span style={{ color: 'var(--ink-5)' }}>&mdash;</span>
                    )}
                  </td>

                  {/* Platform */}
                  <td style={{ padding: '10px 10px' }}>
                    <Pill kind={s.type === 'source_change' ? 'info' : 'n'}>
                      {platformLabel(s)}
                    </Pill>
                  </td>

                  {/* Signal */}
                  <td style={{ padding: '10px 10px', maxWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.headline}
                    </div>
                    {s.body && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--ink-4)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          marginTop: 2,
                        }}
                      >
                        {s.body}
                      </div>
                    )}
                  </td>

                  {/* Impact */}
                  <td style={{ padding: '10px 10px' }}>
                    <Pill kind={cfg.pill}>{cfg.label}</Pill>
                  </td>

                  {/* Status / Triage */}
                  <td style={{ padding: '10px 10px' }}>
                    {s.type === 'ecosystem_alert' ? (
                      <TriageCell
                        reviewedState={s.reviewed_state ?? 'pending'}
                        onTriage={onTriageAlert ? (state) => onTriageAlert(s.id, state) : undefined}
                      />
                    ) : (
                      <span style={{ color: 'var(--ink-5)' }}>&mdash;</span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Triage cell for ecosystem_alert rows ──

const triageBtnBase: React.CSSProperties = {
  all: 'unset',
  cursor: 'pointer',
  fontSize: 10,
  fontWeight: 600,
  borderRadius: 9999,
  padding: '2px 8px',
  whiteSpace: 'nowrap',
  lineHeight: '18px',
  transition: 'opacity 0.15s',
};

function TriageCell({
  reviewedState,
  onTriage,
}: {
  reviewedState: EcosystemAlertState;
  onTriage?: (state: 'acknowledged' | 'dismissed' | 'promoted_to_action') => void;
}) {
  if (reviewedState === 'acknowledged') {
    return <Pill kind="n">Seen</Pill>;
  }
  if (reviewedState === 'promoted_to_action') {
    return <Pill kind="ok">Promoted</Pill>;
  }
  if (reviewedState === 'dismissed') {
    return <span style={{ color: 'var(--ink-5)', fontSize: 11 }}>Dismissed</span>;
  }
  // pending — show action buttons
  if (!onTriage) return null;
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <button
        style={{ ...triageBtnBase, background: 'var(--ink-5)', color: 'var(--paper)' }}
        onClick={() => onTriage('acknowledged')}
        title="Acknowledge — mark as seen"
      >
        Ack
      </button>
      <button
        style={{ ...triageBtnBase, background: 'var(--line-2)', color: 'var(--ink-3)' }}
        onClick={() => onTriage('dismissed')}
        title="Dismiss — remove from feed"
      >
        Dismiss
      </button>
      <button
        style={{
          ...triageBtnBase,
          background: 'rgba(74, 222, 128, 0.15)',
          color: 'rgb(74, 222, 128)',
        }}
        onClick={() => onTriage('promoted_to_action')}
        title="Promote to action item"
      >
        Promote
      </button>
    </div>
  );
}

// Export for use in page-level filtering
export { getImpact, matchCompetitor };
export type { ImpactLevel };

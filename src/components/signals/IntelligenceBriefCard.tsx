'use client';

import { Pill, Icon, I } from '@/components/design/primitives';
import type { IntelligenceBrief } from '@/types';

interface IntelligenceBriefCardProps {
  brief: IntelligenceBrief;
}

const CONFIDENCE_KIND: Record<string, 'ok' | 'info' | 'warn' | 'n'> = {
  high: 'ok',
  medium: 'info',
  low: 'n',
};

function confidenceLabel(c: number): { label: string; kind: 'ok' | 'info' | 'warn' | 'n' } {
  if (c >= 0.8) return { label: 'high confidence', kind: 'ok' };
  if (c >= 0.5) return { label: 'medium confidence', kind: 'info' };
  return { label: 'low confidence', kind: 'n' };
}

export function IntelligenceBriefCard({ brief }: IntelligenceBriefCardProps) {
  const conf = confidenceLabel(brief.confidence);
  const actions = brief.recommended_actions || [];

  return (
    <div
      style={{
        padding: '14px 16px',
        borderBottom: '1px solid var(--line)',
        borderLeft: '3px solid var(--sky)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Pill kind={conf.kind} dot>
          {conf.label}
        </Pill>
        {brief.entity_name && (
          <Pill kind="n">
            {brief.entity_name}
          </Pill>
        )}
        {brief.temporal_prediction && (
          <span
            className="lp-mono"
            style={{
              fontSize: 10,
              color: 'var(--plum)',
              background: 'oklch(0.95 0.02 310)',
              padding: '2px 8px',
              borderRadius: 999,
            }}
          >
            {brief.temporal_prediction}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
          {brief.signal_count} signal{brief.signal_count === 1 ? '' : 's'}
        </span>
      </div>

      {/* Title */}
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-1)', lineHeight: 1.4 }}>
        {brief.title}
      </div>

      {/* Narrative */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--ink-3)',
          lineHeight: 1.5,
          maxHeight: 72,
          overflow: 'hidden',
        }}
      >
        {brief.narrative}
      </div>

      {/* Recommended actions */}
      {actions.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-4)' }}>
          <Icon d={I.flag} size={10} />
          <span>{actions.length} action{actions.length === 1 ? '' : 's'}</span>
          {actions[0] && (
            <>
              <span style={{ color: 'var(--line-2)' }}>|</span>
              <span style={{ color: 'var(--ink-3)' }}>
                {actions[0].action.slice(0, 60)}{actions[0].action.length > 60 ? '…' : ''}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

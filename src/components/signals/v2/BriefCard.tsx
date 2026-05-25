'use client';

import { Pill, Icon, I } from '@/components/design/primitives';
import { DepthChip } from './DepthChip';
import { EvidenceMeter } from './EvidenceMeter';

interface BriefCardProps {
  title: string;
  narrative: string;
  temporal_prediction: string | null;
  entity_name: string | null;
  confidence: number;
  evidence_count: number;
  sources_consulted: number;
  recommended_actions: unknown[];
  created_at: string;
}

/**
 * The top-of-page card. This is what the founder came for: a synthesized
 * narrative grounded in N signals + M sources, with an explicit prediction
 * and a "do this next" recommendation.
 *
 * Old UI showed `narrative` as a row in the feed alongside raw alerts —
 * which hid the very thing that makes briefs valuable. Here briefs are
 * first-class: full prose visible, prediction called out, evidence meter
 * adjacent to confidence.
 */
export function BriefCard({
  title,
  narrative,
  temporal_prediction,
  entity_name,
  confidence,
  evidence_count,
  sources_consulted,
  recommended_actions,
  created_at,
}: BriefCardProps) {
  const ageHours = (Date.now() - new Date(created_at).getTime()) / 3_600_000;
  const isFresh = ageHours < 24;
  const topAction =
    Array.isArray(recommended_actions) && recommended_actions.length > 0
      ? (recommended_actions[0] as { title?: string; description?: string })
      : null;

  return (
    <article
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-l)',
        padding: '14px 16px',
        marginBottom: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        boxShadow: isFresh ? '0 0 0 1px var(--accent-wash)' : 'none',
      }}
    >
      {/* Header row: depth chip + entity + age */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <DepthChip depth="deep" />
        {entity_name && (
          <Pill kind="warn" dot={false}>
            {entity_name}
          </Pill>
        )}
        {isFresh && <Pill kind="live" dot>fresh</Pill>}
        <div style={{ flex: 1 }} />
        <span className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>
          {humanAge(created_at)}
        </span>
      </div>

      {/* Title */}
      <h3
        className="lp-serif"
        style={{
          margin: 0,
          fontSize: 17,
          fontWeight: 500,
          letterSpacing: -0.2,
          lineHeight: 1.25,
          color: 'var(--ink)',
        }}
      >
        {title}
      </h3>

      {/* Narrative */}
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)' }}>
        {narrative}
      </p>

      {/* Prediction — the thing nothing else surfaces */}
      {temporal_prediction && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '8px 10px',
            background: 'var(--paper-2)',
            borderLeft: '2px solid var(--accent)',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--ink-2)',
          }}
        >
          <Icon d={I.sparkles} size={12} stroke={1.4} style={{ color: 'var(--accent)', marginTop: 1, flexShrink: 0 }} />
          <span>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 6 }}>
              Prediction
            </span>
            {temporal_prediction}
          </span>
        </div>
      )}

      {/* Recommended action */}
      {topAction?.title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '8px 10px',
            background: 'var(--paper-2)',
            borderLeft: '2px solid var(--moss)',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--ink-2)',
          }}
        >
          <Icon d={I.arrow} size={12} stroke={1.4} style={{ color: 'var(--moss)', marginTop: 1, flexShrink: 0 }} />
          <span>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 6 }}>
              Do next
            </span>
            <strong style={{ fontWeight: 600 }}>{topAction.title}</strong>
            {topAction.description && (
              <span style={{ color: 'var(--ink-4)' }}> · {topAction.description}</span>
            )}
          </span>
        </div>
      )}

      {/* Footer: evidence meter */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
        <EvidenceMeter
          sources={sources_consulted}
          signals={evidence_count}
          confidence={confidence}
        />
      </div>
    </article>
  );
}

function humanAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

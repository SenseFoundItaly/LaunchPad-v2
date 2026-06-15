'use client';

import { Pill, Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey, TranslateVars } from '@/lib/i18n/messages';
import { DepthChip } from './DepthChip';
import { EvidenceMeter } from './EvidenceMeter';

/**
 * Input shape — the union of fields the card actually reads. Accepts both:
 *   - The bare IntelligenceBrief (from /api/projects/.../intelligence-briefs);
 *     `evidence_count` falls back to `signal_count`, `sources_consulted` to 0.
 *   - The richer TimelineBrief from /api/projects/.../timeline, which carries
 *     a pre-computed `sources_consulted` and `evidence_count`.
 *
 * One object prop keeps call sites short and immune to field-addition churn.
 */
export interface BriefCardInput {
  title: string;
  narrative: string;
  temporal_prediction: string | null;
  entity_name: string | null;
  confidence: number;
  recommended_actions: unknown[];
  created_at: string;
  /** Signals folded into this brief — falls back to `signal_count` if absent. */
  evidence_count?: number;
  signal_count?: number;
  /** Distinct source URLs across cited signals — defaults to 0 when not computed. */
  sources_consulted?: number;
}

interface BriefCardProps {
  brief: BriefCardInput;
}

/**
 * The top-of-page card. Synthesized narrative grounded in N signals + M sources,
 * with explicit prediction and "do this next" recommendation. First-class
 * surface — full prose, prediction called out, evidence meter footer.
 */
export function BriefCard({ brief }: BriefCardProps) {
  const t = useT();
  const {
    title,
    narrative,
    temporal_prediction,
    entity_name,
    confidence,
    recommended_actions,
    created_at,
    signal_count,
  } = brief;
  const evidence_count = brief.evidence_count ?? signal_count ?? 0;
  const sources_consulted = brief.sources_consulted ?? 0;
  const ageHours = (Date.now() - new Date(created_at).getTime()) / 3_600_000;
  const isFresh = ageHours < 24;
  const topAction =
    Array.isArray(recommended_actions) && recommended_actions.length > 0
      ? (recommended_actions[0] as { title?: string; description?: string; action?: string; rationale?: string })
      : null;
  // IntelligenceBrief shape uses `action`/`rationale`; TimelineBrief shape uses
  // `title`/`description`. Normalize so the callout renders for either.
  const actionTitle = topAction?.title || topAction?.action || null;
  const actionDescription = topAction?.description || topAction?.rationale || null;

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
        {isFresh && <Pill kind="live" dot>{t('signals.fresh')}</Pill>}
        <div style={{ flex: 1 }} />
        <span className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>
          {humanAge(created_at, t)}
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
              {t('signals.prediction')}
            </span>
            {temporal_prediction}
          </span>
        </div>
      )}

      {/* Recommended action */}
      {actionTitle && (
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
              {t('signals.do-next')}
            </span>
            <strong style={{ fontWeight: 600 }}>{actionTitle}</strong>
            {actionDescription && (
              <span style={{ color: 'var(--ink-4)' }}> · {actionDescription}</span>
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

function humanAge(iso: string, t: (key: MessageKey, vars?: TranslateVars) => string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return t('signals.age-minutes', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('signals.age-hours', { count: h });
  return t('signals.age-days', { count: Math.floor(h / 24) });
}

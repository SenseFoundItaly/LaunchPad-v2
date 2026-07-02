'use client';

/**
 * FindingCard — the finding/knowledge card language from the target design,
 * rendered in SenseFound tokens.
 *
 * A "finding" is something the co-pilot surfaces that can be Applied to Project
 * Knowledge (grounding), Edited, or Rejected. Confidence + tags are OPTIONAL —
 * they're hidden when the backing data doesn't carry them (e.g. knowledge
 * suggestions have no confidence/tags), so the card degrades cleanly rather
 * than faking a score.
 */

import * as React from 'react';
import { Icon, I } from '@/components/design/icons';

export interface FindingSource {
  label: string;
  url?: string;
}
export type FindingState = 'pending' | 'applied' | 'rejected';

export interface FindingCardProps {
  type: string;
  title: string;
  body: string;
  /** 0..1 — omitted/null hides the confidence bar. */
  confidence?: number | null;
  tags?: string[];
  source?: string | FindingSource;
  state?: FindingState;
  applyLabel?: string;
  onApply?: () => void;
  onEdit?: () => void;
  onReject?: () => void;
  onUndo?: () => void;
}

function confColor(c: number): string {
  // green → gold → terracotta, all brand tokens (no foreign red).
  return c > 0.8 ? 'var(--moss)' : c > 0.6 ? 'var(--cat-gold)' : 'var(--clay)';
}

export function FindingCard({
  type,
  title,
  body,
  confidence,
  tags = [],
  source,
  state = 'pending',
  applyLabel = 'Apply to Project Knowledge',
  onApply,
  onEdit,
  onReject,
  onUndo,
}: FindingCardProps) {
  const src = typeof source === 'string' ? { label: source } : source;
  const hasConf = typeof confidence === 'number' && !Number.isNaN(confidence);

  const bg =
    state === 'applied'
      ? 'color-mix(in oklch, var(--moss) 7%, var(--surface))'
      : state === 'rejected'
        ? 'color-mix(in oklch, var(--clay) 6%, var(--surface))'
        : 'var(--surface)';
  const borderColor =
    state === 'applied'
      ? 'color-mix(in oklch, var(--moss) 40%, var(--line))'
      : state === 'rejected'
        ? 'color-mix(in oklch, var(--clay) 32%, var(--line))'
        : 'var(--line-2)';

  return (
    <div
      style={{
        padding: 12,
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: 'var(--r-l)',
        opacity: state === 'rejected' ? 0.6 : 1,
      }}
    >
      {/* Header: kind label + confidence */}
      <div className="lp-row" style={{ marginBottom: 6 }}>
        <span
          className="lp-mono"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: 0.5 }}
        >
          <Icon d={I.sparkles} size={11} style={{ color: 'var(--accent)' }} /> Finding · {type}
        </span>
        <span style={{ flex: 1 }} />
        {hasConf && (
          <>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
              confidence {Math.round(confidence! * 100)}%
            </span>
            <div style={{ width: 30, height: 3, background: 'var(--line-2)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(confidence! * 100)}%`, height: '100%', background: confColor(confidence!) }} />
            </div>
          </>
        )}
      </div>

      <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.1, color: 'var(--ink)', lineHeight: 1.3 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 4 }}>{body}</div>

      {tags.length > 0 && (
        <div className="lp-row" style={{ gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
          {tags.map((t) => (
            <span
              key={t}
              className="lp-mono"
              style={{ padding: '2px 7px', borderRadius: 'var(--r-s)', background: 'var(--paper-2)', color: 'var(--ink-4)', fontSize: 10.5, border: '1px solid var(--line)' }}
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {src && (
        <div className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon d={I.link} size={10} />
          {src.url ? (
            <a href={src.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink-4)', textDecoration: 'none' }}>
              {src.label}
            </a>
          ) : (
            src.label
          )}
        </div>
      )}

      {/* Actions */}
      <div className="lp-row" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)', gap: 6 }}>
        {state === 'pending' && (
          <>
            <button className="lp-btn lp-btn-ok" onClick={onApply}>
              <Icon d={I.check} size={11} /> {applyLabel}
            </button>
            {onEdit && (
              <button className="lp-btn lp-btn-ghost" onClick={onEdit}>
                <Icon d={I.edit} size={11} /> Edit &amp; apply
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button className="lp-btn lp-btn-bad" onClick={onReject}>
              <Icon d={I.x} size={11} /> Reject
            </button>
          </>
        )}
        {state === 'applied' && (
          <>
            <span className="lp-row" style={{ gap: 5, fontSize: 11.5, color: 'var(--moss)', fontWeight: 600 }}>
              <Icon d={I.check} size={11} /> Applied to Project Knowledge
            </span>
            <span style={{ flex: 1 }} />
            {onUndo && (
              <button className="lp-btn lp-btn-ghost" onClick={onUndo}>
                <Icon d={I.history} size={11} /> Undo
              </button>
            )}
          </>
        )}
        {state === 'rejected' && (
          <>
            <span className="lp-row" style={{ gap: 5, fontSize: 11.5, color: 'var(--clay)', fontWeight: 600 }}>
              <Icon d={I.x} size={11} /> Rejected
            </span>
            <span style={{ flex: 1 }} />
            {onUndo && (
              <button className="lp-btn lp-btn-ghost" onClick={onUndo}>
                <Icon d={I.history} size={11} /> Restore
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

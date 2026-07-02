'use client';

/**
 * KnowledgeRow — a curated Project-Knowledge entry (applied). Tone dot + type +
 * title/body + attribute key/vals + source + applied time + optional pin.
 * Used by the curated ProjectKnowledge view.
 */

import * as React from 'react';
import { Icon, I } from '@/components/design/icons';

export type KnowledgeTone = 'ok' | 'warn' | 'info' | 'plum' | 'accent' | 'n';

const TONE_VAR: Record<KnowledgeTone, string> = {
  ok: 'var(--moss)',
  warn: 'var(--clay)',
  info: 'var(--sky)',
  plum: 'var(--plum)',
  accent: 'var(--accent)',
  n: 'var(--ink-5)',
};

export interface KnowledgeRowProps {
  tone?: KnowledgeTone;
  type: string;
  title: string;
  body?: string;
  attrs?: { k: string; v: string }[];
  source?: string;
  appliedAt?: string;
  pinned?: boolean;
  onPin?: () => void;
  onMore?: () => void;
}

export function KnowledgeRow({ tone = 'n', type, title, body, attrs = [], source, appliedAt, pinned, onPin, onMore }: KnowledgeRowProps) {
  return (
    <div style={{ padding: 14, borderBottom: '1px solid var(--line)' }}>
      <div className="lp-row" style={{ marginBottom: 4 }}>
        <span className="lp-dot" style={{ background: TONE_VAR[tone], width: 7, height: 7 }} />
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{type}</span>
        {pinned && (
          <button
            onClick={onPin}
            title="Pinned"
            style={{ display: 'inline-flex', background: 'transparent', border: 'none', cursor: onPin ? 'pointer' : 'default', color: 'var(--accent)', padding: 0 }}
          >
            <Icon d={I.flag} size={10} />
          </button>
        )}
        <span style={{ flex: 1 }} />
        {appliedAt && <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>applied {appliedAt}</span>}
        {onMore && (
          <button onClick={onMore} title="More" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', padding: 0, display: 'inline-flex' }}>
            <Icon d={I.more} size={12} />
          </button>
        )}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.1, color: 'var(--ink)' }}>{title}</div>
      {body && <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 3 }}>{body}</div>}
      {(attrs.length > 0 || source) && (
        <div className="lp-row" style={{ marginTop: 7, gap: 6, flexWrap: 'wrap' }}>
          {attrs.map(({ k, v }) => (
            <span key={k} className="lp-mono" style={{ fontSize: 10.5 }}>
              <span style={{ color: 'var(--ink-5)' }}>{k}</span> <span style={{ color: 'var(--ink-2)' }}>{v}</span>
            </span>
          ))}
          <span style={{ flex: 1 }} />
          {source && (
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon d={I.link} size={9} /> {source}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * NewsTable — dense coverage table for the Intelligence competitor view.
 * Backed by real ecosystem_alerts (headline / source / url / date / relevance).
 */

import * as React from 'react';
import { Icon, I } from '@/components/design/icons';
import { Pill, type PillKind } from '@/components/design/primitives';

export interface NewsRow {
  id: string;
  date: string;
  source: string;
  headline: string;
  url?: string;
  topic?: string;
  /** 'Notable' | 'Normal' etc. */
  impact?: string;
  impactKind?: PillKind;
}

export function NewsTable({ rows }: { rows: NewsRow[] }) {
  if (rows.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)', fontSize: 12 }}>No coverage yet.</div>;
  }
  const cols = '70px 110px 1fr 110px 84px';
  return (
    <div>
      <div className="lp-mono" style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, fontSize: 9.5, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '6px 4px', borderBottom: '1px solid var(--line)' }}>
        <span>Date</span>
        <span>Source</span>
        <span>Headline</span>
        <span>Topic</span>
        <span style={{ textAlign: 'right' }}>Impact</span>
      </div>
      {rows.map((r) => (
        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, padding: '10px 4px', borderBottom: '1px solid var(--line)', fontSize: 12, alignItems: 'center' }}>
          <span className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{r.date}</span>
          <span style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.source}</span>
          <span style={{ color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.headline}</span>
            {r.url && (
              <a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink-4)', flexShrink: 0, display: 'inline-flex' }} title="Open source">
                <Icon d={I.external} size={11} />
              </a>
            )}
          </span>
          <span>{r.topic && <Pill kind="n">{r.topic}</Pill>}</span>
          <span style={{ textAlign: 'right' }}>{r.impact && <Pill kind={r.impactKind ?? 'n'} dot>{r.impact}</Pill>}</span>
        </div>
      ))}
    </div>
  );
}

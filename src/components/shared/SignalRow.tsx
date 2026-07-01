'use client';

/**
 * SignalRow — a dense row in the All-signals feed. Backed by signal activity /
 * ecosystem_alerts (date / entity / platform / signal text / impact).
 */

import * as React from 'react';
import { Pill, type PillKind } from '@/components/design/primitives';

export interface SignalRowData {
  id: string;
  date: string;
  entity: string;
  platform?: string;
  signal: string;
  impact?: string;
  impactKind?: PillKind;
}

export const SIGNAL_COLS = '70px 130px 80px 1fr 74px';

export function SignalHeader() {
  return (
    <div className="lp-mono" style={{ display: 'grid', gridTemplateColumns: SIGNAL_COLS, gap: 12, fontSize: 9.5, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 4px', borderBottom: '1px solid var(--line)' }}>
      <span>Date</span>
      <span>Entity</span>
      <span>Platform</span>
      <span>Signal</span>
      <span style={{ textAlign: 'right' }}>Impact</span>
    </div>
  );
}

export function SignalRow({ row }: { row: SignalRowData }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: SIGNAL_COLS, gap: 12, padding: '12px 4px', borderBottom: '1px solid var(--line)', fontSize: 12, alignItems: 'flex-start' }}>
      <span className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{row.date}</span>
      <span style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.entity}</span>
      <span style={{ color: 'var(--ink-4)' }}>{row.platform}</span>
      <span style={{ color: 'var(--ink)', lineHeight: 1.5 }}>{row.signal}</span>
      <span style={{ textAlign: 'right' }}>{row.impact && <Pill kind={row.impactKind ?? 'n'} dot>{row.impact}</Pill>}</span>
    </div>
  );
}

'use client';

/**
 * BuildVersionsSidebar — the Build surface's right rail: grounding count (real,
 * from Project Knowledge) + version history. Versions are illustrative until a
 * build-artifact version read endpoint exists — clearly labelled as such.
 */

import * as React from 'react';
import { Icon, I } from '@/components/design/icons';

export interface BuildVersion {
  id: string;
  label: string;
  meta: string;
  current?: boolean;
}

export function BuildVersionsSidebar({ groundingCount, versions }: { groundingCount: number; versions: BuildVersion[] }) {
  return (
    <div className="lp-scroll" style={{ width: 260, flexShrink: 0, borderLeft: '1px solid var(--line)', background: 'var(--paper)', overflow: 'auto', padding: 16 }}>
      <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Grounding</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, marginBottom: 16 }}>
        Generations are grounded in <b style={{ color: 'var(--ink)' }}>{groundingCount}</b> {groundingCount === 1 ? 'entry' : 'entries'} from Project Knowledge.
      </div>

      <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        Versions <span style={{ color: 'var(--ink-5)', textTransform: 'none', letterSpacing: 0 }}>· sample</span>
      </div>
      {versions.map((v) => (
        <div key={v.id} className="lp-row" style={{ padding: '7px 8px', borderRadius: 'var(--r-s)', background: v.current ? 'var(--surface)' : 'transparent', boxShadow: v.current ? 'inset 0 0 0 1px var(--line)' : 'none', fontSize: 12, marginBottom: 1 }}>
          <Icon d={I.layers} size={11} style={{ color: 'var(--ink-4)' }} />
          <span style={{ flex: 1, color: v.current ? 'var(--ink)' : 'var(--ink-2)' }}>{v.label}</span>
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{v.meta}</span>
        </div>
      ))}
    </div>
  );
}

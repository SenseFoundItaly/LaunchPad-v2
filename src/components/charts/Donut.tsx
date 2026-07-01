'use client';

/**
 * Donut — pure-SVG segmented donut with legend, brand-token palette.
 * Used on the Intelligence competitor view for distribution breakdowns.
 * NOTE: seeded from signal-category counts, which is a decorative proxy for
 * "publication distribution" — pass `sample` to label it as such.
 */

import * as React from 'react';

export interface DonutSegment {
  label: string;
  value: number;
  color?: string;
}

const PALETTE = ['var(--cat-teal)', 'var(--cat-gold)', 'var(--plum)', 'var(--sky)', 'var(--moss)', 'var(--cat-rose)'];

export function Donut({ segments, size = 150, sample }: { segments: DonutSegment[]; size?: number; sample?: boolean }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const R = 28;
  const r = 16;
  let acc = 0;
  return (
    <div className="lp-row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
      <div style={{ fontSize: 11.5, color: 'var(--ink-2)', flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {segments.map((s, i) => (
          <div key={s.label} className="lp-row" style={{ gap: 8 }}>
            <span className="lp-dot" style={{ background: s.color ?? PALETTE[i % PALETTE.length], width: 9, height: 9 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{s.value}</span>
          </div>
        ))}
        {sample && <div className="lp-mono" style={{ fontSize: 9.5, color: 'var(--ink-5)', marginTop: 2 }}>· sample data</div>}
      </div>
      <svg viewBox="-32 -32 64 64" style={{ width: size, height: size, flexShrink: 0 }} role="img" aria-label="distribution donut">
        {segments.map((s, i) => {
          const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
          acc += s.value;
          const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
          const large = end - start > Math.PI ? 1 : 0;
          const path = `M ${Math.cos(start) * R} ${Math.sin(start) * R} A ${R} ${R} 0 ${large} 1 ${Math.cos(end) * R} ${Math.sin(end) * R} L ${Math.cos(end) * r} ${Math.sin(end) * r} A ${r} ${r} 0 ${large} 0 ${Math.cos(start) * r} ${Math.sin(start) * r} Z`;
          return <path key={s.label} d={path} fill={s.color ?? PALETTE[i % PALETTE.length]} />;
        })}
      </svg>
    </div>
  );
}

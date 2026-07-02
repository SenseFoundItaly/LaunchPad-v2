'use client';

/**
 * CoverageTimeline — pure-SVG line of daily coverage/activity counts.
 * There's no dedicated per-day coverage series yet; callers bucket signal
 * activity by day or pass sample data. Pass `sample` to label it.
 */

import * as React from 'react';

export interface CoveragePoint {
  date: string;
  count: number;
}

export function CoverageTimeline({ series, height = 180, sample }: { series: CoveragePoint[]; height?: number; sample?: boolean }) {
  if (series.length < 2) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-4)', fontSize: 12 }}>Not enough data.</div>;
  }
  const max = Math.max(...series.map((s) => s.count), 1);
  const pts = series.map((s, i) => `${(i / (series.length - 1)) * 100},${30 - (s.count / max) * 26 - 2}`).join(' ');
  const dots = series.map((s, i) => [(i / (series.length - 1)) * 100, 30 - (s.count / max) * 26 - 2] as const);
  // ~8 evenly spaced x-axis labels.
  const step = Math.max(1, Math.ceil(series.length / 8));
  const labels = series.filter((_, i) => i % step === 0);
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" style={{ width: '100%', height }}>
        {[0, 7.5, 15, 22.5].map((y) => (
          <line key={y} x1={0} y1={y} x2={100} y2={y} stroke="var(--line)" strokeWidth="0.15" strokeDasharray=".5 .5" />
        ))}
        <polyline points={pts} fill="none" stroke="var(--ink-3)" strokeWidth="0.35" vectorEffect="non-scaling-stroke" />
        {dots.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="0.6" fill="var(--ink)" stroke="var(--surface)" strokeWidth="0.2" />
        ))}
      </svg>
      <div className="lp-row" style={{ justifyContent: 'space-between', padding: '0 6px', marginTop: -6, fontSize: 9.5, fontFamily: 'var(--f-mono)', color: 'var(--ink-4)' }}>
        {labels.map((l, i) => (
          <span key={i}>{l.date}</span>
        ))}
      </div>
      {sample && <div className="lp-mono" style={{ fontSize: 9.5, color: 'var(--ink-5)', position: 'absolute', top: 0, right: 6 }}>sample data</div>}
    </div>
  );
}

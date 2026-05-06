/**
 * Design-system primitives — Pill, Panel, MetricTile, IconBtn, StatusBar.
 *
 * Pure presentation. No data fetching. Tokens come from
 * src/styles/design-tokens.css — works without Tailwind.
 */

'use client';

import * as React from 'react';
import { Icon, I } from './icons';

// =============================================================================
// IconBtn — 28px default, accepts style override
// =============================================================================

export interface IconBtnProps {
  d: string;
  title?: string;
  size?: number;
  active?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  'aria-label'?: string;
}

export function IconBtn({ d, title, size = 28, active, onClick, style, ...rest }: IconBtnProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={rest['aria-label'] || title}
      style={{
        width: size,
        height: size,
        border: '1px solid transparent',
        borderRadius: 'var(--r-m)',
        background: active ? 'var(--paper-3)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-3)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background .12s, color .12s',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--paper-2)';
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      <Icon d={d} size={14} />
    </button>
  );
}

// =============================================================================
// Pill — status chip with optional dot
// =============================================================================

export type PillKind = 'live' | 'ok' | 'warn' | 'info' | 'n';

export interface PillProps {
  kind?: PillKind;
  dot?: boolean;
  children: React.ReactNode;
}

export function Pill({ kind = 'n', dot, children }: PillProps) {
  const map: Record<PillKind, { bg: string; fg: string; dot: string }> = {
    live: { bg: 'var(--accent-wash)', fg: 'var(--accent-ink)', dot: 'var(--accent)' },
    ok:   { bg: 'var(--moss-wash)',   fg: 'var(--moss)',       dot: 'var(--moss)' },
    warn: { bg: 'oklch(0.94 0.05 40)', fg: 'var(--clay)',      dot: 'var(--clay)' },
    info: { bg: 'var(--sky-wash)',    fg: 'var(--sky)',        dot: 'var(--sky)' },
    n:    { bg: 'var(--paper-2)',     fg: 'var(--ink-3)',      dot: 'var(--ink-5)' },
  };
  const c = map[kind] || map.n;
  return (
    <span className="lp-chip" style={{ background: c.bg, color: c.fg }}>
      {dot && <span className="lp-dot" style={{ background: c.dot }} />}
      {children}
    </span>
  );
}

// =============================================================================
// Panel — titled card with optional subtitle + right-aligned slot
// =============================================================================

export interface PanelProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function Panel({ title, subtitle, right, children, style }: PanelProps) {
  return (
    <div className="lp-card" style={style}>
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: -0.1 }}>{title}</span>
          {subtitle && <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>{subtitle}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{right}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}

// =============================================================================
// MetricTile — big number + delta + sparkline
// =============================================================================

export interface MetricTileProps {
  label: string;
  value: string;
  delta?: string;
  sparkData?: number[];
  kind?: 'ok' | 'warn' | 'n';
}

export function MetricTile({ label, value, delta, sparkData = [], kind = 'n' }: MetricTileProps) {
  const dcolor = { ok: 'var(--moss)', warn: 'var(--clay)', n: 'var(--ink-4)' }[kind];
  const lineColor = kind === 'ok' ? 'var(--moss)' : kind === 'warn' ? 'var(--clay)' : 'var(--ink-4)';

  let pts = '';
  if (sparkData.length >= 2) {
    const max = Math.max(...sparkData);
    const min = Math.min(...sparkData);
    const range = max - min || 1;
    pts = sparkData
      .map((v, i) => `${(i / (sparkData.length - 1)) * 100},${30 - ((v - min) / range) * 26 - 2}`)
      .join(' ');
  }

  return (
    <div className="lp-card" style={{ padding: '12px 14px 10px' }}>
      <div
        className="lp-mono"
        style={{ fontSize: 10, color: 'var(--ink-5)', letterSpacing: 0.4, textTransform: 'uppercase' }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        <span className="lp-serif" style={{ fontSize: 26, fontWeight: 400, letterSpacing: -0.4 }}>
          {value}
        </span>
        {delta && (
          <span className="lp-mono" style={{ fontSize: 10, color: dcolor }}>
            {delta}
          </span>
        )}
      </div>
      {pts ? (
        <svg
          viewBox="0 0 100 30"
          style={{ width: '100%', height: 30, marginTop: 2 }}
          preserveAspectRatio="none"
        >
          <polyline points={pts} fill="none" stroke={lineColor} strokeWidth="1" />
        </svg>
      ) : (
        <div style={{ height: 30, marginTop: 2 }} />
      )}
    </div>
  );
}

// =============================================================================
// StatusBar — bottom Bloomberg-style bar (heartbeat, gateway, budget, tz)
// =============================================================================

export type HeartbeatKind = 'healthy' | 'stale' | 'dead';

export interface StatusBarProps {
  hints?: React.ReactNode[];
  heartbeatLabel?: string;
  heartbeatKind?: HeartbeatKind;
  gateway?: string;
  ctxLabel?: string;
  budget?: string;
  tz?: string;
}

const HEARTBEAT_DOT: Record<HeartbeatKind, { color: string; pulse: boolean }> = {
  healthy: { color: 'var(--moss)', pulse: true },
  stale: { color: 'var(--clay)', pulse: false },
  dead: { color: 'oklch(0.60 0.14 20)', pulse: false },
};

export function StatusBar({
  hints = [],
  heartbeatLabel = 'heartbeat · idle',
  heartbeatKind = 'healthy',
  gateway,
  ctxLabel,
  budget = 'budget · —',
  tz = 'tz · Europe/Rome',
}: StatusBarProps) {
  const dotStyle = HEARTBEAT_DOT[heartbeatKind] || HEARTBEAT_DOT.healthy;
  return (
    <div
      className="lp-mono"
      style={{
        height: 22,
        flexShrink: 0,
        borderTop: '1px solid var(--line)',
        background: 'var(--paper-2)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 10px',
        gap: 16,
        fontSize: 10,
        color: 'var(--ink-4)',
        letterSpacing: 0,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span
          className={`lp-dot${dotStyle.pulse ? ' lp-pulse' : ''}`}
          style={{ background: dotStyle.color }}
        />
        {heartbeatLabel}
      </span>
      {gateway && <span>{gateway}</span>}
      {ctxLabel && <span>{ctxLabel}</span>}
      <span style={{ flex: 1 }} />
      {hints.map((h, i) => (
        <span key={i} style={{ opacity: 0.8 }}>{h}</span>
      ))}
      <span>{budget}</span>
      <span>{tz}</span>
    </div>
  );
}

// Re-export Icon utilities from icons for convenience
export { Icon, I };

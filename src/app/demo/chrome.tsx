'use client';

/**
 * /demo chrome — DEMO PURPOSES ONLY. The persistent shell shared by every
 * demo page: the demo banner, a path-aware TopBar, a path-aware NavRail
 * replica, and a path-aware StatusBar. Assembled by ./layout.tsx.
 *
 * The rail mirrors the real NavRail (chrome.tsx) exactly — Home / Osservatori
 * / Knowledge / Finanze / Co-pilot — but navigates between /demo/* pages
 * instead of the auth-gated /project/* routes, and doesn't self-fetch counts.
 */

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TopBar } from '@/components/design/chrome';
import { Icon, I, Pill, StatusBar } from '@/components/design/primitives';
import type { IconKey } from '@/components/design/icons';

// -----------------------------------------------------------------------------
// Nav config — one entry per demo page
// -----------------------------------------------------------------------------

type NavEntry = {
  id: string;
  href: string;
  iconKey: IconKey;
  label: string;
  breadcrumb: string;
  badge?: number;
  badgeTone?: 'alert' | 'count';
  streaming?: boolean;
  status: { heartbeatLabel: string; gateway: string; ctxLabel: string };
};

const PRIMARY: NavEntry[] = [
  {
    id: 'home', href: '/demo', iconKey: 'home', label: 'Home', breadcrumb: 'Home',
    status: { heartbeatLabel: 'heartbeat · 3 osservatori attivi', gateway: 'demo · dati simulati', ctxLabel: '4 elementi in Inbox' },
  },
];

const CHANNELS: NavEntry[] = [
  {
    id: 'inbox', href: '/demo/inbox', iconKey: 'tickets', label: 'Osservatori', breadcrumb: 'Osservatori',
    badge: 4, badgeTone: 'alert',
    status: { heartbeatLabel: 'heartbeat · ultima scansione 2 ore fa', gateway: 'demo · dati simulati', ctxLabel: '4 proposte da rivedere' },
  },
  {
    id: 'knowledge', href: '/demo/knowledge', iconKey: 'book', label: 'Knowledge', breadcrumb: 'Knowledge',
    badge: 29, badgeTone: 'count',
    status: { heartbeatLabel: 'heartbeat · grafo aggiornato', gateway: 'demo · dati simulati', ctxLabel: '18 nodi · 24 collegamenti' },
  },
  {
    id: 'financial', href: '/demo/financial', iconKey: 'dollar', label: 'Finanze', breadcrumb: 'Finanze',
    status: { heartbeatLabel: 'heartbeat · modello ricalcolato', gateway: 'demo · dati simulati', ctxLabel: 'runway 14 mesi' },
  },
  {
    id: 'chat', href: '/demo/chat', iconKey: 'chat', label: 'Co-pilot', breadcrumb: 'Co-pilot',
    streaming: true,
    status: { heartbeatLabel: 'heartbeat · co-pilot pronto', gateway: 'demo · dati simulati', ctxLabel: 'build #12 live · 4 campagne' },
  },
];

const ALL = [...PRIMARY, ...CHANNELS];

function entryFor(pathname: string): NavEntry {
  // Longest-prefix match so /demo/inbox beats /demo.
  const hit = ALL
    .filter((e) => pathname === e.href || pathname.startsWith(e.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return hit ?? PRIMARY[0];
}

// -----------------------------------------------------------------------------
// Banner
// -----------------------------------------------------------------------------

export function DemoBanner() {
  return (
    <div
      style={{
        flexShrink: 0, background: 'var(--accent-wash)', borderBottom: '1px solid var(--line)',
        padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--ink-2)',
      }}
    >
      <span className="lp-dot lp-pulse" style={{ background: 'var(--accent)' }} />
      <span style={{ fontWeight: 600 }}>DEMO</span>
      <span style={{ color: 'var(--ink-4)' }}>Visione del prodotto — progetto di esempio, dati simulati</span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// TopBar (wraps the real one, path-aware breadcrumb)
// -----------------------------------------------------------------------------

export function DemoTopBar() {
  const pathname = usePathname() || '/demo';
  const entry = entryFor(pathname);
  return (
    <TopBar
      breadcrumb={['MatchLens', entry.breadcrumb]}
      right={
        <>
          <Pill kind="n">38 crediti</Pill>
          <Pill kind="live" dot>DEMO</Pill>
        </>
      }
    />
  );
}

// -----------------------------------------------------------------------------
// StatusBar (path-aware)
// -----------------------------------------------------------------------------

export function DemoStatusBar() {
  const pathname = usePathname() || '/demo';
  const s = entryFor(pathname).status;
  return (
    <StatusBar
      heartbeatLabel={s.heartbeatLabel}
      heartbeatKind="healthy"
      gateway={s.gateway}
      ctxLabel={s.ctxLabel}
      budget="crediti · 38/50"
      tz="Europe/Rome"
    />
  );
}

// -----------------------------------------------------------------------------
// NavRail (path-aware, Links between demo pages)
// -----------------------------------------------------------------------------

export function DemoNavRail() {
  const pathname = usePathname() || '/demo';
  const active = entryFor(pathname).id;
  return (
    <div
      style={{
        width: 54, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--paper-2)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0', gap: 2,
      }}
    >
      {PRIMARY.map((e) => <RailItem key={e.id} e={e} active={active === e.id} />)}
      <div aria-hidden style={{ width: 28, height: 1, background: 'var(--line)', margin: '6px 0', flexShrink: 0 }} />
      {CHANNELS.map((e) => <RailItem key={e.id} e={e} active={active === e.id} />)}
      <div style={{ flex: 1, minHeight: 6 }} />
      <div
        title="Demo — account di esempio"
        style={{
          flexShrink: 0, width: 28, height: 28, borderRadius: 14, background: 'var(--ink)', color: 'var(--paper)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600,
          fontFamily: 'var(--f-mono)', marginTop: 6,
        }}
      >
        ML
      </div>
    </div>
  );
}

function RailItem({ e, active }: { e: NavEntry; active: boolean }) {
  const isCount = e.badgeTone === 'count';
  return (
    <Link
      href={e.href}
      title={e.label}
      style={{
        width: 42, padding: '8px 0', borderRadius: 'var(--r-m)', cursor: 'pointer',
        background: active ? 'var(--surface)' : 'transparent',
        boxShadow: active ? 'inset 0 0 0 1px var(--line)' : 'none',
        color: active ? 'var(--ink)' : 'var(--ink-4)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        textDecoration: 'none', position: 'relative',
      }}
    >
      <Icon d={I[e.iconKey]} size={15} stroke={1.3} />
      {typeof e.badge === 'number' && e.badge > 0 && (
        <span
          style={{
            position: 'absolute', top: 4, right: 4, minWidth: 14, height: 14, borderRadius: 7,
            background: isCount ? 'var(--paper-3)' : 'var(--clay)',
            color: isCount ? 'var(--ink-4)' : 'var(--on-accent)',
            border: isCount ? '1px solid var(--line)' : 'none',
            boxSizing: 'border-box', fontSize: 9, fontWeight: 700, fontFamily: 'var(--f-mono)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', lineHeight: 1,
          }}
        >
          {e.badge}
        </span>
      )}
      {e.streaming && (
        <span className="lp-dot lp-pulse" style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, background: 'var(--accent)' }} />
      )}
      <span style={{ fontSize: 9, fontFamily: 'var(--f-mono)', letterSpacing: -0.2, textTransform: 'uppercase' }}>
        {e.label}
      </span>
    </Link>
  );
}

// -----------------------------------------------------------------------------
// EcoGraph — static SVG ecosystem graph (startup + typed satellites).
// Reused on Home (small) and Knowledge (large). Replaces the D3 KnowledgeGraph
// with a fixed, deterministic layout so the demo never needs data.
// -----------------------------------------------------------------------------

const ECO_TYPES: Record<string, string> = {
  startup: 'var(--accent)',
  competitor: 'var(--clay)',
  persona: 'var(--cat-teal)',
  partner: 'var(--moss)',
  investor: 'var(--plum)',
};

// The ecosystem satellites (everything but the startup, which sits at center).
// Positions are computed on a staggered ring so adding a node stays balanced.
const ECO_SATELLITES: Array<{ label: string; type: string }> = [
  { label: 'Veo', type: 'competitor' },
  { label: 'Fornitori camere', type: 'partner' },
  { label: 'Angel EU', type: 'investor' },
  { label: 'Pixellot', type: 'competitor' },
  { label: 'Federazioni', type: 'partner' },
  { label: 'Allenatore U15', type: 'persona' },
  { label: 'Trace', type: 'competitor' },
  { label: 'Resend', type: 'partner' },
  { label: 'Direttore sportivo', type: 'persona' },
  { label: 'Hudl', type: 'competitor' },
  { label: 'Netlify', type: 'partner' },
  { label: 'Micro-VC sport', type: 'investor' },
  { label: 'Spiideo', type: 'competitor' },
  { label: 'Ayrshare', type: 'partner' },
  { label: 'Genitore', type: 'persona' },
  { label: 'Resp. federazione', type: 'persona' },
  { label: 'Acceleratore', type: 'investor' },
];

const CENTER = { id: 'c', label: 'MatchLens', type: 'startup', x: 50, y: 50, r: 7 };

const ECO_NODES = [
  CENTER,
  ...ECO_SATELLITES.map((s, i) => {
    const angle = (i / ECO_SATELLITES.length) * Math.PI * 2 - Math.PI / 2;
    const radius = i % 2 === 0 ? 41 : 32; // stagger two rings to space labels out
    return { id: `n${i}`, label: s.label, type: s.type, x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle), r: 4.2 };
  }),
];

// A few cross-links between satellites so the graph reads as a real network,
// not a pure star. Referenced by label.
const ECO_CROSS: Array<[string, string]> = [
  ['Federazioni', 'Resp. federazione'],
  ['Allenatore U15', 'Genitore'],
  ['Veo', 'Pixellot'],
  ['Trace', 'Hudl'],
  ['Resend', 'Netlify'],
  ['Angel EU', 'Micro-VC sport'],
  ['Fornitori camere', 'Veo'],
];

export function EcoGraph({ height = 340, showLabels = true }: { height?: number; showLabels?: boolean }) {
  const center = ECO_NODES[0];
  const byLabel = new Map(ECO_NODES.map((n) => [n.label, n]));
  return (
    <svg viewBox="0 0 100 100" style={{ width: '100%', height, display: 'block' }} preserveAspectRatio="xMidYMid meet">
      {ECO_NODES.slice(1).map((n) => (
        <line key={`e-${n.id}`} x1={center.x} y1={center.y} x2={n.x} y2={n.y} stroke="var(--line-2)" strokeWidth={0.3} />
      ))}
      {ECO_CROSS.map(([a, b], i) => {
        const na = byLabel.get(a), nb = byLabel.get(b);
        if (!na || !nb) return null;
        return <line key={`x-${i}`} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} stroke="var(--line-2)" strokeWidth={0.25} strokeDasharray="1 1" opacity={0.7} />;
      })}
      {ECO_NODES.map((n, i) => (
        <g key={n.label + i}>
          <circle cx={n.x} cy={n.y} r={n.r} fill={ECO_TYPES[n.type]} opacity={n.type === 'startup' ? 1 : 0.85} />
          {showLabels && (
            <text
              x={n.x}
              y={n.y - n.r - 1.2}
              textAnchor="middle"
              style={{ fontSize: n.type === 'startup' ? 3.4 : 2.4, fill: 'var(--ink-3)', fontFamily: 'var(--f-sans)' }}
            >
              {n.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export function EcoLegend() {
  const items = [
    { label: 'Startup', type: 'startup', count: 1 },
    { label: 'Competitor', type: 'competitor', count: 5 },
    { label: 'Personas', type: 'persona', count: 4 },
    { label: 'Partner', type: 'partner', count: 5 },
    { label: 'Investitori', type: 'investor', count: 3 },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '8px 14px' }}>
      {items.map((it) => (
        <span key={it.label} style={{ fontSize: 10.5, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className="lp-dot" style={{ background: ECO_TYPES[it.type] }} />
          {it.label} · {it.count}
        </span>
      ))}
    </div>
  );
}

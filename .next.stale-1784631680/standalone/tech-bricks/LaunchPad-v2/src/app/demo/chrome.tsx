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
import {
  MACRO_CATEGORY_ORDER, MACRO_CATEGORY_COLOR, MACRO_CATEGORY_LABEL, NODE_COLORS, macroCategoryFor,
  type MacroCategory,
} from '@/types/graph';

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
    // ctxLabel is derived from the graph data in DemoStatusBar (ECO_* counts)
    // so it can't drift; this static value is only a fallback.
    status: { heartbeatLabel: 'heartbeat · grafo aggiornato', gateway: 'demo · dati simulati', ctxLabel: 'grafo Knowledge' },
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
  const entry = entryFor(pathname);
  const s = entry.status;
  const ctxLabel = entry.id === 'knowledge'
    ? `${ECO_NODE_COUNT} nodi · ${ECO_EDGE_COUNT} collegamenti`
    : s.ctxLabel;
  return (
    <StatusBar
      heartbeatLabel={s.heartbeatLabel}
      heartbeatKind="healthy"
      gateway={s.gateway}
      ctxLabel={ctxLabel}
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
// EcoGraph — static SVG ecosystem graph that mirrors the live product graph
// (src/components/graph/KnowledgeGraph.tsx): the startup root at centre with 12
// fixed macro-category wedges arranged clockwise (MACRO_CATEGORY_ORDER), each
// drawn as a soft tinted region + label, and dashed "ghost" circles for empty
// categories. Reused on Home (small) and Knowledge (large). Reproduces the LOOK,
// not the d3 force sim — colours/labels/wedge order are imported from
// @/types/graph so the demo tracks the product instead of re-typing them.
// -----------------------------------------------------------------------------

// Each satellite is a named MatchLens entity + its product node_type; the wedge
// it lands in is resolved via macroCategoryFor() and its dot colour via
// NODE_COLORS — exactly like the real graph. Names are kept consistent with the
// Lista/competitor data in ./mock.ts so both surfaces tell one story.
// hr_collabs is intentionally left empty so the ghost-circle affordance shows.
type EcoEntity = { label: string; node_type: string };
const ECO_ENTITIES: EcoEntity[] = [
  // concorrenza
  { label: 'Veo', node_type: 'competitor' },
  { label: 'Pixellot', node_type: 'competitor' },
  { label: 'Trace', node_type: 'competitor' },
  { label: 'Hudl', node_type: 'competitor' },
  // clienti
  { label: 'Allenatore U15', node_type: 'persona' },
  { label: 'Direttore sportivo', node_type: 'persona' },
  { label: 'Genitore', node_type: 'persona' },
  { label: 'Club dilettantistici EU', node_type: 'market_segment' },
  // partner
  { label: 'Federazioni regionali', node_type: 'partner' },
  { label: 'Resend', node_type: 'partner' },
  { label: 'Netlify', node_type: 'partner' },
  // investitori
  { label: 'Angel EU', node_type: 'funding_source' },
  { label: 'Micro-VC sport', node_type: 'funding_source' },
  // fornitori
  { label: 'Fornitori camere', node_type: 'supplier' },
  { label: 'Cloud storage', node_type: 'supplier' },
  // prodotto
  { label: 'Tagging AI eventi', node_type: 'feature' },
  { label: 'Clip automatiche', node_type: 'feature' },
  { label: 'Condivisione famiglie', node_type: 'feature' },
  // trend_tech
  { label: 'Camera AI turnkey', node_type: 'technology' },
  { label: 'Computer vision', node_type: 'technology' },
  // trend_mercato
  { label: 'AI Act minori', node_type: 'trend' },
  { label: 'Highlights WhatsApp', node_type: 'signal' },
  // business_essentials
  { label: 'Consenso GDPR federazione', node_type: 'business_essential' },
  // gtm
  { label: 'Sequenza email', node_type: 'gtm_strategy' },
  { label: 'Canale federazioni', node_type: 'gtm_strategy' },
  // branding
  { label: 'Brand MatchLens', node_type: 'brand_asset' },
];

// A few cross-links between satellites so the graph reads as a real network,
// not a pure star. Referenced by label.
const ECO_CROSS: Array<[string, string]> = [
  ['Veo', 'Pixellot'],
  ['Federazioni regionali', 'Consenso GDPR federazione'],
  ['Angel EU', 'Micro-VC sport'],
  ['Camera AI turnkey', 'Fornitori camere'],
  ['Sequenza email', 'Federazioni regionali'],
  ['Allenatore U15', 'Highlights WhatsApp'],
];

// Node + edge totals derived from the data above, so the header pill and legend
// can never drift from what the graph actually renders (the old bug: a literal
// "18 nodi · 24 collegamenti" string maintained by hand).
export const ECO_NODE_COUNT = 1 + ECO_ENTITIES.length; // + startup root
export const ECO_EDGE_COUNT = ECO_ENTITIES.length + ECO_CROSS.length; // spokes + cross-links

// --- Deterministic layout (viewBox units, centre 50,50) -----------------------
const CX = 50, CY = 50;
const RING = 30; // radius of the satellite cluster ring
const catOf = (node_type: string) => macroCategoryFor(node_type) as MacroCategory;
const catAngle = (cat: MacroCategory) =>
  (-90 + (360 / MACRO_CATEGORY_ORDER.length) * MACRO_CATEGORY_ORDER.indexOf(cat)) * (Math.PI / 180);

type PlacedNode = EcoEntity & { x: number; y: number };
function computeLayout() {
  const byCat = new Map<MacroCategory, EcoEntity[]>();
  for (const e of ECO_ENTITIES) {
    const cat = catOf(e.node_type);
    (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(e);
  }
  const placed: PlacedNode[] = [];
  for (const cat of MACRO_CATEGORY_ORDER) {
    const list = byCat.get(cat) ?? [];
    const base = catAngle(cat);
    const spread = 22 * (Math.PI / 180);
    list.forEach((e, j) => {
      const frac = list.length === 1 ? 0 : j / (list.length - 1) - 0.5; // -0.5..0.5
      const a = base + frac * spread;
      const r = RING + (list.length > 1 ? (j % 2 === 0 ? -3 : 3) : 0); // stagger radius
      placed.push({ ...e, x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) });
    });
  }
  const presentCats = MACRO_CATEGORY_ORDER.filter(c => (byCat.get(c)?.length ?? 0) > 0);
  const emptyCats = MACRO_CATEGORY_ORDER.filter(c => !(byCat.get(c)?.length));
  return { placed, byCat, presentCats, emptyCats };
}

/** Soft tinted region (centroid + radius) covering a category's placed nodes —
 *  the static analog of the real convex-hull wash. */
function regionFor(nodes: PlacedNode[]) {
  const mx = nodes.reduce((s, p) => s + p.x, 0) / nodes.length;
  const my = nodes.reduce((s, p) => s + p.y, 0) / nodes.length;
  const rr = Math.max(...nodes.map(p => Math.hypot(p.x - mx, p.y - my)), 0) + 6;
  return { mx, my, rr };
}

export function EcoGraph({ height = 340, showLabels = true }: { height?: number; showLabels?: boolean }) {
  const { placed, byCat, presentCats, emptyCats } = computeLayout();
  const byLabel = new Map(placed.map(p => [p.label, p]));
  const ghostCats = showLabels ? emptyCats : []; // ghosts only on the labelled (full) variant
  const labelText = (cat: MacroCategory) => MACRO_CATEGORY_LABEL[cat].it.toUpperCase();
  // Place a category label just outside its wedge; anchor by hemisphere so long
  // Italian labels don't clip the square viewBox.
  const labelPos = (cat: MacroCategory) => {
    const a = catAngle(cat), lr = 43;
    const x = CX + lr * Math.cos(a), y = CY + lr * Math.sin(a);
    const anchor = Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle';
    return { x, y, anchor: anchor as 'start' | 'middle' | 'end' };
  };
  return (
    <svg viewBox="0 0 100 100" style={{ width: '100%', height, display: 'block' }} preserveAspectRatio="xMidYMid meet">
      {/* Macro-category regions — soft tinted washes drawn behind links + nodes */}
      {presentCats.map(cat => {
        const { mx, my, rr } = regionFor(byCat.get(cat)!.map(e => byLabel.get(e.label)!));
        return (
          <circle key={`r-${cat}`} cx={mx} cy={my} r={rr}
            fill={MACRO_CATEGORY_COLOR[cat]} fillOpacity={0.07}
            stroke={MACRO_CATEGORY_COLOR[cat]} strokeOpacity={0.22} strokeWidth={0.4} />
        );
      })}
      {/* Ghost circles for empty categories (dashed) */}
      {ghostCats.map(cat => {
        const a = catAngle(cat);
        return (
          <circle key={`g-${cat}`} cx={CX + RING * Math.cos(a)} cy={CY + RING * Math.sin(a)} r={7}
            fill="none" stroke="var(--line-2)" strokeOpacity={0.7} strokeWidth={0.4} strokeDasharray="1.4 1.4" />
        );
      })}
      {/* Category labels */}
      {showLabels && [...presentCats, ...ghostCats].map(cat => {
        const { x, y, anchor } = labelPos(cat);
        const present = presentCats.includes(cat);
        return (
          <text key={`l-${cat}`} x={x} y={y} textAnchor={anchor}
            style={{
              fontSize: 2.2, fontWeight: 700, letterSpacing: 0.18, fontFamily: 'var(--f-sans)',
              fill: present ? MACRO_CATEGORY_COLOR[cat] : 'var(--ink-5)',
              fillOpacity: present ? 0.85 : 0.55,
            }}>
            {labelText(cat)}
          </text>
        );
      })}
      {/* Spokes: root → each satellite */}
      {placed.map((n, i) => (
        <line key={`e-${i}`} x1={CX} y1={CY} x2={n.x} y2={n.y} stroke="var(--line-2)" strokeWidth={0.3} />
      ))}
      {/* Cross-links (dashed) */}
      {ECO_CROSS.map(([a, b], i) => {
        const na = byLabel.get(a), nb = byLabel.get(b);
        if (!na || !nb) return null;
        return <line key={`x-${i}`} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} stroke="var(--line-2)" strokeWidth={0.25} strokeDasharray="1 1" opacity={0.7} />;
      })}
      {/* Satellite nodes — labels pushed radially outward from the root so the
          dense inner clusters stay legible. */}
      {placed.map((n, i) => {
        const a = Math.atan2(n.y - CY, n.x - CX);
        const lx = n.x + Math.cos(a) * 2.6, ly = n.y + Math.sin(a) * 2.6 + 0.6;
        const anchor = Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle';
        return (
          <g key={n.label + i}>
            <circle cx={n.x} cy={n.y} r={1.9} fill={NODE_COLORS[n.node_type] ?? 'var(--ink-5)'} opacity={0.9} />
            {showLabels && (
              <text x={lx} y={ly} textAnchor={anchor}
                style={{ fontSize: 1.9, fill: 'var(--ink-3)', fontFamily: 'var(--f-sans)' }}>
                {n.label}
              </text>
            )}
          </g>
        );
      })}
      {/* Startup root, pinned at centre */}
      <circle cx={CX} cy={CY} r={4.4} fill={NODE_COLORS.your_startup} />
      {showLabels && (
        <text x={CX} y={CY - 5.6} textAnchor="middle"
          style={{ fontSize: 3, fontWeight: 600, fill: 'var(--ink-2)', fontFamily: 'var(--f-sans)' }}>
          MatchLens
        </text>
      )}
    </svg>
  );
}

export function EcoLegend() {
  // One row per macro-category that has nodes, coloured by its wash + counted
  // from the graph data — no hand-maintained totals.
  const counts = new Map<MacroCategory, number>();
  for (const e of ECO_ENTITIES) {
    const cat = catOf(e.node_type);
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  const items = MACRO_CATEGORY_ORDER.filter(c => (counts.get(c) ?? 0) > 0);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '8px 14px' }}>
      {items.map((cat) => (
        <span key={cat} style={{ fontSize: 10.5, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className="lp-dot" style={{ background: MACRO_CATEGORY_COLOR[cat] }} />
          {MACRO_CATEGORY_LABEL[cat].it} · {counts.get(cat)}
        </span>
      ))}
    </div>
  );
}

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
import { BinocularsGlyph, RobotGlyph, RailTooltip, useRailHover, type IconKey } from '@/components/design/icons';
import {
  MACRO_CATEGORY_ORDER, MACRO_CATEGORY_COLOR, MACRO_CATEGORY_LABEL, NODE_COLORS, macroCategoryFor,
  nodeTypeLabel, type MacroCategory,
} from '@/types/graph';
import { THEME_COOKIE } from '@/lib/theme';

// -----------------------------------------------------------------------------
// Nav config — one entry per demo page
// -----------------------------------------------------------------------------

type NavEntry = {
  id: string;
  href: string;
  iconKey: IconKey;
  /** Optional custom glyph (overrides iconKey) for icons not in the shared set. */
  icon?: React.ReactNode;
  label: string;
  breadcrumb: string;
  badge?: number;
  badgeTone?: 'alert' | 'count';
  streaming?: boolean;
  status: { heartbeatLabel: string; gateway: string; ctxLabel: string };
};

// Custom rail glyphs (binoculars → Osservatori, robot → Co-pilot) live in the
// shared design/icons module so the real NavRail + this demo replica stay in sync.

const PRIMARY: NavEntry[] = [
  {
    id: 'home', href: '/demo', iconKey: 'home', label: 'Home', breadcrumb: 'Home',
    status: { heartbeatLabel: 'heartbeat · 3 osservatori attivi', gateway: 'demo · dati simulati', ctxLabel: '4 elementi in Inbox' },
  },
];

const CHANNELS: NavEntry[] = [
  {
    id: 'inbox', href: '/demo/inbox', iconKey: 'tickets', icon: <BinocularsGlyph />, label: 'Osservatori', breadcrumb: 'Osservatori',
    badge: 4, badgeTone: 'alert',
    status: { heartbeatLabel: 'heartbeat · ultima scansione 2 ore fa', gateway: 'demo · dati simulati', ctxLabel: '4 proposte da rivedere' },
  },
  {
    id: 'knowledge', href: '/demo/knowledge', iconKey: 'book', label: 'Conoscenza', breadcrumb: 'Conoscenza',
    badge: 29, badgeTone: 'count',
    // ctxLabel is derived from the graph data in DemoStatusBar (ECO_* counts)
    // so it can't drift; this static value is only a fallback.
    status: { heartbeatLabel: 'heartbeat · grafo aggiornato', gateway: 'demo · dati simulati', ctxLabel: 'grafo Conoscenza' },
  },
  {
    id: 'financial', href: '/demo/financial', iconKey: 'dollar', label: 'Finanze', breadcrumb: 'Finanze',
    status: { heartbeatLabel: 'heartbeat · modello ricalcolato', gateway: 'demo · dati simulati', ctxLabel: 'runway 14 mesi' },
  },
  {
    id: 'chat', href: '/demo/chat', iconKey: 'chat', icon: <RobotGlyph />, label: 'Co-pilot', breadcrumb: 'Co-pilot',
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
      {/* Light/dark theme toggle — same mechanism as the real NavRail ThemeToggle
          (toggles the token-driven theme-ink/dark class on <html>, cookie-persisted). */}
      <DemoThemeToggle />
      <AccountChip />
    </div>
  );
}

function RailItem({ e, active }: { e: NavEntry; active: boolean }) {
  const isCount = e.badgeTone === 'count';
  const { hover, bind } = useRailHover();
  return (
    <Link
      href={e.href}
      aria-label={e.label}
      {...bind}
      style={{
        width: 42, height: 38, borderRadius: 'var(--r-m)', cursor: 'pointer',
        background: active ? 'var(--surface)' : 'transparent',
        boxShadow: active ? 'inset 0 0 0 1px var(--line)' : 'none',
        color: active ? 'var(--ink)' : 'var(--ink-4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        textDecoration: 'none', position: 'relative',
      }}
    >
      {e.icon ?? <Icon d={I[e.iconKey]} size={17} stroke={1.35} />}
      {typeof e.badge === 'number' && e.badge > 0 && (
        <span
          style={{
            position: 'absolute', top: 3, right: 5, minWidth: 14, height: 14, borderRadius: 7,
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
        <span className="lp-dot lp-pulse" style={{ position: 'absolute', top: 5, right: 6, width: 6, height: 6, background: 'var(--accent)' }} />
      )}
      <RailTooltip label={e.label} show={hover} />
    </Link>
  );
}

// Icon-only theme toggle for the demo rail. Re-implements the real ThemeToggle's
// mechanism (add/remove theme-ink + dark on <html>, persist THEME_COOKIE) without
// the LocaleProvider label dependency, so it stays self-contained + icon-only.
function DemoThemeToggle() {
  const [dark, setDark] = React.useState(true);
  const { hover, bind } = useRailHover();
  React.useEffect(() => {
    setDark(document.documentElement.classList.contains('theme-ink'));
  }, []);
  function toggle() {
    const el = document.documentElement;
    const goingLight = el.classList.contains('theme-ink');
    if (goingLight) el.classList.remove('theme-ink', 'dark');
    else el.classList.add('theme-ink', 'dark');
    document.cookie = `${THEME_COOKIE}=${goingLight ? 'light' : 'dark'}; path=/; max-age=31536000; samesite=lax`;
    setDark(!goingLight);
  }
  const label = dark ? 'Tema chiaro' : 'Tema scuro';
  return (
    <button
      onClick={toggle}
      aria-label={label}
      {...bind}
      style={{
        flexShrink: 0, width: 42, height: 38, borderRadius: 'var(--r-m)', cursor: 'pointer',
        background: 'transparent', border: 'none', color: 'var(--ink-4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
      }}
    >
      {dark ? (
        // Sun — click to go light.
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        // Moon — click to go dark.
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
      <RailTooltip label={label} show={hover} />
    </button>
  );
}

function AccountChip() {
  const { hover, bind } = useRailHover();
  return (
    <div {...bind} style={{ position: 'relative', flexShrink: 0, marginTop: 6 }}>
      <div
        style={{
          width: 28, height: 28, borderRadius: 14, background: 'var(--ink)', color: 'var(--paper)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600,
          fontFamily: 'var(--f-mono)', cursor: 'default',
        }}
      >
        ML
      </div>
      <RailTooltip label="Demo — account di esempio" show={hover} />
    </div>
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
// Entities carry demo detail (summary/attributes/provenance) so a click can open
// a NodeDetailPanel-style sidebar — mirroring the real product graph. Content is
// static IT copy consistent with the MatchLens story told across ./mock.ts.
export type EcoEntity = {
  label: string;
  node_type: string;
  summary?: string;
  attributes?: { k: string; v: string }[];
  prov?: 'founder' | 'derived' | 'verified';
};
export const ECO_ENTITIES: EcoEntity[] = [
  // concorrenza
  { label: 'Veo', node_type: 'competitor', prov: 'verified',
    summary: 'Leader delle camere AI chiavi in mano per il calcio dilettantistico, forte in Nord Europa.',
    attributes: [{ k: 'Prezzo', v: '~1.200 €/anno' }, { k: 'Copertura', v: '40+ paesi' }, { k: 'Punto debole', v: 'costo alto per club piccoli' }] },
  { label: 'Pixellot', node_type: 'competitor', prov: 'verified',
    summary: 'Piattaforma di ripresa automatica multi-sport, spesso in licenza alle federazioni.',
    attributes: [{ k: 'Modello', v: 'B2B2C via federazioni' }, { k: 'Focus', v: 'produzione broadcast' }] },
  { label: 'Trace', node_type: 'competitor', prov: 'verified',
    summary: 'Sistema camera + AI focalizzato sul calcio giovanile, forte negli USA.',
    attributes: [{ k: 'Mercato', v: 'USA' }, { k: 'Target', v: 'soccer giovanile' }] },
  { label: 'Hudl', node_type: 'competitor', prov: 'verified',
    summary: "Incumbent dell'analisi video sportiva: ampia base ma tagging in gran parte manuale.",
    attributes: [{ k: 'Base', v: 'milioni di team' }, { k: 'Debolezza', v: 'tagging manuale' }] },
  // clienti
  { label: 'Allenatore U15', node_type: 'persona', prov: 'derived',
    summary: 'Allenatore di una squadra giovanile che vuole clip pronte senza montaggio manuale.',
    attributes: [{ k: 'Bisogno', v: 'highlights post-partita' }, { k: 'Tempo', v: '<10 min a settimana' }] },
  { label: 'Direttore sportivo', node_type: 'persona', prov: 'derived',
    summary: "Decisore d'acquisto a livello di club: valuta ROI, budget ed engagement.",
    attributes: [{ k: 'Leva', v: 'budget società' }, { k: 'KPI', v: 'engagement famiglie' }] },
  { label: 'Genitore', node_type: 'persona', prov: 'derived',
    summary: 'Vuole rivedere e condividere i momenti del figlio con parenti e amici.',
    attributes: [{ k: 'Canale', v: 'WhatsApp' }, { k: 'WTP diretta', v: 'bassa' }] },
  { label: 'Club dilettantistici EU', node_type: 'market_segment', prov: 'derived',
    summary: 'Segmento core: società amatoriali europee con budget limitato e molte partite.',
    attributes: [{ k: 'Dimensione', v: '~120k club EU' }, { k: 'Budget', v: '<2k €/anno' }] },
  // partner
  { label: 'Federazioni regionali', node_type: 'partner', prov: 'founder',
    summary: 'Canale di distribuzione verso i club affiliati e leva di fiducia sul consenso.',
    attributes: [{ k: 'Ruolo', v: 'aggregatore club' }, { k: 'Leva', v: 'consenso e fiducia' }] },
  { label: 'Resend', node_type: 'partner', prov: 'founder',
    summary: 'Infrastruttura email transazionale per notifiche e sequenze di nurturing.',
    attributes: [{ k: 'Uso', v: 'email clip pronte' }, { k: 'Stato', v: 'integrato' }] },
  { label: 'Netlify', node_type: 'partner', prov: 'founder',
    summary: 'Hosting e deploy della piattaforma web del prodotto.',
    attributes: [{ k: 'Uso', v: 'deploy produzione' }, { k: 'Stato', v: 'attivo' }] },
  // investitori
  { label: 'Angel EU', node_type: 'funding_source', prov: 'derived',
    summary: 'Business angel europei con interesse per lo sportech consumer.',
    attributes: [{ k: 'Taglio', v: '25-100k €' }, { k: 'Stadio', v: 'pre-seed' }] },
  { label: 'Micro-VC sport', node_type: 'funding_source', prov: 'derived',
    summary: 'Fondi micro specializzati in sport & media early-stage.',
    attributes: [{ k: 'Taglio', v: '100-500k €' }, { k: 'Tesi', v: 'sportech consumer' }] },
  // fornitori
  { label: 'Fornitori camere', node_type: 'supplier', prov: 'founder',
    summary: 'Produttori hardware delle telecamere AI chiavi in mano installate nei campi.',
    attributes: [{ k: 'Tipo', v: 'OEM camera' }, { k: 'Rischio', v: 'lead time' }] },
  { label: 'Cloud storage', node_type: 'supplier', prov: 'founder',
    summary: 'Storage video scalabile per registrazioni e clip generate.',
    attributes: [{ k: 'Costo', v: 'per GB' }, { k: 'Leva', v: 'compressione clip' }] },
  // prodotto
  { label: 'Tagging AI eventi', node_type: 'feature', prov: 'founder',
    summary: 'Riconoscimento automatico di gol, tiri e azioni chiave dal video partita.',
    attributes: [{ k: 'Input', v: 'video partita' }, { k: 'Output', v: 'eventi taggati' }] },
  { label: 'Clip automatiche', node_type: 'feature', prov: 'founder',
    summary: 'Generazione di clip highlight in pochi minuti, senza montaggio manuale.',
    attributes: [{ k: 'Tempo', v: 'minuti' }, { k: 'Trigger', v: 'eventi taggati' }] },
  { label: 'Condivisione famiglie', node_type: 'feature', prov: 'founder',
    summary: 'Distribuzione delle clip a genitori e giocatori per squadra.',
    attributes: [{ k: 'Canale', v: 'WhatsApp / link' }, { k: 'Accesso', v: 'per squadra' }] },
  // trend_tech
  { label: 'Camera AI chiavi in mano', node_type: 'technology', prov: 'verified',
    summary: 'Telecamere plug-and-play con visione integrata, sempre più accessibili.',
    attributes: [{ k: 'Maturità', v: 'in crescita' }, { k: 'Barriera', v: 'costo hardware' }] },
  { label: 'Computer vision', node_type: 'technology', prov: 'verified',
    summary: 'Modelli di visione per tracking di palla e giocatori e per il tagging.',
    attributes: [{ k: 'Uso', v: 'tagging eventi' }, { k: 'Trend', v: 'on-device' }] },
  // trend_mercato
  { label: 'AI Act minori', node_type: 'trend', prov: 'verified',
    summary: "Normativa UE sull'uso di AI e dati di minori: alza l'asticella sul consenso.",
    attributes: [{ k: 'Impatto', v: 'consenso rafforzato' }, { k: 'Stato', v: 'in vigore' }] },
  { label: 'Highlights WhatsApp', node_type: 'signal', prov: 'derived',
    summary: 'I club condividono già clip via WhatsApp in modo manuale: domanda latente.',
    attributes: [{ k: 'Segnale', v: 'domanda latente' }, { k: 'Fonte', v: 'interviste' }] },
  // business_essentials
  { label: 'Consenso GDPR federazione', node_type: 'business_essential', prov: 'founder',
    summary: 'Gestione del consenso per riprese di minori tramite le federazioni.',
    attributes: [{ k: 'Requisito', v: 'consenso genitori' }, { k: 'Leva', v: 'flusso federazione' }] },
  // gtm
  { label: 'Sequenza email', node_type: 'gtm_strategy', prov: 'derived',
    summary: 'Nurturing via email verso allenatori e club per attivare le prove.',
    attributes: [{ k: 'Canale', v: 'email' }, { k: 'Obiettivo', v: 'trial club' }] },
  { label: 'Canale federazioni', node_type: 'gtm_strategy', prov: 'derived',
    summary: 'Go-to-market B2B2C attraverso le federazioni regionali.',
    attributes: [{ k: 'Modello', v: 'top-down' }, { k: 'Leva', v: 'affiliazione' }] },
  // branding
  { label: 'Brand MatchLens', node_type: 'brand_asset', prov: 'founder',
    summary: 'Identità del prodotto: highlights AI per il calcio di base.',
    attributes: [{ k: 'Promessa', v: 'ogni partita, i tuoi momenti' }, { k: 'Tono', v: 'vicino ai club' }] },
];

// The startup root, surfaced when the centre node is clicked (mirrors the real
// your_startup node). Not part of ECO_ENTITIES so it stays out of the counts/legend.
export const ECO_ROOT: EcoEntity = {
  label: 'MatchLens', node_type: 'your_startup', prov: 'founder',
  summary: 'La tua startup: telecamere e AI che trasformano ogni partita dilettantistica in highlights condivisibili.',
  attributes: [{ k: 'Stadio', v: 'pre-seed' }, { k: 'Mercato', v: 'club dilettantistici EU' }, { k: 'Modello', v: 'hardware + SaaS' }],
};

// A few cross-links between satellites so the graph reads as a real network,
// not a pure star. Referenced by label.
const ECO_CROSS: Array<[string, string]> = [
  ['Veo', 'Pixellot'],
  ['Federazioni regionali', 'Consenso GDPR federazione'],
  ['Angel EU', 'Micro-VC sport'],
  ['Camera AI chiavi in mano', 'Fornitori camere'],
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

export function EcoGraph({ height = 340, showLabels = true, onNodeClick, selectedLabel }: {
  height?: number;
  showLabels?: boolean;
  /** When provided, satellite + root nodes become clickable; null = background/clear. */
  onNodeClick?: (e: EcoEntity | null) => void;
  selectedLabel?: string | null;
}) {
  const interactive = !!onNodeClick;
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
    <svg viewBox="0 0 100 100" style={{ width: '100%', height, display: 'block' }} preserveAspectRatio="xMidYMid meet"
      onClick={interactive ? () => onNodeClick!(null) : undefined}>
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
        const color = NODE_COLORS[n.node_type] ?? 'var(--ink-5)';
        const selected = selectedLabel === n.label;
        return (
          <g key={n.label + i}
            onClick={interactive ? (e) => { e.stopPropagation(); onNodeClick!(n); } : undefined}
            style={{ cursor: interactive ? 'pointer' : 'default' }}>
            {/* Enlarged transparent hit target for easier clicking */}
            {interactive && <circle cx={n.x} cy={n.y} r={3.4} fill="transparent" />}
            {selected && <circle cx={n.x} cy={n.y} r={3} fill="none" stroke={color} strokeWidth={0.6} />}
            <circle cx={n.x} cy={n.y} r={1.9} fill={color} opacity={0.9} />
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
      <g onClick={interactive ? (e) => { e.stopPropagation(); onNodeClick!(ECO_ROOT); } : undefined}
        style={{ cursor: interactive ? 'pointer' : 'default' }}>
        {selectedLabel === ECO_ROOT.label && (
          <circle cx={CX} cy={CY} r={5.6} fill="none" stroke={NODE_COLORS.your_startup} strokeWidth={0.7} />
        )}
        <circle cx={CX} cy={CY} r={4.4} fill={NODE_COLORS.your_startup} />
      </g>
      {showLabels && (
        <text x={CX} y={CY - 5.6} textAnchor="middle"
          style={{ fontSize: 3, fontWeight: 600, fill: 'var(--ink-2)', fontFamily: 'var(--f-sans)', pointerEvents: 'none' }}>
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

// -----------------------------------------------------------------------------
// DemoNodeDetailPanel — static clone of the real graph's NodeDetailPanel
// (src/components/graph/NodeDetailPanel.tsx): a right-hand aside that slides in
// over the graph when a node is clicked. No editing / API / i18n hook — the demo
// is IT-only and zero-fetch. Rendered as a SIBLING of <EcoGraph> in a
// position:relative container.
// -----------------------------------------------------------------------------

const PROV_META: Record<NonNullable<EcoEntity['prov']>, { label: string; kind: 'n' | 'info' | 'ok' }> = {
  founder: { label: 'dichiarato', kind: 'n' },
  derived: { label: 'derivato', kind: 'info' },
  verified: { label: 'verificato', kind: 'ok' },
};

/** One-hop neighbours: cross-linked satellites + the startup root (so you can
 *  navigate back to centre). The root itself has no chips (it links to all). */
function neighborsOf(label: string): EcoEntity[] {
  if (label === ECO_ROOT.label) return [];
  const names = new Set<string>();
  for (const [a, b] of ECO_CROSS) {
    if (a === label) names.add(b);
    if (b === label) names.add(a);
  }
  return [ECO_ROOT, ...ECO_ENTITIES.filter((e) => names.has(e.label))];
}

export function DemoNodeDetailPanel({ node, onClose, onSelectNeighbor }: {
  node: EcoEntity | null;
  onClose: () => void;
  onSelectNeighbor?: (e: EcoEntity) => void;
}) {
  if (!node) return null;
  const color = NODE_COLORS[node.node_type] ?? 'var(--ink-5)';
  const cat = macroCategoryFor(node.node_type);
  const catLabel = cat ? MACRO_CATEGORY_LABEL[cat].it : null;
  const prov = node.prov ? PROV_META[node.prov] : null;
  const neighbors = neighborsOf(node.label);
  return (
    <aside
      role="complementary"
      aria-label={`Dettagli ${node.label}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', top: 0, right: 0, width: 320, maxWidth: '85%', height: '100%', zIndex: 20,
        background: 'var(--surface)', borderLeft: '1px solid var(--line)', boxShadow: '-8px 0 24px rgba(0,0,0,0.10)',
        display: 'flex', flexDirection: 'column', animation: 'lp-rise 180ms ease',
      }}
    >
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span aria-hidden style={{ width: 11, height: 11, borderRadius: '50%', flexShrink: 0, marginTop: 4, background: color }} />
          <h3 style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 16, fontWeight: 650, lineHeight: 1.3, color: 'var(--ink)' }}>{node.label}</h3>
          <button onClick={onClose} aria-label="Chiudi" style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--ink-5)', cursor: 'pointer', padding: 2, lineHeight: 0 }}>
            <Icon d={I.x} size={15} />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <Pill kind="n">{nodeTypeLabel(node.node_type, 'it')}</Pill>
          {catLabel && <Pill kind="info">{catLabel}</Pill>}
          {prov && <Pill kind={prov.kind} dot>{prov.label}</Pill>}
        </div>
      </div>
      {/* Body */}
      <div className="lp-scroll" style={{ flex: 1, overflow: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {node.summary && <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-3)' }}>{node.summary}</p>}
        {node.attributes && node.attributes.length > 0 && (
          <div>
            <div className="lp-mono" style={{ fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-5)', marginBottom: 6 }}>Attributi</div>
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
              {node.attributes.map((at) => (
                <React.Fragment key={at.k}>
                  <dt style={{ fontSize: 11, color: 'var(--ink-5)' }}>{at.k}</dt>
                  <dd style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-2)' }}>{at.v}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        )}
        {neighbors.length > 0 && (
          <div>
            <div className="lp-mono" style={{ fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-5)', marginBottom: 6 }}>Collegamenti</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {neighbors.map((nb) => (
                <button key={nb.label} onClick={() => onSelectNeighbor?.(nb)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 'var(--r-m)', border: '1px solid var(--line)', background: 'transparent', cursor: 'pointer', fontSize: 11, color: 'var(--ink-3)' }}>
                  <span className="lp-dot" style={{ background: NODE_COLORS[nb.node_type] ?? 'var(--ink-5)' }} />
                  {nb.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

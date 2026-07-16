'use client';

/**
 * /demo — section components for the vision demo. DEMO PURPOSES ONLY.
 *
 * Every component here is pure presentation over the hardcoded data in
 * ./mock.ts — no fetching, no context beyond the design primitives. The
 * markup deliberately mirrors the real surfaces (NavRail, SpineSection,
 * StageCard evidence rows, DataRoomPanel list) so the page reads as the
 * product, not as a slide.
 */

import * as React from 'react';
import { Icon, I, Panel, Pill, MetricTile, type PillKind } from '@/components/design/primitives';
import type { IconKey } from '@/components/design/icons';
import {
  PROJECT, HEADLINE_METRICS, STAGES, GATE_TRACKS, LOOPS, DATA_ROOM,
  DATA_ROOM_FOOT, GROWTH_FUNNEL, GROWTH_ITEMS, BUILD_APP, BUILD_ITERATIONS,
  ACTIVITY, WATCHERS, INTEL_ALERT, ECOSYSTEM, INBOX, FOOTER_NOTE, type Verdict,
} from './mock';

// =============================================================================
// Demo banner — the one element that must never look like real data
// =============================================================================

export function DemoBanner() {
  return (
    <div
      style={{
        flexShrink: 0,
        background: 'var(--accent-wash)',
        borderBottom: '1px solid var(--line)',
        padding: '5px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 11,
        color: 'var(--ink-2)',
      }}
    >
      <span className="lp-dot lp-pulse" style={{ background: 'var(--accent)' }} />
      <span style={{ fontWeight: 600 }}>DEMO</span>
      <span style={{ color: 'var(--ink-4)' }}>
        Visione del prodotto — progetto di esempio, dati simulati
      </span>
    </div>
  );
}

// =============================================================================
// DemoNavRail — static replica of the real NavRail (chrome.tsx). Items
// anchor-scroll to page sections instead of navigating into the (auth-gated)
// app; labels match the live Italian i18n verbatim.
// =============================================================================

const RAIL_ITEMS: Array<{ iconKey: IconKey; label: string; href: string; badge?: number; badgeTone?: 'alert' | 'count'; streaming?: boolean; active?: boolean }> = [
  { iconKey: 'home', label: 'Home', href: '#top', active: true },
];
const RAIL_CHANNELS: typeof RAIL_ITEMS = [
  { iconKey: 'tickets', label: 'Osservatori', href: '#inbox', badge: 3, badgeTone: 'alert' },
  { iconKey: 'book', label: 'Knowledge', href: '#dataroom', badge: 24, badgeTone: 'count' },
  { iconKey: 'dollar', label: 'Finanze', href: '#dataroom' },
  { iconKey: 'chat', label: 'Co-pilot', href: '#loops', streaming: true },
];

export function DemoNavRail() {
  return (
    <div
      style={{
        width: 54,
        flexShrink: 0,
        borderRight: '1px solid var(--line)',
        background: 'var(--paper-2)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '8px 0',
        gap: 2,
      }}
    >
      {RAIL_ITEMS.map((it) => <DemoRailItem key={it.label} {...it} />)}
      <div aria-hidden style={{ width: 28, height: 1, background: 'var(--line)', margin: '6px 0', flexShrink: 0 }} />
      {RAIL_CHANNELS.map((it) => <DemoRailItem key={it.label} {...it} />)}
      <div style={{ flex: 1, minHeight: 6 }} />
      <div
        title="Demo — account di esempio"
        style={{
          flexShrink: 0, width: 28, height: 28, borderRadius: 14,
          background: 'var(--ink)', color: 'var(--paper)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 600, fontFamily: 'var(--f-mono)', marginTop: 6,
        }}
      >
        ML
      </div>
    </div>
  );
}

function DemoRailItem({ iconKey, label, href, badge, badgeTone = 'alert', streaming, active }: (typeof RAIL_ITEMS)[number]) {
  const isCount = badgeTone === 'count';
  return (
    <a
      href={href}
      title={`${label} — demo`}
      style={{
        width: 42,
        padding: '8px 0',
        borderRadius: 'var(--r-m)',
        cursor: 'pointer',
        background: active ? 'var(--surface)' : 'transparent',
        boxShadow: active ? 'inset 0 0 0 1px var(--line)' : 'none',
        color: active ? 'var(--ink)' : 'var(--ink-4)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        textDecoration: 'none',
        position: 'relative',
      }}
    >
      <Icon d={I[iconKey]} size={15} stroke={1.3} />
      {typeof badge === 'number' && badge > 0 && (
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
          {badge}
        </span>
      )}
      {streaming && (
        <span className="lp-dot lp-pulse" style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, background: 'var(--accent)' }} />
      )}
      <span style={{ fontSize: 9, fontFamily: 'var(--f-mono)', letterSpacing: -0.2, textTransform: 'uppercase' }}>
        {label}
      </span>
    </a>
  );
}

// =============================================================================
// Header strip — project identity + headline metrics
// =============================================================================

export function HeaderStrip() {
  return (
    <header id="top" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="lp-serif" style={{ margin: 0, fontSize: 28, fontWeight: 400, letterSpacing: -0.6, lineHeight: 1.1 }}>
          {PROJECT.name}
        </h1>
        <span style={{ fontSize: 13, color: 'var(--ink-4)' }}>{PROJECT.tagline}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <Pill kind="live" dot>{PROJECT.stagePill}</Pill>
        <Pill kind="ok" dot>{PROJECT.irl}</Pill>
        <Pill kind="n">{PROJECT.age}</Pill>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginTop: 16,
        }}
      >
        {HEADLINE_METRICS.map((m) => (
          <MetricTile key={m.label} label={m.label} value={m.value} delta={m.delta} sparkData={m.spark} kind={m.kind} />
        ))}
      </div>
    </header>
  );
}

// =============================================================================
// Spine — the 7 canonical stages, all validated except Operate (active)
// =============================================================================

export function SpineSection() {
  return (
    <Panel
      title="La Spina — 7 stage"
      subtitle="35 controlli di evidenza · niente diventa verde senza il sì del founder"
      right={<Pill kind="ok" dot>6/7 validati</Pill>}
      style={{ scrollMarginTop: 12 }}
    >
      <div id="spine" style={{ padding: '12px 14px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 8,
          }}
        >
          {STAGES.map((s) => (
            <div
              key={s.n}
              style={{
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-m)',
                background: s.active ? 'var(--accent-wash)' : s.done ? 'var(--moss-wash)' : 'var(--paper-2)',
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}
            >
              <div className="lp-mono" style={{ fontSize: 9, color: 'var(--ink-5)', letterSpacing: 0.4 }}>
                STAGE {s.n}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2 }}>{s.label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--ink-4)' }}>
                {s.done ? (
                  <>
                    <Icon d={I.check} size={11} stroke={2} style={{ color: 'var(--moss)' }} />
                    validato
                  </>
                ) : (
                  <>
                    <span className="lp-dot lp-pulse" style={{ background: 'var(--accent)' }} />
                    attivo
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Expanded evidence for the Validation Gate (1A ∥ 1B → 1C) */}
        <div
          style={{
            marginTop: 12,
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-m)',
            background: 'var(--surface)',
            padding: '10px 12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600 }}>Stage 2 · Validation Gate</span>
            <span style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>1A e 1B in parallelo · 1C si sblocca dopo</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {GATE_TRACKS.map((track) => (
              <div key={track.id}>
                <div className="lp-mono" style={{ fontSize: 9.5, color: 'var(--ink-4)', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 }}>
                  {track.label}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {track.checks.map((c) => (
                    <div key={c.text} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <Icon d={I.check} size={11} stroke={2} style={{ color: 'var(--moss)', flexShrink: 0, marginTop: 2 }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{c.text}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{c.proof}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

// =============================================================================
// Loop timeline — the vision centerpiece: Loops 1-4 with verdicts
// =============================================================================

const VERDICT_PILL: Record<Verdict, PillKind> = {
  GO: 'ok',
  PIVOT: 'warn',
  STOP: 'warn',
  'LAUNCH READY': 'live',
};

export function LoopTimeline() {
  return (
    <Panel
      title="Loop di Validazione"
      subtitle="la macchina anti-sequenza-sbagliata: ogni fase è protetta da un loop"
      right={<Pill kind="live" dot>LAUNCH READY</Pill>}
      style={{ scrollMarginTop: 12 }}
    >
      <div id="loops" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {LOOPS.map((loop, i) => (
          <div key={loop.id} style={{ display: 'flex', gap: 12 }}>
            {/* timeline gutter */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16, flexShrink: 0 }}>
              <span
                className="lp-dot"
                style={{
                  width: 8, height: 8, marginTop: 6,
                  background: loop.verdict === 'PIVOT' ? 'var(--clay)' : loop.verdict === 'LAUNCH READY' ? 'var(--accent)' : 'var(--moss)',
                }}
              />
              {i < LOOPS.length - 1 && <span style={{ flex: 1, width: 1, background: 'var(--line)', marginTop: 4 }} />}
            </div>
            {/* card */}
            <div style={{ flex: 1, minWidth: 0, paddingBottom: i < LOOPS.length - 1 ? 14 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{loop.title}</span>
                <span style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{loop.subtitle}</span>
                <span style={{ flex: 1 }} />
                {!loop.live && <Pill kind="n">visione</Pill>}
                <Pill kind={VERDICT_PILL[loop.verdict]} dot>{loop.verdict}</Pill>
              </div>
              <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', marginTop: 4 }}>
                trigger · {loop.trigger}
              </div>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {loop.body.map((line, j) => (
                  <p key={j} style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>
                    {line}
                  </p>
                ))}
              </div>
              {loop.evidenceMatrix && (
                <div
                  style={{
                    marginTop: 8,
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-m)',
                    overflow: 'hidden',
                    maxWidth: 460,
                  }}
                >
                  <div className="lp-mono" style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-4)', background: 'var(--paper-2)', padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>
                    Evidence Matrix
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ color: 'var(--ink-5)', textAlign: 'left' }}>
                        <th style={{ padding: '4px 10px', fontWeight: 500 }}>Segnale</th>
                        <th style={{ padding: '4px 10px', fontWeight: 500 }}>Prima</th>
                        <th style={{ padding: '4px 10px', fontWeight: 500 }}>Dopo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loop.evidenceMatrix.map((row) => (
                        <tr key={row.signal} style={{ borderTop: '1px solid var(--line)' }}>
                          <td style={{ padding: '4px 10px', color: 'var(--ink-3)' }}>{row.signal}</td>
                          <td className="lp-mono" style={{ padding: '4px 10px', color: 'var(--clay)' }}>{row.before}</td>
                          <td className="lp-mono" style={{ padding: '4px 10px', color: 'var(--moss)' }}>{row.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// =============================================================================
// Data Room — Modulo Trasversale assets (list mirrors DataRoomPanel rows)
// =============================================================================

export function DataRoomSection() {
  return (
    <Panel
      title="Data Room"
      subtitle="Modulo Trasversale — asset finanziari e pitch"
      right={<Pill kind="ok" dot>completo</Pill>}
      style={{ scrollMarginTop: 12 }}
    >
      <div id="dataroom">
        {DATA_ROOM.map((doc, i) => (
          <div
            key={doc.name}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 14px',
              borderTop: i > 0 ? '1px solid var(--line)' : 'none',
            }}
          >
            <Icon d={I[doc.icon]} size={13} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 500 }}>{doc.name}</div>
              <div style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{doc.meta}</div>
            </div>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)', flexShrink: 0 }}>{doc.version}</span>
          </div>
        ))}
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--line)', fontSize: 10.5, color: 'var(--ink-5)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon d={I.users} size={12} style={{ color: 'var(--ink-4)' }} />
          {DATA_ROOM_FOOT}
        </div>
      </div>
    </Panel>
  );
}

// =============================================================================
// Growth engine — funnel + running campaigns/loops
// =============================================================================

export function GrowthSection() {
  return (
    <Panel
      title="Launch Pipeline"
      subtitle="W0-W5 — pubblica · campagne · ads e social · misura · growth loop"
      right={<Pill kind="live" dot>attiva</Pill>}
      style={{ scrollMarginTop: 12 }}
    >
      <div id="growth" style={{ padding: '12px 14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
          {GROWTH_FUNNEL.map((m) => (
            <MetricTile key={m.label} label={m.label} value={m.value} delta={m.delta} kind={m.kind} />
          ))}
        </div>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column' }}>
          {GROWTH_ITEMS.map((g, i) => (
            <div
              key={g.title}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}
            >
              <span
                className="lp-mono"
                style={{
                  fontSize: 9, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: 0.3,
                  border: '1px solid var(--line)', borderRadius: 'var(--r-s)',
                  background: 'var(--paper-2)', padding: '2px 4px', width: 26,
                  textAlign: 'center', flexShrink: 0, boxSizing: 'border-box',
                }}
              >
                {g.week}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 500 }}>{g.title}</div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{g.meta}</div>
              </div>
              <Pill kind={g.kind} dot>{g.state}</Pill>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--line)', fontSize: 10.5, color: 'var(--ink-5)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon d={I.send} size={11} style={{ color: 'var(--ink-4)' }} />
          Ogni invio passa da una proposta in Inbox: il cron propone, il founder approva, l’esecutore invia — un solo punto di uscita.
        </div>
      </div>
    </Panel>
  );
}

// =============================================================================
// Build hub — auto-iterating MVP
// =============================================================================

export function BuildSection() {
  return (
    <Panel
      title="Build Hub"
      subtitle="gli agenti costruiscono e iterano l’MVP — il founder approva ogni iterazione"
      right={<Pill kind="ok" dot>build #12 live</Pill>}
      style={{ scrollMarginTop: 12 }}
    >
      <div id="build">
        {/* The live app — built by agents, monitored at runtime */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)' }}>
          <Icon d={I.terminal} size={13} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="lp-mono" style={{ fontSize: 11.5, color: 'var(--ink)', fontWeight: 600 }}>{BUILD_APP.url}</div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{BUILD_APP.meta}</div>
          </div>
          <Pill kind="live" dot>online</Pill>
        </div>
        {BUILD_ITERATIONS.map((b) => (
          <div
            key={b.n}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: '1px solid var(--line)' }}
          >
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)', width: 26, flexShrink: 0 }}>#{b.n}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 500 }}>{b.title}</div>
              <div style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{b.meta}</div>
            </div>
            <Pill kind={b.kind} dot>{b.state}</Pill>
          </div>
        ))}
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--line)', fontSize: 10.5, color: 'var(--ink-5)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon d={I.history} size={11} style={{ color: 'var(--ink-4)' }} />
          Ciclo continuo: feedback e errori runtime → il watcher propone l’iterazione → approvi → l’agente costruisce in sandbox → deploy.
        </div>
      </div>
    </Panel>
  );
}

// =============================================================================
// Agent activity — the machine working on its own (cron + watchers + executors)
// =============================================================================

const ACTIVITY_ICON: Record<string, IconKey> = { cron: 'clock', proposta: 'tickets', eseguito: 'check' };

export function ActivitySection() {
  return (
    <Panel
      title="Attività dell'agente"
      subtitle="ultime 48 ore — tutto ciò che esce è passato dalla tua approvazione"
      right={<Pill kind="live" dot>heartbeat</Pill>}
      style={{ scrollMarginTop: 12 }}
    >
      <div id="activity">
        {ACTIVITY.map((a, i) => (
          <div
            key={`${a.when}-${i}`}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 14px', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}
          >
            <Icon
              d={I[ACTIVITY_ICON[a.type] ?? 'clock']}
              size={12}
              style={{ color: a.type === 'eseguito' ? 'var(--moss)' : 'var(--ink-4)', flexShrink: 0, marginTop: 2 }}
            />
            <span className="lp-mono" style={{ fontSize: 9.5, color: 'var(--ink-5)', width: 62, flexShrink: 0, marginTop: 2 }}>{a.when}</span>
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>{a.what}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// =============================================================================
// Intelligence — watchers, alert, ecosystem legend
// =============================================================================

export function IntelSection() {
  return (
    <Panel
      title="Intelligence"
      subtitle="osservatori attivi · scansione settimanale"
      right={<Pill kind="info" dot>Monday Brief</Pill>}
      style={{ scrollMarginTop: 12 }}
    >
      <div id="intel">
        {WATCHERS.map((w, i) => (
          <div
            key={w.title}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}
          >
            <Icon d={I.eye} size={12} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 500 }}>{w.title}</div>
              <div style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{w.meta}</div>
            </div>
            <Pill kind="ok" dot>{w.state}</Pill>
          </div>
        ))}
        <div style={{ margin: '10px 14px', border: '1px solid var(--line)', borderRadius: 'var(--r-m)', background: 'var(--clay-wash)', padding: '8px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: 'var(--ink)' }}>
            <Icon d={I.bell} size={12} style={{ color: 'var(--clay)' }} />
            {INTEL_ALERT.title}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>{INTEL_ALERT.body}</p>
        </div>
        <div style={{ padding: '4px 14px 10px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="lp-mono" style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-5)' }}>Ecosistema</span>
          {ECOSYSTEM.map((e) => (
            <span key={e.label} style={{ fontSize: 10.5, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="lp-dot" style={{ background: 'var(--plum)' }} />
              {e.label} · {e.count}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// =============================================================================
// Inbox preview — pending proposals (propose → approve, never auto-run)
// =============================================================================

export function InboxSection() {
  return (
    <Panel
      title="Inbox"
      subtitle="l'agente propone, il founder approva"
      right={<Pill kind="warn" dot>3 in attesa</Pill>}
      style={{ scrollMarginTop: 12 }}
    >
      <div id="inbox">
        {INBOX.map((a, i) => (
          <div
            key={a.title}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}
          >
            <Icon d={I.tickets} size={12} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--ink-2)' }}>{a.title}</div>
            <Pill kind={a.kind} dot>{a.lane}</Pill>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// =============================================================================
// Footer note — the honest line about what's live vs roadmap
// =============================================================================

export function FooterNote() {
  return (
    <div
      style={{
        border: '1px dashed var(--line-2)',
        borderRadius: 'var(--r-m)',
        background: 'var(--paper-2)',
        padding: '10px 14px',
        fontSize: 11,
        color: 'var(--ink-4)',
        lineHeight: 1.5,
      }}
    >
      {FOOTER_NOTE}
    </div>
  );
}

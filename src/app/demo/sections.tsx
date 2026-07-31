'use client';

/**
 * /demo Home sections — DEMO PURPOSES ONLY. Panels for the demo "today"
 * dashboard (page.tsx). Pure presentation over ./mock.ts; the shared chrome
 * (banner, rail, top/status bars) lives in ./chrome.tsx and ./layout.tsx.
 */

import * as React from 'react';
import { Icon, I, Panel, Pill, MetricTile, type PillKind } from '@/components/design/primitives';
import type { IconKey } from '@/components/design/icons';
import { EcoGraph, EcoLegend } from './chrome';
import {
  PROJECT, HEADLINE_METRICS, SCORE, SPINE, GATE_TRACKS, LOOPS, ACTIVITY,
  WATCHERS, INTEL_ALERT, INBOX, FOOTER_NOTE, type Verdict,
} from './mock';

// Verdict → pill colour, shared by the spine's inline loops and the loop timeline.
const VERDICT_PILL: Record<Verdict, PillKind> = { GO: 'ok', PIVOT: 'warn', STOP: 'warn', 'LAUNCH READY': 'live' };

// =============================================================================
// Header — greeting + project identity + headline metrics
// =============================================================================

export function HeaderStrip() {
  return (
    <header id="top">
      <h1 className="lp-serif" style={{ margin: 0, fontSize: 28, fontWeight: 400, letterSpacing: -0.6, lineHeight: 1.1 }}>
        Buongiorno.
      </h1>
      <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink-4)' }}>
        {PROJECT.name} — {PROJECT.tagline}. 4 elementi in Inbox, 2 segnali da rivedere.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <Pill kind="live" dot>{PROJECT.stagePill}</Pill>
        <Pill kind="ok" dot>{PROJECT.irl}</Pill>
        <Pill kind="n">{PROJECT.age}</Pill>
      </div>
      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 16 }}
      >
        {HEADLINE_METRICS.map((m) => (
          <MetricTile key={m.label} label={m.label} value={m.value} delta={m.delta} sparkData={m.spark} kind={m.kind} />
        ))}
      </div>
    </header>
  );
}

// =============================================================================
// Score — Project Score + IRL (mirrors ScorePanel)
// =============================================================================

export function ScoreSection() {
  return (
    <Panel title="Punteggio" subtitle="del progetto + prontezza all’investimento" right={<Pill kind="ok" dot>{SCORE.band}</Pill>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 0 }}>
        <div style={{ padding: '14px 16px' }}>
          <div className="lp-mono" style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-5)' }}>
            Score del progetto
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '4px 0 10px' }}>
            <span className="lp-serif" style={{ fontSize: 30, fontWeight: 400, letterSpacing: -0.6 }}>{SCORE.total}</span>
            <span style={{ fontSize: 13, color: 'var(--ink-5)' }}>/ 100</span>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--moss)', marginLeft: 4 }}>{SCORE.band}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {SCORE.dimensions.map((d) => (
              <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
                <span style={{ width: 56, height: 4, borderRadius: 2, background: 'var(--paper-3)', overflow: 'hidden', flexShrink: 0 }}>
                  <span style={{ display: 'block', height: '100%', width: `${d.value}%`, background: 'var(--moss)' }} />
                </span>
                <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)', width: 18, textAlign: 'right' }}>{d.value}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.45 }}>{SCORE.recommendation}</p>
        </div>
        <div style={{ padding: '14px 16px', borderLeft: '1px solid var(--line)' }}>
          <div className="lp-mono" style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-5)' }}>
            Prontezza all’investimento (IRL)
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '4px 0 6px' }}>
            <span className="lp-serif" style={{ fontSize: 30, fontWeight: 400, letterSpacing: -0.6 }}>{SCORE.irl.level}</span>
            <span style={{ fontSize: 13, color: 'var(--ink-5)' }}>/ {SCORE.irl.of}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>livello di sviluppo</div>
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.45 }}>
            Attualmente in <strong style={{ color: 'var(--ink-2)' }}>{SCORE.irl.stage}</strong> + Loop 4 (LAUNCH READY). Ogni punto si suda: fasi e loop superati — 7-9 si sbloccano con gli add-on GTM orchestration, Fundraising readiness e Operations.
          </p>
        </div>
      </div>
    </Panel>
  );
}

// =============================================================================
// Spine — the 7 canonical stages, Validation Gate expanded
// =============================================================================

export function SpineSection() {
  const phases = SPINE.filter((n) => n.kind === 'phase').length;
  const loops = SPINE.filter((n) => n.kind === 'loop').length;
  return (
    <Panel
      title={`La Spina — ${phases} fasi macro + ${loops} loop`}
      subtitle="1 modulo trasversale · loop di iterazione nelle transizioni critiche · nulla si sblocca senza il sì del founder"
      right={<Pill kind="live" dot>Loop 4 · Launch Ready</Pill>}
    >
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {SPINE.map((node, i) => {
          // ── Macro phase (0-4) — the prominent row ──────────────────────────
          if (node.kind === 'phase') {
            return (
              <React.Fragment key={i}>
                <div
                  style={{
                    border: '1px solid var(--line)', borderRadius: 'var(--r-m)',
                    background: node.active ? 'var(--accent-wash)' : node.done ? 'var(--moss-wash)' : 'var(--paper-2)',
                    padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 11,
                  }}
                >
                  <div className="lp-mono" style={{ fontSize: 14, fontWeight: 700, color: node.active ? 'var(--accent-ink)' : 'var(--ink-4)', minWidth: 16, textAlign: 'center' }}>{node.n}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2 }}>{node.label}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-5)', marginTop: 2 }}>{node.sub}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--ink-4)', flexShrink: 0 }}>
                    {node.done ? (
                      <><Icon d={I.check} size={12} stroke={2} style={{ color: 'var(--moss)' }} />validato</>
                    ) : (
                      <><span className="lp-dot lp-pulse" style={{ background: 'var(--accent)' }} />attivo</>
                    )}
                  </div>
                </div>
                {node.expanded && <GateExpanded />}
              </React.Fragment>
            );
          }
          // ── Cross-cutting module — indented, accent-dashed connector ────────
          if (node.kind === 'module') {
            return (
              <div key={i} style={{ marginLeft: 20, borderLeft: '2px dashed var(--accent)', paddingLeft: 12, display: 'flex', alignItems: 'center', gap: 8, minHeight: 34 }}>
                <Icon d={I.layers} size={13} stroke={1.6} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)' }}>{node.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--ink-5)' }}>{node.sub}</div>
                </div>
                {node.done && <Icon d={I.check} size={12} stroke={2} style={{ color: 'var(--moss)', flexShrink: 0 }} />}
              </div>
            );
          }
          // ── Iteration loop — indented, sits in the transition ──────────────
          return (
            <div key={i} style={{ marginLeft: 20, borderLeft: '2px solid var(--line-2)', paddingLeft: 12, display: 'flex', alignItems: 'center', gap: 8, minHeight: 34 }}>
              <Icon d={I.history} size={13} stroke={1.6} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)' }}>{node.label}</div>
                <div style={{ fontSize: 10, color: 'var(--ink-5)' }}>{node.sub}</div>
              </div>
              <Pill kind={VERDICT_PILL[node.verdict]}>{node.verdict}</Pill>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// The Validation Gate's expanded evidence (1A ∥ 1B → 1C) — rendered inline
// under phase 1 in the spine timeline.
function GateExpanded() {
  return (
    <div style={{ marginLeft: 20, border: '1px solid var(--line)', borderRadius: 'var(--r-m)', background: 'var(--surface)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600 }}>Fase 1 · Validation Gate</span>
        <span style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>1A e 1B in parallelo · 1C si sblocca dopo</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {GATE_TRACKS.map((track) => (
          <div key={track.id}>
            <div className="lp-mono" style={{ fontSize: 9.5, color: 'var(--ink-4)', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 }}>{track.label}</div>
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
  );
}

// =============================================================================
// Loop timeline — Loops 1-4 with verdicts
// =============================================================================

export function LoopTimeline() {
  return (
    <Panel
      title="Loop di Validazione"
      subtitle="la macchina anti-sequenza-sbagliata: ogni fase è protetta da un loop"
      right={<Pill kind="live" dot>LAUNCH READY</Pill>}
    >
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column' }}>
        {LOOPS.map((loop, i) => (
          <div key={loop.id} style={{ display: 'flex', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16, flexShrink: 0 }}>
              <span className="lp-dot" style={{ width: 8, height: 8, marginTop: 6, background: loop.verdict === 'PIVOT' ? 'var(--clay)' : loop.verdict === 'LAUNCH READY' ? 'var(--accent)' : 'var(--moss)' }} />
              {i < LOOPS.length - 1 && <span style={{ flex: 1, width: 1, background: 'var(--line)', marginTop: 4 }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingBottom: i < LOOPS.length - 1 ? 14 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{loop.title}</span>
                <span style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{loop.subtitle}</span>
                <span style={{ flex: 1 }} />
                {!loop.live && <Pill kind="n">visione</Pill>}
                <Pill kind={VERDICT_PILL[loop.verdict]} dot>{loop.verdict}</Pill>
              </div>
              <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', marginTop: 4 }}>trigger · {loop.trigger}</div>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {loop.body.map((line, j) => (
                  <p key={j} style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>{line}</p>
                ))}
              </div>
              {loop.evidenceMatrix && (
                <div style={{ marginTop: 8, border: '1px solid var(--line)', borderRadius: 'var(--r-m)', overflow: 'hidden', maxWidth: 460 }}>
                  <div className="lp-mono" style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-4)', background: 'var(--paper-2)', padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>
                    Matrice evidenze
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
// Watchers preview (secondary column) — links to Osservatori
// =============================================================================

export function WatchersPreview() {
  return (
    <Panel title="Osservatori" subtitle="scansione settimanale" right={<a href="/demo/inbox" style={{ fontSize: 11, color: 'var(--accent-ink)', textDecoration: 'none' }}>Vedi tutti →</a>}>
      <div>
        {WATCHERS.map((w, i) => (
          <div key={w.title} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
            <Icon d={I.eye} size={12} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 500 }}>{w.title}</div>
              <div style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{w.meta}</div>
            </div>
            <Pill kind="ok" dot>{w.state}</Pill>
          </div>
        ))}
        <div style={{ margin: '8px 14px', border: '1px solid var(--line)', borderRadius: 'var(--r-m)', background: 'var(--clay-wash)', padding: '8px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: 'var(--ink)' }}>
            <Icon d={I.bell} size={11} style={{ color: 'var(--clay)' }} />{INTEL_ALERT.title}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>{INTEL_ALERT.body}</p>
        </div>
      </div>
    </Panel>
  );
}

// =============================================================================
// Inbox preview (secondary column) — links to Osservatori
// =============================================================================

export function InboxPreview() {
  return (
    <Panel title="Da rivedere" subtitle="l'agente propone, tu approvi" right={<a href="/demo/inbox" style={{ fontSize: 11, color: 'var(--accent-ink)', textDecoration: 'none' }}>Vedi tutti (4) →</a>}>
      <div>
        {INBOX.map((a, i) => (
          <div key={a.title} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
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
// Agent activity feed (secondary column)
// =============================================================================

const ACTIVITY_ICON: Record<string, IconKey> = { cron: 'clock', proposta: 'tickets', eseguito: 'check' };

export function ActivitySection() {
  return (
    <Panel title="Attività dell'agente" subtitle="ultime 48 ore" right={<Pill kind="live" dot>heartbeat</Pill>}>
      <div>
        {ACTIVITY.map((a, i) => (
          <div key={`${a.when}-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 14px', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
            <Icon d={I[ACTIVITY_ICON[a.type] ?? 'clock']} size={12} style={{ color: a.type === 'eseguito' ? 'var(--moss)' : 'var(--ink-4)', flexShrink: 0, marginTop: 2 }} />
            <span className="lp-mono" style={{ fontSize: 9.5, color: 'var(--ink-5)', width: 62, flexShrink: 0, marginTop: 2 }}>{a.when}</span>
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>{a.what}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// =============================================================================
// Ecosystem panel — static graph (full width)
// =============================================================================

export function EcosystemSection() {
  return (
    <Panel title="Ecosistema" subtitle="il grafo Conoscenza del progetto" right={<a href="/demo/knowledge" style={{ fontSize: 11, color: 'var(--accent-ink)', textDecoration: 'none' }}>Vedi il grafo →</a>}>
      <div style={{ padding: '4px 0 0' }}>
        <EcoGraph height={300} />
        <div style={{ borderTop: '1px solid var(--line)' }}>
          <EcoLegend />
        </div>
      </div>
    </Panel>
  );
}

// =============================================================================
// Footer note
// =============================================================================

export function FooterNote() {
  return (
    <div style={{ border: '1px dashed var(--line-2)', borderRadius: 'var(--r-m)', background: 'var(--paper-2)', padding: '10px 14px', fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.5 }}>
      {FOOTER_NOTE}
    </div>
  );
}

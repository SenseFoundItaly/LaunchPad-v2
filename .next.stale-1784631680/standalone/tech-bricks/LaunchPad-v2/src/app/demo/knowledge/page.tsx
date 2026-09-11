'use client';

/**
 * /demo/knowledge — DEMO PURPOSES ONLY. The Knowledge surface: competitor
 * matryoshka + a view toggle (Grafo | Lista | Movimenti | Data room),
 * mirroring knowledge/page.tsx, AllKnowledgePanel, RecentMovesFeed and
 * DataRoomPanel. Interactive toggle, zero data fetching.
 */

import * as React from 'react';
import { Icon, I, Pill } from '@/components/design/primitives';
import { EcoGraph, EcoLegend, ECO_NODE_COUNT, ECO_EDGE_COUNT } from '../chrome';
import {
  KNOWLEDGE_SUMMARY, KNOWLEDGE_GROUPS, COMPETITORS_MATRYOSHKA, MOVES, DATA_ROOM, DATA_ROOM_FOOT,
  type KnowledgeRow,
} from '../mock';

type View = 'graph' | 'list' | 'moves' | 'dataroom';

const PROV: Record<KnowledgeRow['prov'], { label: string; kind: 'n' | 'info' | 'ok' }> = {
  founder: { label: 'dichiarato', kind: 'n' },
  derived: { label: 'derivato', kind: 'info' },
  verified: { label: 'verificato', kind: 'ok' },
};

export default function DemoKnowledge() {
  const [view, setView] = React.useState<View>('graph');
  return (
    <div className="lp-rise" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <CompetitorMatryoshka />
      <div style={{ flex: 1, position: 'relative', background: 'var(--paper-2)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 4, padding: '10px 16px', flexShrink: 0 }}>
          <ViewBtn label="Grafo" active={view === 'graph'} onClick={() => setView('graph')} />
          <ViewBtn label="Lista" active={view === 'list'} onClick={() => setView('list')} />
          <ViewBtn label="Movimenti" active={view === 'moves'} onClick={() => setView('moves')} />
          <ViewBtn label="Data room" active={view === 'dataroom'} onClick={() => setView('dataroom')} />
          <span style={{ flex: 1 }} />
          <Pill kind="live" dot>1 in attesa</Pill>
          <Pill kind="n">{ECO_NODE_COUNT} nodi · {ECO_EDGE_COUNT} collegamenti</Pill>
        </div>
        <div className="lp-scroll" style={{ flex: 1, overflow: 'auto' }}>
          {view === 'graph' && <GraphView />}
          {view === 'list' && <ListView />}
          {view === 'moves' && <MovesView />}
          {view === 'dataroom' && <DataRoomView />}
        </div>
      </div>
    </div>
  );
}

function ViewBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px', borderRadius: 'var(--r-m)', border: '1px solid var(--line)', cursor: 'pointer',
        fontSize: 11, fontWeight: active ? 600 : 500,
        background: active ? 'var(--ink)' : 'transparent', color: active ? 'var(--paper)' : 'var(--ink-4)',
      }}
    >
      {label}
    </button>
  );
}

function GraphView() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 360, padding: '0 16px' }}>
        <EcoGraph height={440} />
      </div>
      <div style={{ borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
        <EcoLegend />
      </div>
    </div>
  );
}

function ListView() {
  return (
    <div style={{ padding: 16, maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Pill kind="live" dot>{KNOWLEDGE_SUMMARY.total} elementi</Pill>
        {KNOWLEDGE_SUMMARY.kinds.map((k) => <Pill key={k.label} kind="n">{k.count} {k.label}</Pill>)}
        <span style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 2px' }} />
        {KNOWLEDGE_SUMMARY.provenance.map((p) => <Pill key={p.label} kind={p.kind} dot>{p.label}</Pill>)}
      </div>
      {KNOWLEDGE_GROUPS.map((g) => (
        <section key={g.kind} style={{ border: '1px solid var(--line)', borderLeft: `3px solid ${g.edge}`, borderRadius: 'var(--r-l)', background: 'var(--surface)', overflow: 'hidden' }}>
          <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{g.label}</span>
            <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>{g.rows.length}</span>
          </div>
          {g.rows.map((r, i) => (
            <div key={r.title} style={{ padding: '9px 14px', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>{r.title}</span>
                <Pill kind={PROV[r.prov].kind} dot>{PROV[r.prov].label}</Pill>
                <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>{r.age}</span>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.45 }}>{r.summary}</p>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

const MOVE_COLOR: Record<string, string> = { entity: 'var(--sky)', competitor: 'var(--clay)', fact: 'var(--moss)', signal: 'var(--cat-gold)', brief: 'var(--plum)', interview: 'var(--cat-teal)' };

function MovesView() {
  return (
    <div style={{ padding: 16, maxWidth: 640, margin: '0 auto' }}>
      <div className="lp-mono" style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-5)', marginBottom: 10 }}>{MOVES.length} movimenti recenti</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {MOVES.map((m, i) => (
          <div key={i} style={{ display: 'flex', gap: 10 }}>
            <span className="lp-dot" style={{ background: MOVE_COLOR[m.type], marginTop: 5, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 650, color: 'var(--ink-2)' }}>{m.name}</span>
                <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>{m.date}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>{m.headline}</div>
              <a href="#" style={{ fontSize: 10.5, color: 'var(--accent-ink)', textDecoration: 'none' }} onClick={(e) => e.preventDefault()}>{m.host} ↗</a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DataRoomView() {
  const [sel, setSel] = React.useState(0);
  const doc = DATA_ROOM[sel];
  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: '340px 1fr' }}>
      <div style={{ borderRight: '1px solid var(--line)', overflow: 'auto', background: 'var(--surface)' }}>
        <div className="lp-mono" style={{ fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-5)', padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>Data room · {DATA_ROOM.length}</div>
        {DATA_ROOM.map((d, i) => (
          <div key={d.name} onClick={() => setSel(i)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--line)', cursor: 'pointer', background: i === sel ? 'var(--accent-wash)' : 'transparent' }}>
            <Icon d={I[d.icon]} size={13} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 500 }}>{d.name}</div>
              <div style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{d.meta}</div>
            </div>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{d.version}</span>
          </div>
        ))}
        <div style={{ padding: '8px 14px', fontSize: 10.5, color: 'var(--ink-5)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon d={I.users} size={12} style={{ color: 'var(--ink-4)' }} />{DATA_ROOM_FOOT}
        </div>
      </div>
      <div style={{ overflow: 'auto', padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{doc.name}</h3>
          <Pill kind="n">{doc.version}</Pill>
          <span style={{ flex: 1 }} />
          <Icon d={I.edit} size={14} style={{ color: 'var(--ink-4)' }} />
          <Icon d={I.download} size={14} style={{ color: 'var(--ink-4)' }} />
          <Icon d={I.printer} size={14} style={{ color: 'var(--ink-4)' }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-5)', marginBottom: 12 }}>{doc.meta}</div>
        <pre className="lp-mono" style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.6, whiteSpace: 'pre-wrap', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-m)', padding: '12px 14px' }}>
{`# ${doc.name}  ${doc.version}

Documento generato da LaunchPad per MatchLens.
Anteprima demo — il contenuto reale è indicizzato nel grafo Knowledge
e alimenta le skill del co-pilot.

${doc.meta}`}
        </pre>
      </div>
    </div>
  );
}

function CompetitorMatryoshka() {
  const [open, setOpen] = React.useState<string | null>('Veo');
  return (
    <section style={{ margin: '12px 16px 0', border: '1px solid var(--line)', borderRadius: 'var(--r-l)', background: 'var(--surface)', overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderBottom: '1px solid var(--line)' }}>
        <Icon d={I.layers} size={13} style={{ color: 'var(--ink-4)' }} />
        <span className="lp-mono" style={{ fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 }}>Concorrenti</span>
        <Pill kind="n">{COMPETITORS_MATRYOSHKA.length}</Pill>
      </div>
      <div style={{ maxHeight: '30vh', overflow: 'auto' }}>
        {COMPETITORS_MATRYOSHKA.map((c) => {
          const isOpen = open === c.name;
          return (
            <div key={c.name} style={{ borderBottom: '1px solid var(--line)' }}>
              <div onClick={() => setOpen(isOpen ? null : c.name)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', cursor: 'pointer' }}>
                <Icon d={isOpen ? I.chevd : I.chevr} size={11} style={{ color: 'var(--ink-4)' }} />
                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>{c.name}</span>
                <span style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{c.categories.length} categorie</span>
              </div>
              {isOpen && (
                <div style={{ padding: '0 14px 10px 30px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                  {c.categories.map((cat) => (
                    <div key={cat.label}>
                      <div className="lp-mono" style={{ fontSize: 9, color: 'var(--ink-5)', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 2 }}>{cat.label}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>{cat.detail}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

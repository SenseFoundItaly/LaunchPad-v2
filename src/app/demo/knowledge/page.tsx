'use client';

/**
 * /demo/knowledge — DEMO PURPOSES ONLY. The Knowledge surface: a view toggle
 * (Grafo | Lista | Movimenti | Data room), mirroring knowledge/page.tsx,
 * AllKnowledgePanel, RecentMovesFeed and DataRoomPanel. Interactive toggle,
 * zero data fetching.
 */

import * as React from 'react';
import { Icon, I, Pill } from '@/components/design/primitives';
import { EcoGraph, EcoLegend, DemoNodeDetailPanel, DataRoomView, ECO_NODE_COUNT, ECO_EDGE_COUNT, type EcoEntity } from '../chrome';
import {
  KNOWLEDGE_SUMMARY, KNOWLEDGE_GROUPS, MOVES,
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
      <div style={{ flex: 1, position: 'relative', background: 'var(--paper-2)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 4, padding: '10px 16px', flexShrink: 0 }}>
          <ViewBtn label="Mappa" active={view === 'graph'} onClick={() => setView('graph')} />
          <ViewBtn label="Elenco" active={view === 'list'} onClick={() => setView('list')} />
          <ViewBtn label="Cronologia" active={view === 'moves'} onClick={() => setView('moves')} />
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
  const [detail, setDetail] = React.useState<EcoEntity | null>(null);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* position:relative so the detail panel can overlay the graph's right edge */}
      <div style={{ flex: 1, minHeight: 360, padding: '0 16px', position: 'relative', overflow: 'hidden' }}>
        <EcoGraph height={440} onNodeClick={setDetail} selectedLabel={detail?.label} />
        <DemoNodeDetailPanel node={detail} onClose={() => setDetail(null)} onSelectNeighbor={setDetail} />
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

// DataRoomView lives in ../chrome — shared with the TopBar docs drawer
// (DemoDocsButton) so both surfaces render the same static Data Room.

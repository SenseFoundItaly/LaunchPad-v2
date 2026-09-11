'use client';

/**
 * /demo/inbox — DEMO PURPOSES ONLY. The Inbox / Osservatori surface, mirroring
 * actions/page.tsx: a subhead strip, two lane tabs (Osservatori | Da rivedere),
 * the watcher list, and a selectable proposal list with a detail inspector.
 * Interactive (tab + selection state) but zero data fetching.
 */

import * as React from 'react';
import { Icon, I, Pill } from '@/components/design/primitives';
import { INBOX_SUBHEAD, INBOX_ITEMS, WATCHERS_FULL, type InboxItem, type Watcher } from '../mock';

type Tab = 'watchers' | 'inbox';

export default function DemoInbox() {
  const [tab, setTab] = React.useState<Tab>('watchers');
  const [selected, setSelected] = React.useState<string>(INBOX_ITEMS[0].id);
  const item = INBOX_ITEMS.find((i) => i.id === selected) ?? INBOX_ITEMS[0];

  return (
    <div className="lp-rise" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Subhead */}
      <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--line)', background: 'var(--surface)', fontSize: 12 }}>
        <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{INBOX_SUBHEAD.title}</span>{' '}
        <span style={{ color: 'var(--ink-5)' }}>{INBOX_SUBHEAD.desc}</span>
      </div>

      {/* Lane tabs */}
      <div style={{ display: 'flex', gap: 4, paddingLeft: 12, borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
        <LaneTab label="Osservatori" count={WATCHERS_FULL.length} active={tab === 'watchers'} onClick={() => setTab('watchers')} />
        <LaneTab label="Da rivedere" count={INBOX_ITEMS.length} active={tab === 'inbox'} onClick={() => setTab('inbox')} />
      </div>

      {tab === 'watchers' ? (
        <div className="lp-scroll" style={{ flex: 1, overflow: 'auto', background: 'var(--paper)', padding: '16px 20px' }}>
          <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon d={I.signal} size={13} style={{ color: 'var(--ink-4)' }} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>Osservatori</span>
              <Pill kind="n">{WATCHERS_FULL.length}</Pill>
            </div>
            {WATCHERS_FULL.map((w) => <WatcherCard key={w.name} w={w} />)}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 420px', overflow: 'hidden' }}>
          {/* List */}
          <div className="lp-scroll" style={{ overflow: 'auto', background: 'var(--surface)' }}>
            {INBOX_ITEMS.map((it) => (
              <InboxRow key={it.id} it={it} selected={it.id === selected} onSelect={() => setSelected(it.id)} />
            ))}
          </div>
          {/* Detail */}
          <TicketDetail item={item} />
        </div>
      )}
    </div>
  );
}

function LaneTab({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', background: 'transparent',
        border: 'none', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        color: active ? 'var(--ink)' : 'var(--ink-5)', fontWeight: active ? 600 : 500, fontSize: 12, cursor: 'pointer',
      }}
    >
      {label}
      <Pill kind={active ? 'info' : 'n'}>{count}</Pill>
    </button>
  );
}

function WatcherCard({ w }: { w: Watcher }) {
  return (
    <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-l)', background: 'var(--surface)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
        <Icon d={I.eye} size={13} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{w.name}</span>
        <Pill kind="n">{w.kind}</Pill>
        <Pill kind={w.statusKind} dot>{w.status}</Pill>
      </div>
      <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <Field label="Cosa controlla" value={w.whatChecks} />
        <Field label="Avvisa quando" value={w.alertsWhen} />
        <div>
          <div className="lp-mono" style={{ fontSize: 9, color: 'var(--ink-5)', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 3 }}>Sorgenti</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {w.sources.map((s) => (
              <span key={s} className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)', border: '1px solid var(--line)', borderRadius: 'var(--r-s)', padding: '1px 5px', background: 'var(--paper-2)' }}>{s}</span>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: '1px solid var(--line)', background: 'var(--paper-2)' }}>
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>{w.cadence} · ultima {w.lastRun}</span>
        <span style={{ flex: 1 }} />
        {w.alerts > 0 ? <Pill kind="warn" dot>{w.lastVerdict}</Pill> : <span style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{w.lastVerdict}</span>}
        <button style={ghostBtn}>Esegui ora</button>
        <button style={ghostBtn}>Pausa</button>
      </div>
    </section>
  );
}

function InboxRow({ it, selected, onSelect }: { it: InboxItem; selected: boolean; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      style={{
        padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 12,
        cursor: 'pointer', background: selected ? 'var(--accent-wash)' : 'transparent',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span className="lp-mono" style={{ fontSize: 9, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: 0.3, border: '1px solid var(--line-2)', borderRadius: 999, padding: '1px 6px', background: 'var(--paper)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span className="lp-dot" style={{ background: 'var(--plum)', width: 4, height: 4 }} />{it.typeChip}
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{it.brief}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
        <button style={{ ...applyBtn }}>{it.applyLabel.length > 14 ? 'Applica' : it.applyLabel}</button>
        <button style={ghostBtn}>Ignora</button>
      </div>
    </div>
  );
}

function TicketDetail({ item }: { item: InboxItem }) {
  return (
    <div className="lp-scroll" style={{ borderLeft: '1px solid var(--line)', overflow: 'auto', background: 'var(--surface)' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Pill kind="live" dot>In attesa</Pill>
          <Pill kind="n">{item.producer}</Pill>
        </div>
        <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', marginBottom: 6 }}>T-{item.id} · {item.age}</div>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.25 }}>{item.title}</h3>
      </div>
      <Section label="Brief"><p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>{item.brief}</p></Section>
      <Section label="Dettagli">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {item.detail.map((d) => (
            <div key={d.label} style={{ display: 'flex', gap: 8, fontSize: 11.5 }}>
              <span style={{ color: 'var(--ink-5)', width: 108, flexShrink: 0 }}>{d.label}</span>
              <span style={{ color: 'var(--ink-2)' }}>{d.value}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section label="Cosa aggiunge al tuo progetto">
        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>{item.adds}</p>
      </Section>
      <div style={{ padding: '12px 18px', display: 'flex', gap: 8 }}>
        <button style={{ ...applyBtn, padding: '8px 14px' }}>{item.applyLabel}</button>
        <button style={{ ...ghostBtn, padding: '8px 14px' }}>Ignora</button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="lp-mono" style={{ fontSize: 9, color: 'var(--ink-5)', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>{value}</div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="lp-mono" style={{ fontSize: 9.5, color: 'var(--ink-5)', letterSpacing: 0.4, textTransform: 'uppercase', padding: '8px 18px 4px', background: 'var(--paper-2)' }}>{label}</div>
      <div style={{ padding: '8px 18px 12px' }}>{children}</div>
    </div>
  );
}

const applyBtn: React.CSSProperties = {
  background: 'var(--moss)', color: 'var(--on-accent)', border: 'none', borderRadius: 'var(--r-m)',
  padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
};
const ghostBtn: React.CSSProperties = {
  background: 'transparent', color: 'var(--ink-3)', border: '1px solid var(--line)', borderRadius: 'var(--r-m)',
  padding: '5px 12px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
};

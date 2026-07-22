'use client';

/**
 * /demo/chat — DEMO PURPOSES ONLY. The Co-pilot: a chat column + a right pane
 * with the surface-tab system from origin/staging-launch-plus-build
 * (Co-pilot | Build & Launch | Growth). The Canvas tab mirrors Canvas.tsx;
 * the Build tab mirrors BuildHub/CurrentBuildCard/IterationTimeline; the
 * Growth tab mirrors LaunchPanel (published assets, campaigns, growth loops).
 * Scripted content, zero data fetching.
 */

import * as React from 'react';
import { Icon, I, Pill, type PillKind } from '@/components/design/primitives';
import {
  CHAT_MESSAGES, AGENT_META, CANVAS_FIELDS, CANVAS_DEPTS, BUILD_CURRENT, BUILD_THREAD,
  LAUNCH_ASSETS, LAUNCH_CAMPAIGNS, LAUNCH_LOOPS,
} from '../mock';
import { MockLanding } from './landing';

type SurfaceTab = 'chat' | 'build' | 'growth';

export default function DemoChat() {
  const [tab, setTab] = React.useState<SurfaceTab>('chat');
  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <ChatColumn />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--paper-2)' }}>
        {/* Surface tabs */}
        <div style={{ display: 'flex', gap: 2, padding: '8px 20px 0', borderBottom: '1px solid var(--line)', background: 'var(--paper)', flexShrink: 0 }}>
          <SurfaceTabBtn label="Co-pilot" active={tab === 'chat'} onClick={() => setTab('chat')} />
          <SurfaceTabBtn label="Build & Launch" active={tab === 'build'} onClick={() => setTab('build')} />
          <SurfaceTabBtn label="Growth" active={tab === 'growth'} onClick={() => setTab('growth')} />
        </div>
        <div className="lp-scroll" style={{ flex: 1, overflow: 'auto' }}>
          {tab === 'chat' && <CanvasPane />}
          {tab === 'build' && <BuildPane />}
          {tab === 'growth' && <GrowthPane />}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Chat column
// -----------------------------------------------------------------------------

function ChatColumn() {
  return (
    <div style={{ width: 440, flexShrink: 0, borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
      <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="lp-serif" style={{ fontSize: 20, fontWeight: 400 }}>MatchLens</span>
          <span className="lp-dot lp-pulse" style={{ background: 'var(--moss)' }} />
        </div>
        <div className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-5)', marginTop: 2 }}>MVP Release & Launch · crescita post-launch</div>
      </div>
      <div className="lp-scroll" style={{ flex: 1, overflow: 'auto', padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {CHAT_MESSAGES.map((m, i) => m.role === 'user' ? <UserMsg key={i} body={m.body} /> : <AiMsg key={i} agent={m.agent} body={m.body} tools={m.tools} />)}
      </div>
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)', borderRadius: 'var(--r-l)', background: 'var(--surface)', padding: '8px 10px' }}>
          <Icon d={I.plus} size={15} style={{ color: 'var(--ink-4)' }} />
          <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-5)' }}>Scrivi al co-pilot…</span>
          <Icon d={I.send} size={15} style={{ color: 'var(--ink-4)' }} />
        </div>
      </div>
    </div>
  );
}

function UserMsg({ body }: { body: string }) {
  return (
    <div style={{ alignSelf: 'flex-end', maxWidth: '82%', background: 'var(--ink)', color: 'var(--paper)', borderRadius: 12, padding: '8px 12px', fontSize: 13, lineHeight: 1.45 }}>
      {body}
    </div>
  );
}

function AiMsg({ agent, body, tools }: { agent: string; body: string; tools?: string[] }) {
  const meta = AGENT_META[agent] ?? { name: agent, color: 'var(--sky)' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 18, height: 18, borderRadius: 5, background: meta.color, color: 'var(--on-accent)', fontSize: 9, fontWeight: 700, fontFamily: 'var(--f-mono)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{agent}</span>
        <span style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{meta.name}</span>
      </div>
      {tools && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {tools.map((t) => <span key={t} className="lp-chip" style={{ fontSize: 9.5 }}>{t}</span>)}
        </div>
      )}
      <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>{renderBold(body)}</div>
    </div>
  );
}

// Render **bold** spans as React nodes (no dangerouslySetInnerHTML).
function renderBold(s: string): React.ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{part}</React.Fragment>
  );
}

function SurfaceTabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="lp-mono"
      style={{
        padding: '8px 12px', background: 'transparent', border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        color: active ? 'var(--ink)' : 'var(--ink-5)', fontSize: 11, fontWeight: active ? 700 : 500,
        letterSpacing: 0.2, cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Canvas pane
// -----------------------------------------------------------------------------

function CanvasPane() {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Idea canvas header */}
      <div className="lp-card" style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Icon d={I.layers} size={13} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>Idea canvas</span>
          <span style={{ flex: 1 }} />
          <span className="lp-chip" style={{ fontSize: 10 }}>backed by 29 elementi →</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {CANVAS_FIELDS.map((f, i) => (
            <div key={f.label} style={{ gridColumn: i === CANVAS_FIELDS.length - 1 && CANVAS_FIELDS.length % 2 === 1 ? '1 / -1' : 'auto' }}>
              <div className="lp-mono" style={{ fontSize: 9, color: 'var(--ink-5)', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 2 }}>{f.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>{f.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Knowledge summary row */}
      <div className="lp-card" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon d={I.graph} size={13} style={{ color: 'var(--ink-4)' }} />
        <span className="lp-serif" style={{ fontSize: 14 }}>Knowledge</span>
        <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-5)' }}>— 29 elementi</span>
        <span style={{ flex: 1 }} />
        <a href="/demo/knowledge" style={{ fontSize: 11, color: 'var(--accent-ink)', textDecoration: 'none' }}>apri →</a>
      </div>

      {/* Department sections */}
      {CANVAS_DEPTS.map((d) => (
        <div key={d.dept}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span className="lp-serif" style={{ fontSize: 15 }}>{d.dept}</span>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>· {d.artifacts.length}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {d.artifacts.map((a) => (
              <div key={a.title} className="lp-card" style={{ padding: '10px 12px' }}>
                <div className="lp-mono" style={{ fontSize: 9, color: 'var(--ink-5)', letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 4 }}>{a.kind}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 500, lineHeight: 1.3 }}>{a.title}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Build pane (BuildHub embedded)
// -----------------------------------------------------------------------------

function BuildPane() {
  return (
    <div style={{ padding: 20, maxWidth: 920, margin: '0 auto' }}>
      {/* Current build card */}
      <section style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 18, background: 'var(--paper-2)', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--surface)' }}>Iterazione {BUILD_CURRENT.iteration}</span>
          <span className="lp-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--moss)', border: '1px solid var(--line)', borderRadius: 999, padding: '2px 10px' }}>{BUILD_CURRENT.status}</span>
          <span style={{ flex: 1 }} />
          <a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: 11, color: 'var(--sky)', textDecoration: 'none' }}>Apri app live ↗</a>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 8 }}>Anteprima live · {BUILD_CURRENT.liveUrl}</div>
        {/* Live preview — a mock browser frame with a scrollable landing page,
            standing in for the real BuildHub iframe of the agent-built app. */}
        <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: 'var(--paper)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
            <span style={{ display: 'flex', gap: 5 }}>
              {['var(--clay)', 'var(--accent)', 'var(--moss)'].map((c) => <span key={c} className="lp-dot" style={{ background: c, width: 8, height: 8 }} />)}
            </span>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 10px', flex: 1, textAlign: 'center' }}>{BUILD_CURRENT.liveUrl}</span>
            <Icon d={I.external} size={12} style={{ color: 'var(--ink-5)' }} />
          </div>
          <div className="lp-scroll" style={{ height: 420, overflow: 'auto' }}>
            <MockLanding />
          </div>
        </div>
        {/* Changes */}
        <div style={{ marginTop: 12 }}>
          <div className="lp-mono" style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-5)', marginBottom: 6 }}>Modifiche</div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {BUILD_CURRENT.changes.map((c) => (
              <li key={c.path} style={{ fontSize: 11 }}>
                <code className="lp-mono" style={{ color: 'var(--ink-2)' }}>{c.path}</code>{' '}
                <span style={{ color: 'var(--ink-5)' }}>({c.change})</span>
              </li>
            ))}
          </ul>
        </div>
        {/* Iterate box */}
        <div style={{ marginTop: 14, border: '1px dashed var(--line-2)', borderRadius: 'var(--r-m)', padding: '10px 12px', background: 'var(--surface)' }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.45 }}>
            <Icon d={I.chat} size={11} style={{ color: 'var(--ink-4)', marginRight: 4, verticalAlign: '-1px' }} />
            Per cambiare questa build, descrivi la modifica al co-pilot — la nuova versione appare qui. L’iterazione <strong style={{ color: 'var(--ink-2)' }}>#13 (highlights WhatsApp)</strong> è in attesa di approvazione nel tuo Inbox.
          </div>
        </div>
      </section>

      {/* Iteration timeline */}
      <section style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 18, background: 'var(--paper-2)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Conversazione build</div>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {BUILD_THREAD.map((t) => (
            <li key={t.n} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ width: 22, height: 22, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-4)', fontSize: 10, fontFamily: 'var(--f-mono)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{t.n}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.35 }}>{t.n === 1 ? 'Build iniziale' : t.label}</div>
                <div className="lp-mono" style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.4, color: t.status === 'proposto' ? 'var(--accent)' : 'var(--ink-5)' }}>{t.status}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Growth pane (LaunchPanel)
// -----------------------------------------------------------------------------

function GrowthPane() {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-4)' }}>
        <Icon d={I.signal} size={12} stroke={1.4} />
        La tua lane di esecuzione: pagine pubblicate, campagne e growth loop. Niente parte o pubblica senza la tua approvazione.
      </div>

      <LaunchSection title="Asset pubblicati" hint="pagine live + raccolta iscrizioni">
        {LAUNCH_ASSETS.map((a) => (
          <LaunchRow key={a.title}>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-2)' }}>{a.title}</span>
            {a.signups > 0 && <span className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{a.signups} iscrizioni</span>}
            {a.watched && <span className="lp-mono" style={{ fontSize: 10.5, color: 'var(--moss)' }}>monitorata</span>}
            <Pill kind="n" dot>{a.publisher}</Pill>
            <a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: 11, color: 'var(--accent-ink)', textDecoration: 'none' }}>Live ↗</a>
          </LaunchRow>
        ))}
      </LaunchSection>

      <LaunchSection title="Campagne" hint="ogni invio è approvato nel tuo Inbox">
        {LAUNCH_CAMPAIGNS.map((c) => (
          <LaunchRow key={c.title}>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', width: 42, flexShrink: 0 }}>{c.kind}</span>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
            {c.kind !== 'ads' && <span className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{c.sent}/{c.total}</span>}
            <Pill kind={c.statusKind} dot>{c.status}</Pill>
            {c.action && <button style={c.action === 'Attiva' ? launchPrimaryBtn : launchGhostBtn}>{c.action}</button>}
          </LaunchRow>
        ))}
      </LaunchSection>

      <LaunchSection title="Growth loop" hint="itera → le proposte arrivano nell'Inbox">
        {LAUNCH_LOOPS.map((l) => (
          <LaunchRow key={l.metric}>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--ink-2)' }}>{l.metric}</span>
            <span className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>{l.from} → {l.to}</span>
            <Pill kind={l.statusKind} dot>{l.status}</Pill>
            {l.status === 'attiva' && <button style={launchGhostBtn}>Itera</button>}
          </LaunchRow>
        ))}
      </LaunchSection>
    </div>
  );
}

function LaunchSection({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-l)', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h2 className="lp-mono" style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--ink-3)' }}>{title}</h2>
        <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>{hint}</span>
      </div>
      <div style={{ padding: '4px 16px 12px' }}>{children}</div>
    </section>
  );
}

function LaunchRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>{children}</div>;
}

const launchPrimaryBtn: React.CSSProperties = {
  background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', borderRadius: 999,
  padding: '3px 12px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
};
const launchGhostBtn: React.CSSProperties = {
  background: 'transparent', color: 'var(--accent-ink)', border: '1px solid var(--line)', borderRadius: 999,
  padding: '3px 12px', fontSize: 10.5, cursor: 'pointer',
};

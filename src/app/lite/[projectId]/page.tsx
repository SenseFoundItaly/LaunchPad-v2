'use client';

/**
 * Launchpad Lite — the kickoff.
 *
 * Talk on the left, work on the right. Three questions, five pillars, and the
 * pillars fill in while the founder is still typing — watching the document
 * write itself IS the product, so nothing here batches to the end.
 *
 * Fully isolated from the main app on purpose: its own route, its own API
 * (`/api/lite/…`), its own store (`north_star`). It mounts no NavRail, no
 * TopBar, no Canvas, no spine. Nothing in `src/app/project/**` imports this and
 * this imports nothing from there — so the lite flow can be reshaped, or
 * deleted, without touching the product that pays the bills.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { use } from 'react';

interface Pillar {
  id: string;
  label: string;
  labelIt: string;
  source: 'asked' | 'inferred';
  value: string | null;
  promotedAt: string | null;
}
interface Progress { answered: number; total: number; complete: boolean; currentQuestion: number | null }
interface Msg { id: string; role: string; content: string }

const STAGES = ['Your fit', 'Your take', 'The problem'];

export default function LiteKickoffPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [progress, setProgress] = useState<Progress>({ answered: 0, total: 3, complete: false, currentQuestion: 1 });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opened = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadNorthStar = useCallback(async () => {
    const r = await fetch(`/api/lite/${projectId}/north-star`).then((x) => x.json()).catch(() => null);
    const d = r?.data ?? r;
    if (d?.pillars) {
      setPillars(d.pillars);
      // Pillar count only — `currentQuestion` comes from the stream, which
      // knows about the turn in flight; this read does not.
      setProgress((prev) => ({ ...prev, answered: d.progress.answered, complete: d.progress.complete }));
    }
  }, [projectId]);

  /**
   * One turn, streamed.
   *
   * Text lands token by token, and a `pillar_written` frame refreshes the panel
   * MID-REPLY — the founder watches a pillar appear while Otto is still
   * talking, which is the moment the whole flow exists for. Waiting for the
   * turn to end would throw that away.
   */
  const send = useCallback(async (message: string) => {
    setBusy(true); setError(null);
    if (message) setMessages((m) => [...m, { id: `u_${Date.now()}`, role: 'user', content: message }]);

    const replyId = `a_${Date.now()}`;
    let started = false;

    try {
      const res = await fetch(`/api/lite/${projectId}/kickoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (!res.ok || !res.body) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Keep the trailing partial frame in the buffer — a JSON object split
        // across two chunks must not be parsed (or dropped) as if complete.
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }

          if (typeof ev.content === 'string' && ev.content) {
            const delta = ev.content;
            setMessages((m) => {
              if (!started) { started = true; return [...m, { id: replyId, role: 'assistant', content: delta }]; }
              return m.map((x) => (x.id === replyId ? { ...x, content: x.content + delta } : x));
            });
          }
          // A pillar just hit the database — show it now, not at the end.
          if (ev.pillar_written) void loadNorthStar();
          if (ev.progress) setProgress(ev.progress as Progress);
          if (typeof ev.error === 'string') setError(ev.error);
        }
      }
      // Final reconcile: covers a pillar written in the last frames.
      await loadNorthStar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [projectId, loadNorthStar]);

  // Resume the thread, or open the interview if it has never started.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    (async () => {
      const r = await fetch(`/api/lite/${projectId}/kickoff`).then((x) => x.json()).catch(() => null);
      const d = r?.data ?? r;
      if (d?.messages?.length) {
        setMessages(d.messages);
        if (d.progress) setProgress(d.progress);
        await loadNorthStar();
      } else {
        await loadNorthStar();
        await send('');           // empty message = "open the interview"
      }
    })();
  }, [projectId, send, loadNorthStar]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const submit = () => { const t = input.trim(); if (!t || busy) return; setInput(''); void send(t); };

  return (
    // height:100% (not 100vh) so the two panes fill the <main> they are given.
    // 100vh overflowed whenever anything sat above us, pushing the composer off
    // the bottom of the screen.
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.1fr)', height: '100%', minHeight: 0, background: 'var(--paper)' }}>
      {/* ── LEFT: the conversation ─────────────────────────────────────── */}
      <section style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--line)', minWidth: 0, minHeight: 0 }}>
        <header style={{ padding: '14px 20px 10px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <span className="lp-mono" style={{ fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              Kickoff
            </span>
            <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-5)' }}>
              {progress.complete ? 'Done' : `Question ${progress.currentQuestion ?? 1} of ${progress.total}`}
            </span>
          </div>
          {/* Progress is DERIVED from the pillars — it cannot disagree with them. */}
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {STAGES.map((s, i) => (
              <div key={s} style={{ flex: 1 }}>
                <div style={{ height: 3, borderRadius: 2, background: i < progress.answered ? 'var(--moss)' : 'var(--line-2)' }} />
                <div style={{ fontSize: 9.5, marginTop: 5, color: i < progress.answered ? 'var(--ink-3)' : 'var(--ink-5)' }}>{s}</div>
              </div>
            ))}
          </div>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.map((m) => (
            <div key={m.id} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
              <div style={{
                fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--ink)',
                background: m.role === 'user' ? 'var(--paper-2)' : 'transparent',
                padding: m.role === 'user' ? '10px 13px' : 0,
                borderRadius: m.role === 'user' ? 10 : 0,
              }}>{m.content}</div>
            </div>
          ))}
          {busy && <div className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-5)' }}>Thinking…</div>}
          {error && <div style={{ fontSize: 12, color: 'var(--clay)' }}>{error}</div>}
          <div ref={endRef} />
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: 14 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={progress.complete ? 'Anything else?' : 'Answer…'}
            rows={3}
            style={{
              width: '100%', resize: 'none', border: '1px solid var(--line-2)', borderRadius: 10,
              padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit', background: 'var(--paper)', color: 'var(--ink)',
            }}
          />
        </div>
      </section>

      {/* ── RIGHT: the document writing itself ─────────────────────────── */}
      <section style={{ overflowY: 'auto', minHeight: 0, padding: '30px 34px', background: 'var(--surface)' }}>
        <div className="lp-mono" style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-5)' }}>
          My North Star
        </div>
        <h1 className="lp-serif" style={{ fontSize: 25, margin: '6px 0 4px', color: 'var(--ink)', fontWeight: 400 }}>
          The five pillars of what you&apos;re building
        </h1>
        <p style={{ fontSize: 12, color: 'var(--ink-5)', margin: '0 0 22px' }}>
          {progress.answered === 0
            ? 'Blank until you answer — then it fills in as you talk, and it stays yours.'
            : 'Yours to edit. It keeps growing from here.'}
        </p>

        {pillars.map((p) => (
          <div key={p.id} style={{ borderTop: '1px solid var(--line)', padding: '16px 0' }}>
            <div style={{ display: 'flex', gap: 14 }}>
              <span className="lp-serif" style={{ fontSize: 17, color: 'var(--ink-5)', minWidth: 26 }}>{p.id}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="lp-mono" style={{ fontSize: 9.5, letterSpacing: 0.9, textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  {p.label}
                </div>
                {p.value ? (
                  <div style={{
                    fontSize: 13.5, lineHeight: 1.6, marginTop: 7, color: 'var(--ink-2)',
                    // Pillar 02 is the founder's own sentence — quote it, don't restyle it.
                    fontStyle: p.id === '02' ? 'italic' : 'normal',
                    borderLeft: p.id === '02' ? '2px solid var(--moss)' : 'none',
                    paddingLeft: p.id === '02' ? 11 : 0,
                  }}>{p.value}</div>
                ) : (
                  <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[92, 76, 58].map((w) => (
                      <div key={w} style={{ height: 8, width: `${w}%`, borderRadius: 4, background: 'var(--line-2)', opacity: 0.6 }} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

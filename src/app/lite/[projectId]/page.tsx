'use client';

/**
 * Launchpad Lite — the kickoff and the audit.
 *
 * Talk on the left, work on the right. Three questions fill five pillars, and
 * one audit pass fills all seven sections — each with the risk that would make
 * it wrong. Everything lands live: watching the document write itself IS the
 * product, so nothing here batches to the end.
 *
 * Fully isolated from the main app on purpose: its own route, its own API
 * (`/api/lite/…`), its own store (`north_star`). It mounts no NavRail, no
 * TopBar, no Canvas, no spine. Nothing in `src/app/project/**` imports this and
 * this imports nothing from there — so the lite flow can be reshaped, or
 * deleted, without touching the product that pays the bills.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { use } from 'react';

type Confidence = 'grounded' | 'inferred' | 'assumed';

interface Pillar {
  id: string;
  label: string;
  labelIt: string;
  source: 'asked' | 'inferred';
  value: string | null;
  promotedAt: string | null;
}
interface SectionView {
  id: string;
  label: string;
  labelIt: string;
  blurb: string;
  blurbIt: string;
  text: string | null;
  risk: string;
  confidence: Confidence | null;
}
interface Audit {
  filled: number; total: number;
  grounded: number; inferred: number; assumed: number;
  complete: boolean;
}
interface Progress { answered: number; total: number; complete: boolean; currentQuestion: number | null }
interface Msg { id: string; role: string; content: string }

/**
 * Copy, both locales, hand-authored rather than routed through the i18n bundle.
 *
 * The lite surface is isolated from the main app by design, and pulling in the
 * shared dictionary would be the first thread of coupling. The set is small and
 * closed; `sections.test.ts` asserts every section ships both languages.
 */
const COPY = {
  en: {
    stages: ['Your fit', 'Your take', 'The problem'],
    kickoff: 'Kickoff', done: 'Done', question: (n: number, of: number) => `Question ${n} of ${of}`,
    thinking: 'Thinking…', answer: 'Answer…', anythingElse: 'Anything else?',
    northStar: 'My North Star',
    pillarsTitle: 'The five pillars of what you’re building',
    pillarsBlank: 'Blank until you answer — then it fills in as you talk, and it stays yours.',
    pillarsFilling: 'Yours to edit. It keeps growing from here.',
    auditTitle: 'The whole plan, audited',
    writing: 'Writing', redraft: 'Redraft', fillAll: 'Fill every section',
    auditBlank: 'Answer once and all seven fill in — each labelled with how much it actually rests on.',
    auditFilled: 'Every section says where it came from and what would make it wrong. Start with the assumptions.',
    whatWrong: 'What would make this wrong',
    edit: 'Edit', save: 'Save', cancel: 'Cancel',
    grounded: 'You said this', inferred: 'Inferred', assumed: 'Assumption',
  },
  it: {
    stages: ['Perché tu', 'La tua tesi', 'Il problema'],
    kickoff: 'Kickoff', done: 'Fatto', question: (n: number, of: number) => `Domanda ${n} di ${of}`,
    thinking: 'Sto pensando…', answer: 'Rispondi…', anythingElse: 'Altro?',
    northStar: 'La mia stella polare',
    pillarsTitle: 'I cinque pilastri di quello che stai costruendo',
    pillarsBlank: 'Vuoto finché non rispondi — poi si riempie mentre parli, e resta tuo.',
    pillarsFilling: 'Puoi modificarlo. Da qui in poi cresce.',
    auditTitle: 'Il piano intero, verificato',
    writing: 'Sto scrivendo', redraft: 'Riscrivi', fillAll: 'Riempi tutte le sezioni',
    auditBlank: 'Rispondi una volta e si riempiono tutte e sette — ognuna etichettata con quanto regge davvero.',
    auditFilled: 'Ogni sezione dice da dove viene e cosa la renderebbe sbagliata. Parti dalle ipotesi.',
    whatWrong: 'Cosa la renderebbe sbagliata',
    edit: 'Modifica', save: 'Salva', cancel: 'Annulla',
    grounded: 'L’hai detto tu', inferred: 'Dedotto', assumed: 'Ipotesi',
  },
} as const;

/** Confidence is the audit. Colour it, or nobody reads it. */
const CONFIDENCE_STYLE: Record<Confidence, { fg: string; bg: string }> = {
  grounded: { fg: 'var(--moss)', bg: 'color-mix(in srgb, var(--moss) 12%, transparent)' },
  inferred: { fg: 'var(--ink-4)', bg: 'var(--paper-2)' },
  assumed: { fg: 'var(--clay)', bg: 'color-mix(in srgb, var(--clay) 12%, transparent)' },
};

export default function LiteKickoffPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pillars, setPillars] = useState<Pillar[]>([]);
  const [sections, setSections] = useState<SectionView[]>([]);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [progress, setProgress] = useState<Progress>({ answered: 0, total: 3, complete: false, currentQuestion: 1 });
  // From the PROJECT, not the account (CLAUDE.md) — the API sends it.
  const [locale, setLocale] = useState<'en' | 'it'>('en');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // key is `s:<id>` for a section, `p:<id>` for a pillar — one editor open at a
  // time, so a half-finished edit can never be silently abandoned by opening
  // another.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const opened = useRef(false);
  const auditFired = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadNorthStar = useCallback(async () => {
    const r = await fetch(`/api/lite/${projectId}/north-star`).then((x) => x.json()).catch(() => null);
    const d = r?.data ?? r;
    if (!d?.pillars) return d;
    if (d.locale === 'it' || d.locale === 'en') setLocale(d.locale);
    setPillars(d.pillars);
    if (d.sections) setSections(d.sections);
    if (d.audit) setAudit(d.audit);
    // Pillar count only — `currentQuestion` comes from the stream, which knows
    // about the turn in flight; this read does not.
    setProgress((prev) => ({ ...prev, answered: d.progress.answered, complete: d.progress.complete }));
    return d;
  }, [projectId]);

  /**
   * The audit: one pass, seven sections, streamed.
   *
   * Each `section_written` frame refetches the document, so sections appear one
   * at a time over ~30-60s instead of all at once at the end. That staggering is
   * the point — a founder watching seven sections land understands what the
   * product does without being told.
   */
  const runAudit = useCallback(async (force = false) => {
    setAuditing(true); setError(null);
    try {
      const res = await fetch(`/api/lite/${projectId}/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      if (!res.ok || !res.body) throw new Error(`Audit failed (HTTP ${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.section_written) void loadNorthStar();
          if (ev.audit) setAudit(ev.audit as Audit);
          if (typeof ev.error === 'string') setError(ev.error);
        }
      }
      await loadNorthStar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAuditing(false);
    }
  }, [projectId, loadNorthStar]);

  /**
   * One turn of the interview, streamed.
   *
   * Text lands progressively, and a `pillar_written` frame refreshes the panel
   * MID-REPLY — the founder watches a pillar appear while Otto is still talking.
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
      const after = await loadNorthStar();

      /**
       * THE AUTO-AUDIT TRIGGER — the one product knob worth arguing about.
       *
       * Fires after the founder's FIRST answer, not after all three. One answer
       * is thin evidence, so most sections come back "assumed" — but that is
       * exactly what makes the value legible on turn one: seven sections appear,
       * honestly labelled, and the remaining questions visibly upgrade them.
       *
       * Waiting for all three would produce a better first draft that nobody
       * sees, because the founder who was going to leave has already left.
       *
       * To change it, change this condition. `answered >= 3` gives the patient
       * version; `auditFired` only guards the automatic run, so the manual
       * button below still works either way.
       */
      const answered = after?.progress?.answered ?? 0;
      const alreadyAudited = (after?.audit?.filled ?? 0) > 0;
      if (!auditFired.current && !alreadyAudited && answered >= 1) {
        auditFired.current = true;
        void runAudit();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [projectId, loadNorthStar, runAudit]);

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

  const saveEdit = useCallback(async (key: string) => {
    const text = draft.trim();
    if (text.length < 3) { setEditing(null); return; }
    setSaving(true);
    const [kind, id] = [key.slice(0, 1), key.slice(2)];
    try {
      const res = await fetch(`/api/lite/${projectId}/north-star`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 's' ? { section: id, text } : { pillar: id, value: text }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`);
      setEditing(null);
      await loadNorthStar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [draft, projectId, loadNorthStar]);

  const submit = () => { const v = input.trim(); if (!v || busy) return; setInput(''); void send(v); };

  const t = COPY[locale];

  /** The inline editor. Same control for a pillar and a section. */
  const editor = (key: string) => (
    <div style={{ marginTop: 8 }}>
      <textarea
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(null);
          // Cmd/Ctrl+Enter saves; plain Enter must insert a newline, because
          // these fields are paragraphs, not chat messages.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void saveEdit(key); }
        }}
        rows={4}
        style={{
          width: '100%', resize: 'vertical', borderRadius: 8, padding: '9px 11px',
          border: '1px solid var(--moss)', background: 'var(--paper)',
          fontSize: 13.5, lineHeight: 1.6, fontFamily: 'inherit', color: 'var(--ink)',
        }}
      />
      <div style={{ display: 'flex', gap: 7, marginTop: 7 }}>
        <button
          onClick={() => void saveEdit(key)}
          disabled={saving}
          className="lp-mono"
          style={{
            fontSize: 10.5, padding: '5px 13px', borderRadius: 999, cursor: 'pointer',
            border: '1px solid var(--moss)', background: 'var(--moss)', color: 'var(--paper)',
          }}
        >{saving ? '…' : t.save}</button>
        <button
          onClick={() => setEditing(null)}
          className="lp-mono"
          style={{
            fontSize: 10.5, padding: '5px 13px', borderRadius: 999, cursor: 'pointer',
            border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--ink-4)',
          }}
        >{t.cancel}</button>
      </div>
    </div>
  );

  const editButton = (key: string, current: string) => (
    <button
      onClick={() => { setEditing(key); setDraft(current); }}
      className="lp-mono"
      style={{
        fontSize: 9, padding: '2px 8px', borderRadius: 999, cursor: 'pointer',
        border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--ink-5)',
      }}
    >{t.edit}</button>
  );

  return (
    // height:100% (not 100vh) so the two panes fill the <main> they are given.
    // 100vh overflowed whenever anything sat above us, pushing the composer off
    // the bottom of the screen.
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.15fr)', height: '100%', minHeight: 0, background: 'var(--paper)' }}>
      {/* ── LEFT: the conversation ─────────────────────────────────────── */}
      <section style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--line)', minWidth: 0, minHeight: 0 }}>
        <header style={{ padding: '14px 20px 10px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <span className="lp-mono" style={{ fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              {t.kickoff}
            </span>
            <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-5)' }}>
              {progress.complete ? t.done : t.question(progress.currentQuestion ?? 1, progress.total)}
            </span>
          </div>
          {/* Progress is DERIVED from the pillars — it cannot disagree with them. */}
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {t.stages.map((s, i) => (
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
          {busy && <div className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-5)' }}>{t.thinking}</div>}
          {error && <div style={{ fontSize: 12, color: 'var(--clay)' }}>{error}</div>}
          <div ref={endRef} />
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: 14 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={progress.complete ? t.anythingElse : t.answer}
            rows={3}
            style={{
              width: '100%', resize: 'none', border: '1px solid var(--line-2)', borderRadius: 10,
              padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit', background: 'var(--paper)', color: 'var(--ink)',
            }}
          />
        </div>
      </section>

      {/* ── RIGHT: the document writing itself ─────────────────────────── */}
      <section style={{ overflowY: 'auto', minHeight: 0, padding: '30px 34px 60px', background: 'var(--surface)' }}>
        <div className="lp-mono" style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-5)' }}>
          {t.northStar}
        </div>
        <h1 className="lp-serif" style={{ fontSize: 25, margin: '6px 0 4px', color: 'var(--ink)', fontWeight: 400 }}>
          {t.pillarsTitle}
        </h1>
        <p style={{ fontSize: 12, color: 'var(--ink-5)', margin: '0 0 22px' }}>
          {progress.answered === 0
            ? t.pillarsBlank
            : t.pillarsFilling}
        </p>

        {pillars.map((p) => (
          <div key={p.id} style={{ borderTop: '1px solid var(--line)', padding: '16px 0' }}>
            <div style={{ display: 'flex', gap: 14 }}>
              <span className="lp-serif" style={{ fontSize: 17, color: 'var(--ink-5)', minWidth: 26 }}>{p.id}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                  <div className="lp-mono" style={{ fontSize: 9.5, letterSpacing: 0.9, textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                    {locale === 'it' ? p.labelIt : p.label}
                  </div>
                  {p.value && editing !== `p:${p.id}` && editButton(`p:${p.id}`, p.value)}
                </div>
                {editing === `p:${p.id}` ? editor(`p:${p.id}`) : p.value ? (
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

        {/* ── THE AUDIT: seven sections, each with what could make it wrong ── */}
        <div style={{ marginTop: 38, borderTop: '2px solid var(--line)', paddingTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h2 className="lp-serif" style={{ fontSize: 20, margin: 0, color: 'var(--ink)', fontWeight: 400 }}>
              {t.auditTitle}
            </h2>
            {auditing ? (
              <span className="lp-mono" style={{ fontSize: 10.5, color: 'var(--moss)' }}>
                {t.writing} {audit ? `${audit.filled}/${audit.total}` : ''}…
              </span>
            ) : (
              <button
                onClick={() => void runAudit(true)}
                className="lp-mono"
                style={{
                  fontSize: 10.5, padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
                  border: '1px solid var(--line-2)', background: 'var(--paper)', color: 'var(--ink-3)',
                }}
              >
                {audit?.filled ? t.redraft : t.fillAll}
              </button>
            )}
          </div>

          {/* The honest scoreboard. Deliberately NOT a single percentage — one
              unexamined assumption can sink the idea, and an average hides it. */}
          {audit && audit.filled > 0 && (
            <div style={{ display: 'flex', gap: 7, marginTop: 12, flexWrap: 'wrap' }}>
              {([
                ['grounded', audit.grounded],
                ['inferred', audit.inferred],
                ['assumed', audit.assumed],
              ] as [Confidence, number][]).filter(([, n]) => n > 0).map(([c, n]) => (
                <span key={c} className="lp-mono" style={{
                  fontSize: 10, padding: '3px 9px', borderRadius: 999,
                  color: CONFIDENCE_STYLE[c].fg, background: CONFIDENCE_STYLE[c].bg,
                }}>
                  {n} {t[c].toLowerCase()}
                </span>
              ))}
            </div>
          )}

          <p style={{ fontSize: 12, color: 'var(--ink-5)', margin: '12px 0 4px', lineHeight: 1.55 }}>
            {audit?.filled
              ? t.auditFilled
              : t.auditBlank}
          </p>

          {sections.map((s) => {
            const style = s.confidence ? CONFIDENCE_STYLE[s.confidence] : null;
            return (
              <div key={s.id} style={{ borderTop: '1px solid var(--line)', padding: '16px 0' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                  <div className="lp-mono" style={{ fontSize: 9.5, letterSpacing: 0.9, textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                    {locale === 'it' ? s.labelIt : s.label}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {style && (
                      <span className="lp-mono" style={{
                        fontSize: 9, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap',
                        color: style.fg, background: style.bg,
                      }}>{t[s.confidence!]}</span>
                    )}
                    {s.text && editing !== `s:${s.id}` && editButton(`s:${s.id}`, s.text)}
                  </div>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-5)', marginTop: 3 }}>{locale === 'it' ? s.blurbIt : s.blurb}</div>

                {editing === `s:${s.id}` ? editor(`s:${s.id}`) : s.text ? (
                  <>
                    <div style={{ fontSize: 13.5, lineHeight: 1.65, marginTop: 9, color: 'var(--ink-2)' }}>{s.text}</div>
                    {s.risk && (
                      <div style={{
                        marginTop: 10, padding: '9px 12px', borderRadius: 8,
                        background: 'var(--paper-2)', borderLeft: `2px solid ${style?.fg ?? 'var(--line-2)'}`,
                      }}>
                        <div className="lp-mono" style={{ fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                          {t.whatWrong}
                        </div>
                        <div style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 4, color: 'var(--ink-3)' }}>{s.risk}</div>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[88, 70].map((w) => (
                      <div key={w} style={{ height: 8, width: `${w}%`, borderRadius: 4, background: 'var(--line-2)', opacity: 0.6 }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

'use client';

/**
 * Solve — the cream entry screen. A "describe your problem" prompt + Solve/Build
 * mode cards, rendered as a LIGHT island (`theme-cream`) inside the dark app.
 * Submitting creates a project and drops the founder into the co-pilot (Solve)
 * or the build surface (Build) with the prompt pre-filled.
 *
 * This is the visual home of the target's Solve landing; it reuses the real
 * createProject flow and the chat's ?prefill= support.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createProject } from '@/api/projects';
import { Logomark } from '@/components/design/Logomark';
import { LanguageSwitch } from '@/components/design/LanguageSwitch';
import { Icon, I } from '@/components/design/icons';

type ModeKind = 'Solve' | 'Build';

export default function SolvePage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<ModeKind>('Solve');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function start() {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr('');
    try {
      const name = text.split('\n')[0].slice(0, 60) || 'New project';
      const project = await createProject(name, text);
      const dest = mode === 'Build' ? 'build' : 'chat';
      router.push(`/project/${project.project_id}/${dest}?prefill=${encodeURIComponent(text)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start — try again.');
      setBusy(false);
    }
  }

  return (
    <div className="theme-cream lp-frame" style={{ height: '100%' }}>
      {/* Cream top bar */}
      <div style={{ height: 44, flexShrink: 0, borderBottom: '1px solid var(--line)', background: 'var(--surface)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10 }}>
        <a href="/" aria-label="LaunchPad — home" style={{ display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none' }}>
          <Logomark size={22} />
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 700, letterSpacing: '.02em', color: 'var(--ink)' }}>LAUNCHPAD</span>
        </a>
        <span style={{ flex: 1 }} />
        <a href="/" style={{ fontSize: 12, color: 'var(--ink-3)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Icon d={I.chevr} size={11} style={{ transform: 'rotate(180deg)' }} /> All projects
        </a>
        <LanguageSwitch />
      </div>

      <div className="lp-scroll" style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '48px 24px' }}>
        <div style={{ width: '100%', maxWidth: 640 }}>
          <h1 className="lp-h2" style={{ margin: 0 }}>What are we solving?</h1>
          <p className="lp-body" style={{ color: 'var(--ink-3)', marginTop: 6 }}>
            Describe any business problem, decision, or thing you need built. The co-pilot researches every angle and grounds each answer in your Project Knowledge.
          </p>

          {/* Prompt */}
          <div style={{ marginTop: 20, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-l)', padding: 14 }}>
            <textarea
              className="lp-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. We're building an AI OS for founders. Where's our wedge — pitch-prep, weekly ops, or investor inbox?"
              rows={4}
              style={{ border: 'none', padding: 0, background: 'transparent', resize: 'vertical', fontSize: 14 }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') start();
              }}
            />
            <div className="lp-row" style={{ marginTop: 10 }}>
              <span className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>⌘⏎ to start</span>
              <span style={{ flex: 1 }} />
              <button className="lp-btn lp-btn-primary" onClick={start} disabled={!prompt.trim() || busy}>
                <Icon d={I.arrow} size={12} /> {busy ? 'Starting…' : `Start ${mode}`}
              </button>
            </div>
          </div>
          {err && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--clay)' }}>{err}</div>}

          {/* Mode cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
            <ModeCard kind="Solve" active={mode === 'Solve'} onClick={() => setMode('Solve')} body="Any question, any situation. Every angle researched, evidence weighed — ready to act on." />
            <ModeCard kind="Build" active={mode === 'Build'} onClick={() => setMode('Build')} body="Production-grade from the first generation. Output that used to need a design + dev team." />
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeCard({ kind, body, active, onClick }: { kind: ModeKind; body: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: 'var(--surface)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
        boxShadow: active ? '0 0 0 3px var(--accent-wash)' : 'none',
        borderRadius: 'var(--r-l)',
        padding: 14,
        cursor: 'pointer',
      }}
    >
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 'var(--r-s)', background: kind === 'Solve' ? 'var(--sky-wash)' : 'var(--accent-wash)', color: 'var(--ink)', fontSize: 11.5, fontWeight: 600 }}
      >
        <Icon d={kind === 'Solve' ? I.sparkles : I.bolt} size={11} /> {kind}
      </span>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 10, lineHeight: 1.5 }}>{body}</div>
    </button>
  );
}

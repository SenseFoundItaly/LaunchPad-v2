'use client';

/**
 * Notes card (changelog 17/06 item 12): a small composer on Home where the
 * founder jots news/appunti that update Knowledge directly. POSTs to
 * /api/projects/{id}/notes, which stores an APPLIED memory_fact (kind='note')
 * → it enters agent context immediately and appears on the Knowledge page. After
 * a save we fire lp-knowledge-changed so the graph/Knowledge surfaces refetch.
 */

import { useState } from 'react';
import { Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';

export function NotesCard({ projectId }: { projectId: string }) {
  const t = useT();
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const canSave = text.trim().length > 0 && state !== 'saving';

  async function save() {
    if (!canSave) return;
    setState('saving');
    try {
      const res = await fetch(`/api/projects/${projectId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: text.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setText('');
      setState('saved');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lp-knowledge-changed'));
      }
      setTimeout(() => setState('idle'), 2500);
    } catch {
      setState('error');
    }
  }

  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-l)',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Icon d={I.edit} size={13} stroke={1.4} style={{ color: 'var(--ink-3)' }} />
        <h2
          style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: 'var(--ink-3)',
          }}
        >
          {t('notes.title')}
        </h2>
        <span className="lp-mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ink-5)' }}>
          {t('notes.hint')}
        </span>
      </header>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter saves — a common power-user affordance.
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void save(); }
          }}
          placeholder={t('notes.placeholder')}
          rows={3}
          style={{
            width: '100%',
            resize: 'vertical',
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--ink)',
            background: 'var(--paper)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-m)',
            padding: '8px 10px',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={save}
            disabled={!canSave}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--on-accent)',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 'var(--r-m)',
              padding: '7px 13px',
              cursor: canSave ? 'pointer' : 'default',
              opacity: canSave ? 1 : 0.5,
            }}
          >
            <Icon d={I.plus} size={13} stroke={1.8} />
            {state === 'saving' ? t('notes.saving') : t('notes.add')}
          </button>
          {state === 'saved' && (
            <span className="lp-mono" style={{ fontSize: 11, color: 'var(--moss)' }}>{t('notes.saved')}</span>
          )}
          {state === 'error' && (
            <span className="lp-mono" style={{ fontSize: 11, color: 'var(--clay)' }}>{t('notes.error')}</span>
          )}
        </div>
      </div>
    </section>
  );
}

export default NotesCard;

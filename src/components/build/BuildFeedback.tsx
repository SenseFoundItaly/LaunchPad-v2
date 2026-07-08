'use client';

import { useState } from 'react';
import { useT } from '@/components/providers/LocaleProvider';
import type { ClientFeedback } from './types';
import { secondaryBtn } from './BuildHub';

export default function BuildFeedback({
  feedback,
  busy,
  onAdd,
}: {
  feedback: ClientFeedback[];
  busy: boolean;
  onAdd: (text: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState('');

  return (
    <section style={card}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 10 }}>
        {t('build.feedback.title')}
      </div>

      {feedback.length === 0 ? (
        <p style={{ color: 'var(--ink-4)', fontSize: 13, margin: '0 0 12px' }}>{t('build.feedback.empty')}</p>
      ) : (
        <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13, color: 'var(--ink)' }}>
          {feedback.slice(0, 20).map((f) => (
            <li key={f.id} style={{ marginBottom: 4 }}>
              {f.body}
              <span style={{ color: 'var(--ink-4)', fontSize: 11 }}> · {f.source}</span>
            </li>
          ))}
        </ul>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('build.feedback.placeholder')}
        rows={2}
        style={{
          width: '100%',
          resize: 'vertical',
          borderRadius: 8,
          border: '1px solid var(--line)',
          background: 'var(--paper)',
          color: 'var(--ink)',
          padding: 10,
          fontSize: 13,
          fontFamily: 'inherit',
        }}
      />
      <div style={{ marginTop: 8 }}>
        <button
          style={secondaryBtn}
          disabled={busy || !text.trim()}
          onClick={() => {
            onAdd(text.trim());
            setText('');
          }}
        >
          {t('build.feedback.add')}
        </button>
      </div>
    </section>
  );
}

const card: React.CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 12,
  padding: 18,
  background: 'var(--paper-2)',
  marginBottom: 18,
};

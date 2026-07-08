'use client';

import { useT } from '@/components/providers/LocaleProvider';
import type { ClientBuild } from './types';

export default function IterationTimeline({ builds }: { builds: ClientBuild[] }) {
  const t = useT();
  if (builds.length <= 1) return null;

  return (
    <section style={card}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 10 }}>
        {t('build.timeline')}
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {builds.map((b, i) => (
          <li
            key={b.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 0',
              borderTop: i === 0 ? 'none' : '1px solid var(--line)',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', minWidth: 28 }}>#{b.iteration}</span>
            <span style={{ fontSize: 11, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {b.status}
            </span>
            {b.spec_prompt && (
              <span style={{ fontSize: 12, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {b.spec_prompt.slice(0, 80)}
              </span>
            )}
            {b.preview_url && (
              <a
                href={b.preview_url}
                target="_blank"
                rel="noreferrer"
                style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--sky, #6aa7ff)' }}
              >
                {t('build.preview')} ↗
              </a>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

const card: React.CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 12,
  padding: 18,
  background: 'var(--paper-2)',
};

'use client';

import { useT } from '@/components/providers/LocaleProvider';
import type { ClientBuild } from './types';

/**
 * The build conversation — each iteration as a turn (the request that produced it +
 * its outcome), oldest first, like a chat history. The live preview + input live in
 * CurrentBuildCard; this is the running record of the back-and-forth.
 */
export default function IterationTimeline({ builds }: { builds: ClientBuild[] }) {
  const t = useT();
  if (builds.length <= 1) return null;

  const chronological = [...builds].reverse(); // API returns DESC; a thread reads oldest→newest

  return (
    <section style={card}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 12 }}>
        {t('build.thread.title')}
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {chronological.map((b) => {
          const label = b.iteration === 1 ? t('build.thread.initial') : b.spec_prompt?.trim() || `#${b.iteration}`;
          return (
            <li key={b.id} style={turn}>
              <span style={turnNum}>{b.iteration}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {b.status === 'building' ? t('build.thread.building') : b.status}
                </div>
              </div>
              {/* No external preview link per turn — older preview URLs are
                  builder-hosted (vendor origin) and their tokens expire anyway.
                  The live preview lives in CurrentBuildCard's iframe. */}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const card: React.CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 12,
  padding: 18,
  background: 'var(--paper-2)',
  marginTop: 18,
};

const turn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
};

const turnNum: React.CSSProperties = {
  flexShrink: 0,
  width: 22,
  height: 22,
  borderRadius: 999,
  border: '1px solid var(--line)',
  background: 'var(--surface, rgba(255,255,255,0.05))',
  color: 'var(--ink-4)',
  fontSize: 11,
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

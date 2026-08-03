'use client';

import { useT } from '@/components/providers/LocaleProvider';
import { Panel } from '@/components/design/primitives';
import type { ClientBuild } from './types';

/**
 * The build conversation — each iteration as a turn (the request that produced it +
 * its outcome), oldest first, like a chat history. The live preview + input live in
 * CurrentBuildCard; this is the running record of the back-and-forth.
 */
export default function IterationTimeline({ builds, projectId }: { builds: ClientBuild[]; projectId: string }) {
  const t = useT();
  if (builds.length <= 1) return null;

  const chronological = [...builds].reverse(); // API returns DESC; a thread reads oldest→newest

  return (
    <Panel title={t('build.thread.title')} style={{ marginTop: 18 }}>
      <div style={{ padding: 16 }}>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {chronological.map((b) => {
          const label = b.iteration === 1 ? t('build.thread.initial') : b.spec_prompt?.trim() || `#${b.iteration}`;
          return (
            <li key={b.id} style={turn}>
              <span style={turnNum}>{b.iteration}</span>
              {/* Persistent per-version snapshot, proxied through OUR origin —
                  this is what makes the history VISUAL. The live preview URL
                  expires, so older iterations would otherwise be blank rows. */}
              {(b.metadata as Record<string, unknown> | null)?.has_screenshot ? (
                <img
                  src={`/api/projects/${projectId}/builds/${b.id}?screenshot=1`}
                  alt={`${t('build.iteration')} ${b.iteration}`}
                  loading="lazy"
                  style={thumb}
                />
              ) : null}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {b.status === 'building' ? t('build.thread.building') : b.status}
                  {(() => {
                    const files = ((b.metadata as Record<string, unknown> | null)?.diff as { files?: unknown[] } | undefined)?.files;
                    return Array.isArray(files) && files.length
                      ? ` · ${t('build.thread.changed', { count: files.length })}`
                      : '';
                  })()}
                </div>
              </div>
              {/* No external preview link per turn — older preview URLs are
                  builder-hosted (vendor origin) and their tokens expire anyway.
                  The live preview lives in CurrentBuildCard's iframe. */}
            </li>
          );
        })}
      </ol>
      </div>
    </Panel>
  );
}

const turn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
};

const thumb: React.CSSProperties = {
  width: 96,
  height: 60,
  flexShrink: 0,
  objectFit: 'cover',
  objectPosition: 'top',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: 'var(--paper)',
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
